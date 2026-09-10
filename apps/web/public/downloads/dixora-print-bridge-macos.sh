#!/bin/sh
set -eu

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
INSTALLER="$SCRIPT_DIRECTORY/scripts/install-macos.sh"

if [ ! -f "$INSTALLER" ]; then
  printf '%s\n' 'Taşınabilir Print Bridge paketi bulunamadı. Bu betiği release/dixora-print-bridge klasörü içinden çalıştırın.' >&2
  exit 1
fi

exec "$INSTALLER" "$@"
