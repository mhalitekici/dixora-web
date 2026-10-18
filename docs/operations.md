# Operations

What has to be running for Dixora to be safe in production, and how to check it.
Standing up a new production host is a separate document:
[Hetzner deployment](hetzner-production-deploy.md).

## Backups

`ops/backup.py` creates one verified bundle containing `database.dump`,
`media.tar`, and `manifest.json`. PostgreSQL runs `pg_dump` and `pg_restore
--list` in the database container. MinIO media is streamed through a one-off API
container using that stack's configured S3 credentials; credentials never appear
in command arguments. The host needs Python 3.11+ and Docker Compose v2.

```bash
python3 ops/backup.py create --directory /srv/dixora-backups --quiesce
python3 ops/backup.py verify /srv/dixora-backups/dixora-TIMESTAMP-ID
```

Windows uses `python` instead of `python3`. `ops/backup.sh` wraps `create`, and
honors `BACKUP_DIR`, `RETENTION_DAYS` (default 14), `POSTGRES_SERVICE`,
`API_SERVICE`, `PYTHON_BIN`, and Compose's native environment variables.
It no longer requires sourcing `.env` into a shell.

`--quiesce` briefly stops running `web` and `api` services, then restarts only
those that were running, including after a failed backup. This prevents
application writes/deletions between the database and media snapshots and records
all public-table row counts. Coordinate any external writers separately. Without
this flag the backup is online: both stores are individually readable, but their
snapshots may reflect different moments. Schedule the quiesced backup outside service hours.

Each file and each media object has a SHA-256 checksum. Media object keys,
content types and user metadata survive restoration; empty buckets and zero-byte
objects are supported. This backs up current application media, not MinIO users,
server configuration, bucket lifecycle policies, historical versions, or PostgreSQL
roles. Retain deployment configuration and secrets separately. It is a full
snapshot, not PostgreSQL point-in-time recovery.

Only a complete, verified bundle is published. Concurrent runs are refused by
`.backup.lock`; investigate an abandoned lock before removing it. Temporary helper
containers are removed on success and failure. Retention removes only old complete
bundles directly under the backup root after a successful new backup. Legacy
`.dump` files and incomplete bundles are not pruned automatically. Data stays in a
private directory (0700 on Unix); `backups/` and `*.dump` are gitignored.

### Production scheduling

```bash
export COMPOSE_FILE=docker-compose.prod.yml
export COMPOSE_ENV_FILES=.env.production
python3 ops/backup.py create --directory /srv/dixora-backups --quiesce
```

Install the supplied systemd units on the production host (paths assume
`/srv/dixora` and the `dixora` user with Docker access):

```bash
sudo install -d -m 700 -o dixora -g dixora /srv/dixora-backups
sudo install -m 644 ops/systemd/dixora-backup.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dixora-backup.timer
systemctl list-timers dixora-backup.timer
journalctl -u dixora-backup.service
```

The timer runs at 03:15 in the **host timezone**, with up to five minutes of
jitter, and catches up after downtime. A cron alternative is:

```cron
15 3 * * * cd /srv/dixora && COMPOSE_FILE=docker-compose.prod.yml COMPOSE_ENV_FILES=.env.production BACKUP_DIR=/srv/dixora-backups /usr/bin/python3 ops/backup.py create --quiesce >> /var/log/dixora-backup.log 2>&1
```

Choose one scheduler. No production timer is installed by changing this repository.
Monitor failures and the age of the latest successful backup. Store verified
bundles on an encrypted destination outside the application host as well; a local
bundle does not protect against loss of the server. Offsite credentials and the
production host are deployment inputs, not included in this repository.

### Restore drill

```bash
python3 ops/backup.py restore /srv/dixora-backups/dixora-TIMESTAMP-ID \
  --database dixora_restore_check_20261018 --bucket dixora-restore-check-20261018
```

Both targets must be fresh. The script refuses source/system databases, existing
databases, the configured media bucket, and existing buckets. It verifies every
archive before writes, restores PostgreSQL in one transaction, downloads every
restored object to compare its checksum/content type/metadata, and compares all
public-table row counts for quiesced bundles. A failed cross-store restore can
leave its fresh targets for diagnosis; use new names on retry. It never drops or
overwrites a live destination. Run a restore drill monthly and record its duration.
Promoting recovered data to production requires a separate maintenance procedure
and pointing the application at **both** recovered stores.

`ops/restore.sh` accepts bundle directories with `--database` and `--bucket`.
Its legacy `.dump` mode remains available for old backups and does not restore
MinIO; only that legacy mode supports `TARGET_DB=... --force` overwrites.

## Business-day integration verification

Use the disposable stack for real PostgreSQL migrations, HTTP requests, MinIO,
and a backup/restore drill. It has its own network and ephemeral storage; it does
not use the local development database or mail/payment provider credentials.

```bash
export COMPOSE_FILE=infrastructure/docker-compose.validation.yml
export COMPOSE_PROJECT_NAME=dixora-validation
docker compose up -d --build --wait api
python3 ops/validate_business_day.py
docker compose exec -T api python - < ops/seed_validation_media.py
python3 ops/backup.py create --quiesce --directory backups/validation
# Verify and restore the printed bundle path into fresh targets as above.
docker compose down --volumes
```

`validate_business_day.py` is restricted to localhost and the seeded `dixora-lab`
tenant. It checks repeated order/payment/refund requests, shift requirements,
overbalance rejection, split cash/card payment after refund, table closure,
zero-variance shift closure/history, two-employee handoff, and manager business-day
closure with open-shift and duplicate-close guards. Run once per fresh stack. Add
`--profile browser` to Compose to serve the isolated web UI on port 13000.
The CI `Business day and backup restore` job runs the HTTP and restore checks on
every configured push/PR, including a Unicode media key and an empty object.
The validation MinIO image builds the production release's immutable official
source commit (`0d7408f`) because its legacy community registry tag is no longer
available to clean runners. See the upstream [source distribution instructions](https://github.com/minio/minio#source-only-distribution).

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

- `GET /health` — process is up
- `GET /ready` — database reachable, returns 503 when it is not

Both sit at the root, outside the `/api/v1` prefix, and the production proxy
only answers them from the internal network. Check them through the container
rather than the domain:

```bash
docker compose exec -T api python -c   "import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:8000/ready').read())"
```

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
