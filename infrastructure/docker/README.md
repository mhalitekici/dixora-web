# Docker infrastructure

Docker Compose is the supported local orchestration path. Its API development
image installs test, lint, and type-check tools so `make check` can run inside
the same container. `apps/api/Dockerfile` remains the smaller runtime-oriented
application image. The Print Bridge image stays next to its app, while the web
image builds here from the monorepo root so it can consume shared workspaces.

`postgres/init/001-enable-extensions.sql` runs only when PostgreSQL initializes a
new data volume. Alembic remains the only owner of application schema changes.

The MinIO images currently use the moving `latest` tag for local development.
Before a release or shared staging environment, pin tested immutable image
digests for MinIO and every other service and record the update process in an
architecture decision.
