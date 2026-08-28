#!/usr/bin/env bash
# Nightly PostgreSQL dump with retention.
#
#   ./ops/backup.sh                  # writes to ./backups
#   BACKUP_DIR=/mnt/vol ./ops/backup.sh
#
# Schedule from the host crontab, e.g. every night at 03:15:
#   15 3 * * * cd /srv/dixora && set -a && . ./.env && set +a && ./ops/backup.sh \
#     >> /var/log/dixora-backup.log 2>&1

set -euo pipefail

# Git Bash on Windows rewrites container paths like /tmp/x into Windows
# paths before docker sees them. Harmless to set on Linux, where the
# variable is simply ignored.
export MSYS_NO_PATHCONV=1

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
SERVICE="${POSTGRES_SERVICE:-postgres}"

: "${POSTGRES_USER:?POSTGRES_USER must be set (source your .env)}"
: "${POSTGRES_DB:?POSTGRES_DB must be set (source your .env)}"

mkdir -p "$BACKUP_DIR"
stamp="$(date +%Y%m%d-%H%M%S)"
name="dixora-$stamp.dump"
remote="/tmp/$name"

# The dump is written and verified inside the container. A custom-format dump
# has to be seekable to be read back, so it must be a real file — verifying it
# through a pipe fails even when the dump is perfectly good.
docker compose exec -T "$SERVICE" \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner -f "$remote"

if ! docker compose exec -T "$SERVICE" pg_restore --list "$remote" > /dev/null; then
  echo "backup verify FAILED, discarding: $name" >&2
  docker compose exec -T "$SERVICE" rm -f "$remote" || true
  exit 1
fi

docker compose cp "$SERVICE:$remote" "$BACKUP_DIR/$name"
docker compose exec -T "$SERVICE" rm -f "$remote"

size="$(wc -c < "$BACKUP_DIR/$name")"
if [ "$size" -lt 10000 ]; then
  echo "backup suspiciously small (${size} bytes): $name" >&2
  exit 1
fi

echo "ok $BACKUP_DIR/$name ($size bytes)"

find "$BACKUP_DIR" -name 'dixora-*.dump' -mtime "+$RETENTION_DAYS" -delete
