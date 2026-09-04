# Deploying Dixora to Hetzner

A single Hetzner Cloud server running the whole stack behind one domain. This
is the smallest shape that is safe to put on the internet: everything talks
over a private Docker network, and only nginx is reachable from outside.

```
Internet ──► nginx (80/443, TLS)
               ├── /api/v1/*  ──► FastAPI (api:8000)
               └── everything ──► Next.js (web:3000) ──► FastAPI (api:8000)
                                     │
        PostgreSQL · Redis · MinIO ──┘   (private network only)
```

One origin, `https://dixoratech.com`, serves the app, the API, media and the
WebSocket. No `api.` subdomain: same-origin means no CORS preflights, no
cross-site cookie rules and one certificate.

---

## 1. Server prerequisites

|              | Minimum              | Comfortable           |
| ------------ | -------------------- | --------------------- |
| Hetzner type | CX22 (2 vCPU / 4 GB) | CPX31 (4 vCPU / 8 GB) |
| Disk         | 40 GB                | 80 GB                 |
| OS           | Ubuntu 24.04 LTS     | Ubuntu 24.04 LTS      |

Argon2 password hashing is deliberately expensive and Next.js builds are
memory-hungry: below 4 GB the image build itself is the first thing to fail.
Build elsewhere and pull, or size up.

Create the server with an SSH key, not a password. Then, as root:

```bash
adduser dixora
usermod -aG sudo dixora
rsync --archive --chown=dixora:dixora ~/.ssh /home/dixora
```

Disable password and root SSH login in `/etc/ssh/sshd_config`:

```
PermitRootLogin no
PasswordAuthentication no
```

```bash
systemctl restart ssh
timedatectl set-ntp true    # token validity allows 30s of skew; keep NTP on
```

## 2. Required ports

| Port                               | Exposure                  | Why                               |
| ---------------------------------- | ------------------------- | --------------------------------- |
| 22                                 | your IP only, if possible | SSH                               |
| 80                                 | public                    | ACME challenge, redirect to HTTPS |
| 443                                | public                    | everything                        |
| 3000, 8000, 5432, 6379, 9000, 9001 | **never public**          | app internals                     |

The production Compose file publishes only 80 and 443. PostgreSQL, Redis,
MinIO, the API and the web server have no host port at all — they exist only
on the `dixora-network` bridge. The firewall below is the second lock on the
same door, not the only one.

## 3. Firewall

Hetzner Cloud Firewall (in the console) is the outer layer; `ufw` on the host
is the inner one. Configure both — the cloud firewall protects the host even
if the host's own rules are flushed.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

Docker publishes ports by writing iptables rules that bypass ufw. This stack
publishes only 80 and 443, which ufw allows anyway, so the two agree. If you
ever add a published port, check it from outside the host before assuming ufw
is hiding it:

```bash
# from your laptop, not the server
nmap -Pn -p 22,80,443,3000,8000,5432,6379,9000 dixoratech.com
```

## 4. Docker installation

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker dixora
newgrp docker
docker compose version      # v2 required; v1 is not supported
```

## 5. Clone the repository

```bash
sudo mkdir -p /srv/dixora && sudo chown dixora:dixora /srv/dixora
git clone https://github.com/mhalitekici/dixora-web.git /srv/dixora
cd /srv/dixora
```

## 6. Check out the release

Deploy a named commit, never a moving branch — you cannot roll back to
"whatever main was yesterday".

```bash
git checkout main            # or the release branch/tag
git rev-parse HEAD           # WRITE THIS DOWN: it is your rollback target
```

## 7. `.env.production`

```bash
cp .env.production.example .env.production
chmod 600 .env.production
$EDITOR .env.production
```

Every `<GENERATE>` must be replaced. What must be right:

- `DIXORA_DOMAIN`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL` and
  `DIXORA_MEDIA_PUBLIC_BASE_URL` all name the same host.
- `POSTGRES_PASSWORD` appears **twice**: on its own and inside
  `DIXORA_DATABASE_URL`. They must match.
- `AUTH_COOKIE_DOMAIN` stays empty. Same-origin auth wants host-only cookies.
- `DIXORA_DEV_SEED_ENABLED=false` and `DIXORA_AUTO_CREATE_SCHEMA=false`. The
  Compose file pins both regardless, so this is belt and braces.
- `LETSENCRYPT_EMAIL` is a mailbox somebody reads — expiry warnings go there.

`NEXT_PUBLIC_*` values are compiled into the browser bundle when the image is
built. Changing one needs `--build`, not a restart.

## 8. Secret generation

```bash
openssl rand -hex 32      # DIXORA_JWT_SECRET, DIXORA_PRINT_BRIDGE_KEY
openssl rand -base64 24   # POSTGRES_PASSWORD, MinIO and S3 credentials
```

The API refuses to boot in production if it finds a development default, a
weak database credential, SQLite, wildcard CORS, the dev seed, or a
development mail/phone provider. If the container exits immediately, read the
first lines of `docker compose logs api` — the reason is always named.

Keep a copy of these secrets in a password manager. `DIXORA_JWT_SECRET` cannot
be rotated without logging everyone out; losing `POSTGRES_PASSWORD` while the
volume survives is recoverable, losing both is not.

## 9. Start the stack

DNS must resolve **before** the first certificate request (section 11), so do
that first if the domain is new.

```bash
cd /srv/dixora

# One-time: the first TLS certificate.
STAGING=1 ./ops/init-letsencrypt.sh    # rehearse; result is untrusted
./ops/init-letsencrypt.sh              # the real one

docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.production ps
```

Let's Encrypt allows five failures per hostname per hour. Rehearse with
`STAGING=1` until the run is clean.

Because the flags are long, export them once per shell:

```bash
export COMPOSE_FILE=docker-compose.prod.yml
export COMPOSE_ENV_FILE=.env.production     # docker compose v2.24+
docker compose ps                            # now picks both up
```

`ops/backup.sh` and `ops/restore.sh` honour `COMPOSE_FILE` too, so exporting
it is what points them at the production stack.

## 10. Migrations

The API container runs `alembic upgrade head` before uvicorn starts. A failed
migration leaves the container dead instead of serving traffic against a
schema it does not match — that is deliberate; do not "fix" it by starting
uvicorn first.

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec -T api alembic current
```

Schema is only ever created by Alembic. `DIXORA_AUTO_CREATE_SCHEMA` stays
false: `create_all` builds tables that drift from the migration history and
the drift only surfaces on the next upgrade.

The first business is created through the registration flow in the app, not
by a seed. No demo users exist on a production host.

## 11. Domain DNS

At the registrar for `dixoratech.com`:

| Type | Name  | Value                  |
| ---- | ----- | ---------------------- |
| A    | `@`   | server IPv4            |
| A    | `www` | server IPv4            |
| AAAA | `@`   | server IPv6 (optional) |
| AAAA | `www` | server IPv6 (optional) |

```bash
dig +short dixoratech.com
dig +short www.dixoratech.com
```

Both must return the server before requesting a certificate. `www` redirects
to the apex; the apex is canonical because auth cookies are host-only and
serving both would split every session.

## 12. SSL

`ops/init-letsencrypt.sh` handles the first issue: it drops in a temporary
self-signed pair so nginx can start, brings nginx up, completes the ACME
webroot challenge, and reloads. Renewal is automatic — the `certbot` service
checks twice a day and renews inside the last 30 days.

```bash
# confirm renewal works long before it matters
docker compose -f docker-compose.prod.yml --env-file .env.production \
  run --rm certbot certbot renew --dry-run
```

`/.well-known/acme-challenge/` is served over plain HTTP on purpose and must
never be redirected, or renewals fail silently until the certificate expires.

## 13. Healthcheck

From the server:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production ps
# every service: healthy (minio-init exits 0 and stays exited - that is correct)

docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec -T api python -c \
  "import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:8000/ready').read())"
```

The API's probes are `GET /health` (process up) and `GET /ready` (database
reachable), at the root — **not** under `/api/v1`. They are restricted to the
internal network by the proxy, so check them through `exec`, not the domain.

From outside:

```bash
curl -I https://dixoratech.com                      # 200, and HSTS present
curl -I http://dixoratech.com                       # 301 to https
curl -I https://www.dixoratech.com                  # 301 to the apex
curl -s -o /dev/null -w '%{http_code}\n' https://dixoratech.com/api/v1/docs   # 404: docs are off
```

Then, in a browser: the login page renders, a login succeeds, and the network
tab shows a `wss://dixoratech.com/api/v1/ws` connection that stays open.

## 14. Logs

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f --tail=200
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f api
```

API logs are structured JSON and carry a request id, which is also returned to
the client in `X-Request-ID` — that is how a user's report gets matched to a
log line. Passwords, tokens, cookies and card data are never logged, and
`DIXORA_SQL_ECHO` stays false because statement logging would print customer
data with the bound parameters.

Cap the disk that logs can take, or they will eventually fill it:

```json
// /etc/docker/daemon.json
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "50m", "max-file": "5" }
}
```

```bash
sudo systemctl restart docker
```

## 15. Backup cron

Nightly dump with verification and retention (`ops/backup.sh` reads its
settings from the env file):

```cron
15 3 * * * cd /srv/dixora && export COMPOSE_FILE=docker-compose.prod.yml && set -a && . ./.env.production && set +a && ./ops/backup.sh >> /var/log/dixora-backup.log 2>&1
```

- Retention: 30 days (`RETENTION_DAYS`), which covers a mistake noticed a
  month later without filling the disk.
- `BACKUP_DIR=/srv/dixora-backups` — outside the repository. Dumps contain
  customer names, e-mails and order history.
- Local dumps do not survive the server being lost. Copy them off the host as
  soon as there is somewhere to put them (Hetzner Storage Box over `rsync`,
  or S3 with server-side encryption).

**Rehearse a restore monthly.** A backup nobody has restored is not a backup.

```bash
COMPOSE_FILE=docker-compose.prod.yml ./ops/restore.sh /srv/dixora-backups/dixora-....dump
```

That restores into a scratch database and prints row counts, so an empty dump
looks like the failure it is instead of a clean exit code.

## 16. Update procedure

```bash
cd /srv/dixora
git rev-parse HEAD > /tmp/dixora-previous-sha        # rollback target
COMPOSE_FILE=docker-compose.prod.yml ./ops/backup.sh # migrations are one-way

git fetch origin
git checkout <new-sha-or-tag>

docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.production ps
curl -I https://dixoratech.com
```

Expect a short interruption: images build on the host, then the API and web
containers restart. Deploy outside service hours.

If `NEXT_PUBLIC_*` changed, `--build` is mandatory — those values are baked
into the browser bundle.

## 17. Rollback

```bash
cd /srv/dixora
git checkout $(cat /tmp/dixora-previous-sha)
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

That reverts application code. **The database does not come back with it.**

Alembic downgrades are not part of this procedure. A downgrade that drops a
column destroys the data in it, and most of these migrations were never
rehearsed in reverse. If the new release migrated the schema and has to be
undone:

1. Stop the stack.
2. Restore the pre-deploy dump (`ops/restore.sh` with `--force`).
3. Check out the previous commit and start again.

Which is why the backup in step 16 is not optional. A schema-only release can
be rolled back by checking out the old code alone; anything that migrated
needs the dump.

## 18. Troubleshooting

**API exits immediately.** Configuration validation. `docker compose logs api`
names the offending setting in the first lines — a development default, weak
database credentials, wildcard CORS, or a development mail/phone provider.

**API restarts in a loop, `alembic upgrade head` fails.** The schema does not
match the migration history, usually from an earlier `AUTO_CREATE_SCHEMA=true`
run. Restore the dump into a clean database rather than editing tables by hand.

**502 from nginx.** The upstream is not healthy yet, or not at all:
`docker compose ps`. nginx resolves `api` and `web` at startup, so if it
started before them, `docker compose restart proxy`.

**nginx will not start, "cannot load certificate".** The certificate is
missing or the domain in `.env.production` does not match the one it was
issued for. Re-run `ops/init-letsencrypt.sh`.

**Certificate did not renew.** Check the challenge path is reachable and
un-redirected:
`curl http://dixoratech.com/.well-known/acme-challenge/test` should return 404
from nginx, not a 301.

**Everyone is rate-limited at once, or nobody is.** The real client address is
not reaching the API. `X-Forwarded-For` is set by nginx to the connecting
address, forwarded by the Next.js BFF, and trusted by uvicorn only from
`DIXORA_FORWARDED_ALLOW_IPS`. If `DIXORA_NETWORK_SUBNET` was changed, that
variable must change with it. Check what the API sees:
`docker compose logs api | grep login` and compare with your own address.

**WebSocket never connects.** `NEXT_PUBLIC_WS_URL` must be `wss://` on HTTPS,
and it is baked in at build time — rebuild after changing it.

**Login is slow under a rush.** Argon2 is deliberately expensive; a hundred
simultaneous logins measured p50 3.9 s. Stagger shift changes or lengthen
sessions. Do not weaken the Argon2 parameters.

**Out of disk.** Usually images and build cache: `docker system df`, then
`docker image prune -a --filter "until=168h"`. Never prune volumes — that is
the database.

---

## Deliberately not part of this deployment

- **Iyzico / card collection.** `DIXORA_PAYMENT_PROVIDER=none`. Subscriptions
  are still invoiced by `app.cli billing-run`; only collection is off.
- **Print bridge.** The mock bridge prints nothing and is absent from the
  production stack. Real printers connect a bridge on the venue's LAN later.
- **Offsite backups, monitoring stack, CDN, PgBouncer.** Second phase; the
  notes above say where each one goes when it arrives.
