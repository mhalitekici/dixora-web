#!/usr/bin/env bash
# Restore a dump produced by ops/backup.sh.
#
#   ./ops/restore.sh backups/dixora-20260813-031500.dump          # into a scratch db
#   TARGET_DB=dixora ./ops/restore.sh backups/....dump --force    # over the live db
#
# Run this on a schedule too, not only during an incident: a backup nobody has
# ever restored is not a backup.

set -euo pipefail

# Git Bash on Windows rewrites container paths like /tmp/x into Windows
# paths before docker sees them. Harmless to set on Linux, where the
# variable is simply ignored.
export MSYS_NO_PATHCONV=1

dump="${1:?usage: restore.sh <dump-file> [--force]}"
force="${2:-}"
SERVICE="${POSTGRES_SERVICE:-postgres}"
TARGET_DB="${TARGET_DB:-dixora_restore_check}"

: "${POSTGRES_USER:?POSTGRES_USER must be set (source your .env)}"
: "${POSTGRES_DB:?POSTGRES_DB must be set (source your .env)}"

if [ "$TARGET_DB" = "$POSTGRES_DB" ] && [ "$force" != "--force" ]; then
  echo "refusing to overwrite the live database '$POSTGRES_DB' without --force" >&2
  exit 1
fi

remote="/tmp/restore-$(basename "$dump")"
docker compose cp "$dump" "$SERVICE:$remote"

docker compose exec -T "$SERVICE" psql -U "$POSTGRES_USER" -d postgres \
  -c "DROP DATABASE IF EXISTS $TARGET_DB;" -c "CREATE DATABASE $TARGET_DB;" > /dev/null

docker compose exec -T "$SERVICE" \
  pg_restore -U "$POSTGRES_USER" -d "$TARGET_DB" --no-owner "$remote"

docker compose exec -T "$SERVICE" rm -f "$remote"

# Report what actually landed, so restoring an empty dump looks like the
# failure it is instead of a clean exit code.
docker compose exec -T "$SERVICE" psql -U "$POSTGRES_USER" -d "$TARGET_DB" -t -A -c \
  "select 'tenants=' || (select count(*) from tenants)
       || ' orders=' || (select count(*) from orders)
       || ' payments=' || (select count(*) from payments);"
