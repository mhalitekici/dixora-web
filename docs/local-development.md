# Local development

## Prerequisites

- Docker Engine with Docker Compose
- Node.js 22 or newer and npm 11 for host-side web/package work
- Python 3.11 or newer only if running the API outside Docker
- GNU Make is optional; every Make target maps to a documented command

On Windows, Docker Desktop with Linux containers is the supported Compose
environment. `make` is not installed by default, so use the equivalent npm and
Docker commands below unless GNU Make is available.

## First start

```bash
cp .env.example .env
npm install
docker compose config --quiet
docker compose up --build
```

PowerShell copy command:

```powershell
Copy-Item .env.example .env
```

Change the local placeholder secrets before exposing any port beyond the local
machine. The checked-in values are not production credentials.

## Services

| Service       | URL/port                            | Purpose                 |
| ------------- | ----------------------------------- | ----------------------- |
| Web           | <http://localhost:3000>             | Next.js application     |
| API           | <http://localhost:8000>             | FastAPI                 |
| OpenAPI       | <http://localhost:8000/api/v1/docs> | Development API docs    |
| API health    | <http://localhost:8000/health>      | Process liveness        |
| API readiness | <http://localhost:8000/ready>       | Database readiness      |
| PostgreSQL    | `localhost:5432`                    | Authoritative database  |
| Redis         | `localhost:6379`                    | Ephemeral coordination  |
| MinIO         | <http://localhost:9000>             | S3-compatible API       |
| MinIO console | <http://localhost:9001>             | Local object storage UI |
| Print Bridge  | <http://localhost:9100/healthz>     | Mock bridge liveness    |

## Test the QR menu on a phone

Keep the computer and phone on the same trusted Wi-Fi network. In `.env`, set
`DIXORA_BIND_HOST=0.0.0.0`, and replace `localhost` in `WEB_URL`, `API_URL`,
`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL`, `DIXORA_CORS_ORIGINS`, and
`DIXORA_MEDIA_PUBLIC_BASE_URL` with the computer's LAN IP address. Rebuild the
`api` and `web` services, then open `http://<computer-lan-ip>:3000` on the phone.

Windows Defender Firewall may ask for permission on ports 3000 and 8000. Allow
only the private network profile. Restore `DIXORA_BIND_HOST=127.0.0.1` after the
device test; the local credentials in `.env.example` are not safe for an
untrusted network.

## Common commands

```bash
docker compose up --build --detach
docker compose ps
docker compose logs --follow --tail=200
docker compose down
```

Migrations and seed:

```bash
docker compose run --rm api alembic upgrade head
docker compose run --rm api dixora-seed
```

Node packages:

```bash
npm run build
npm run lint
npm run typecheck
npm test
npm run format:check
```

API checks:

```bash
docker compose run --rm api ruff check .
docker compose run --rm api mypy app
docker compose run --rm api pytest
```

The Makefile exposes `up`, `down`, `logs`, `migrate`, `seed`, `lint`,
`typecheck`, `test`, and `check` shortcuts.

## Run applications on the host

Infrastructure only:

```bash
docker compose up --detach postgres redis minio minio-init
```

API:

```bash
cd apps/api
python -m venv .venv
# Activate .venv using the command for your shell.
python -m pip install -e ".[dev]"
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

Host API variables must use host names such as `localhost`, not Compose service
names such as `postgres`.

For media, a host-run API also needs
`DIXORA_S3_ENDPOINT=http://localhost:9000`. Keep
`DIXORA_MEDIA_PUBLIC_BASE_URL=http://localhost:8000/api/v1/media`: this is the
browser-facing API delivery URL, not the private MinIO endpoint.

Web and bridge, from the repository root:

```bash
npm run dev:web
npm run dev:print-bridge
```

For a host bridge, set `PRINT_BRIDGE_API_URL=http://localhost:8000`.

## Data reset

`docker compose down` preserves data volumes. The following permanently removes
local PostgreSQL, Redis, and MinIO data:

```bash
docker compose down --volumes --remove-orphans
```

Confirm that no needed local data remains before running it. Docker volumes are
not backups.

## Troubleshooting

### API remains unhealthy

Inspect API and PostgreSQL logs. A failed Alembic migration prevents Uvicorn
from starting by design:

```bash
docker compose logs api postgres
```

### MinIO init does not complete

Check MinIO credentials match between the server and `minio-init`, then inspect:

```bash
docker compose logs minio minio-init
```

### Print Bridge is healthy but degraded

`/healthz` proves the process is alive. `/readyz` reports whether API polling
succeeds. Inspect bridge/API logs for credential, branch, payload, or network
errors; process liveness alone does not mean printing is ready.

The idempotent development seed enrolls a branch-scoped mock bridge. The default
local token is documented in `.env.example` as
`PRINT_BRIDGE_TOKEN=pb_dev_dixora_lab_bridge_2026`; replace it when creating a fresh
bridge enrollment. Production tokens are returned once, stored only as hashes by
the API, and belong in a managed secret store.

### Port conflict

Change the host-side port in `.env`. Internal Compose ports and service URLs
remain unchanged.

### Dependency audit findings

Run:

```bash
npm audit
```

Review the dependency path and upgrade intentionally. Do not use force fixes
that make breaking framework changes without tests.
