# Operations

What has to be running for Dixora to be safe in production, and how to check it.

## Backups

`ops/backup.sh` takes a compressed PostgreSQL dump, verifies it can be read
back, and prunes anything older than the retention window.

```bash
cd /srv/dixora
set -a && . ./.env && set +a
./ops/backup.sh                     # writes ./backups
BACKUP_DIR=/mnt/backup ./ops/backup.sh
```

Schedule it from the host crontab:

```cron
15 3 * * * cd /srv/dixora && set -a && . ./.env && set +a && ./ops/backup.sh >> /var/log/dixora-backup.log 2>&1
```

The dump is written and verified **inside** the container before being copied
out. A custom-format dump has to be seekable to be read back, so verifying it
through a pipe fails even when the dump is perfectly good.

### Restore — and why you must rehearse it

```bash
./ops/restore.sh backups/dixora-20260813-031500.dump              # into a scratch db
TARGET_DB=dixora ./ops/restore.sh backups/....dump --force        # over the live db
```

The script prints row counts after restoring, so an empty dump looks like the
failure it is instead of a clean exit code. Overwriting the live database is
refused without `--force`.

**Run a restore drill monthly.** A backup nobody has ever restored is not a
backup — the first time this repository's script ran, it produced a good dump
and then destroyed it because the verification step was wrong. That was only
caught by actually restoring.

`backups/` and `*.dump` are gitignored: dumps contain customer names, emails and
order history.

## Subscription billing

Invoices are issued by a command, not by a timer inside the API. With several
workers an in-process scheduler would fire once per worker, and only a database
constraint would stop the duplicates.

```bash
docker compose exec -T api python -m app.cli billing-run
docker compose exec -T api python -m app.cli billing-run --date 2026-09-01
```

Schedule it on the first of each month:

```cron
30 4 1 * * cd /srv/dixora && docker compose exec -T api python -m app.cli billing-run >> /var/log/dixora-billing.log 2>&1
```

Safe to run repeatedly: a subscription already invoiced for that month is
skipped, and two concurrent runs cannot both win the unique constraint.

What is billed: active subscriptions only. Trials and suspended businesses are
skipped, so suspending a business stops the meter rather than just hiding its
screens. The amount is the plan's monthly price plus the per-branch charge for
branches beyond the included allowance, and the breakdown is frozen on the
invoice — a branch opened in September cannot change what August cost.

### Collection

Set these to charge for real; the default is sandbox so a misconfigured
deployment cannot touch a live card:

```
DIXORA_PAYMENT_PROVIDER=iyzico
DIXORA_IYZICO_API_KEY=...
DIXORA_IYZICO_SECRET_KEY=...
DIXORA_IYZICO_BASE_URL=api.iyzipay.com     # sandbox-api.iyzipay.com by default
```

Card entry happens on the provider's hosted page. A card number never reaches
this server — transmitting one would put the whole application in PCI DSS
scope even though nothing is stored here.

Three failures are handled differently and must stay that way:

| What happened           | Result                                                                   |
| ----------------------- | ------------------------------------------------------------------------ |
| Card declined           | Invoice stays owed, reason recorded, attempt counted                     |
| Provider unreachable    | Invoice untouched — an outage must not spend the customer's retry budget |
| Billing e-mail unusable | Never attempted; a clear error instead of a decline nobody can act on    |

Collection stops after four declines. Endless retries irritate the bank's fraud
systems and never recover the money.

## Migrations

```bash
docker compose exec -T api alembic upgrade head
```

CI applies every migration to an empty PostgreSQL on each push. A fresh install
broke once because a revision assumed columns an earlier one had not created,
and only an empty database catches that.

## Health

- `GET /api/v1/system/health` — process is up
- `GET /api/v1/system/ready` — database reachable

## Things to watch

**Login cost under a rush.** Argon2 is deliberately expensive. A hundred
simultaneous logins measured p50 3.9 s — the exact shape of a shift change at a
large chain. Stagger logins or lengthen sessions; do **not** weaken the Argon2
parameters.

**Capacity.** 25 branches passes comfortably (p50 88 ms). 100 branches failed on
a contended dev laptop and has never been retried on real hardware with
PgBouncer. Treat anything above 25 as unmeasured.

**Clock skew.** Token time claims allow 30 seconds of tolerance. Without it a
verifying clock reading a moment behind the issuing one rejects freshly minted
tokens, which looks exactly like users being randomly logged out. Keep NTP
running on the host anyway.
