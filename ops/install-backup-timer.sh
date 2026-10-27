#!/usr/bin/env bash
# Run from the checked-out release on the production host as root.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run with sudo on the production host.' >&2; exit 1; }
[[ -f /srv/dixora/.env.production && -f /srv/dixora/ops/backup.py ]] || {
  echo 'Expected the production checkout and environment in /srv/dixora.' >&2; exit 1;
}
[[ -s /etc/dixora/backup.env && -s /etc/dixora/restic-password ]] || {
  echo 'Configure /etc/dixora/backup.env and restic-password first; see docs/operations.md.' >&2; exit 1;
}
command -v restic >/dev/null
/usr/bin/python3 -c 'import sys; assert sys.version_info >= (3, 11)'
runuser -u dixora -- docker info >/dev/null
runuser -u dixora -- test -r /etc/dixora/restic-password
[[ $(stat -c %a /etc/dixora/backup.env) == 600 && $(stat -c %U /etc/dixora/backup.env) == root ]] || {
  echo 'backup.env must be owned by root with mode 600.' >&2; exit 1;
}
[[ $(stat -c %a /etc/dixora/restic-password) == 600 ]] || {
  echo 'restic-password must have mode 600 and be readable by dixora.' >&2; exit 1;
}
install -d -m 700 -o dixora -g dixora /srv/dixora-backups
install -m 644 /srv/dixora/ops/systemd/dixora-backup.service /etc/systemd/system/
install -m 644 /srv/dixora/ops/systemd/dixora-backup.timer /etc/systemd/system/
install -m 644 /srv/dixora/ops/systemd/dixora-alert@.service /etc/systemd/system/
systemd-analyze verify /etc/systemd/system/dixora-backup.service /etc/systemd/system/dixora-backup.timer /etc/systemd/system/dixora-alert@.service
systemctl daemon-reload
# Enable only after an actual quiesced DB/media backup and encrypted upload pass.
systemctl start dixora-backup.service
systemctl enable --now dixora-backup.timer
systemctl is-enabled dixora-backup.timer
systemctl is-active dixora-backup.timer
systemctl list-timers --all dixora-backup.timer
journalctl -u dixora-backup.service -n 20 --no-pager
