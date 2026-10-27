"""One-shot, read-only alert checks. Exit 1 means operator attention is required.

The JSON output can be consumed by a scheduler/alert manager. No notifications
are sent, and no production credentials or services are modified.
"""

from __future__ import annotations

import argparse
import json
import os
from datetime import UTC, datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request


def backup_alerts(receipt: Path, *, now: datetime, max_age_hours: float = 26) -> list[str]:
    try:
        data = json.loads(receipt.read_text(encoding="utf-8"))
        stamp = datetime.fromisoformat(data["completed_at"])
        if stamp.tzinfo is None:
            return ["backup_receipt_invalid"]
        age = (now - stamp).total_seconds()
        alerts = []
        if age < -300 or age > max_age_hours * 3600:
            alerts.append("backup_stale")
        if data.get("offsite_verified") is not True:
            alerts.append("backup_offsite_unverified")
        if data.get("writers_quiesced") is not True:
            alerts.append("backup_consistency_unverified")
        return alerts
    except (OSError, ValueError, KeyError, TypeError):
        return ["backup_receipt_missing_or_invalid"]


def read_json(url: str, token: str | None = None) -> dict:
    parsed = urlsplit(url)
    if parsed.username or parsed.password or parsed.scheme not in {"http", "https"}:
        raise ValueError("Use a plain HTTP(S) monitoring URL without embedded credentials")
    if (
        token
        and parsed.scheme != "https"
        and parsed.hostname not in {"localhost", "127.0.0.1", "::1"}
    ):
        raise ValueError("Remote monitoring credentials require HTTPS")
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(url, headers=headers)
    # Never send credentials to a redirected host.
    import urllib.request

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None

    with urllib.request.build_opener(NoRedirect).open(request, timeout=8) as response:
        return json.load(response)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--backup-receipt", type=Path, required=True)
    parser.add_argument("--bridge-url", help="Optional local Print Bridge healthz URL")
    args = parser.parse_args()
    alerts = backup_alerts(args.backup_receipt, now=datetime.now(UTC))
    try:
        if read_json(args.base_url.rstrip("/") + "/ready").get("status") != "ready":
            alerts.append("api_not_ready")
    except (HTTPError, URLError, OSError, ValueError):
        alerts.append("api_not_ready")
    token_file = os.environ.get("DIXORA_MONITOR_TOKEN_FILE")
    if token_file:
        try:
            token = Path(token_file).read_text(encoding="utf-8").strip()
            queue = read_json(args.base_url.rstrip("/") + "/api/v1/printing/health", token)
            if queue.get("status") != "ok":
                alerts.append("printing_degraded")
        except (HTTPError, URLError, OSError, ValueError):
            alerts.append("printing_probe_failed")
    else:
        alerts.append("printing_probe_not_configured")
    if args.bridge_url:
        try:
            bridge = read_json(args.bridge_url)
            if bridge.get("status") != "ok" or bridge.get("lastError"):
                alerts.append("bridge_degraded")
        except (HTTPError, URLError, OSError, ValueError):
            alerts.append("bridge_unavailable")
    print(json.dumps({"checked_at": datetime.now(UTC).isoformat(), "alerts": alerts}))
    return int(bool(alerts))


if __name__ == "__main__":
    raise SystemExit(main())
