#!/usr/bin/env bash
# PostgreSQL + MinIO bundle. Compose reads .env; do not source credentials in shell.
# BACKUP_DIR=/mnt/backups ./ops/backup.sh --quiesce
set -euo pipefail
export MSYS_NO_PATHCONV=1
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
python_bin="${PYTHON_BIN:-python3}"
if ! command -v "$python_bin" >/dev/null 2>&1; then python_bin=python; fi
exec "$python_bin" "$script_dir/backup.py" create "$@"
