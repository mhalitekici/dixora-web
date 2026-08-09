from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from app.config import Settings

if TYPE_CHECKING:
    from sentry_sdk.types import Event, Hint

logger = logging.getLogger(__name__)

# Request headers that must never leave the building with an error report.
_SENSITIVE_HEADERS = {
    "authorization",
    "cookie",
    "set-cookie",
    "x-print-bridge-key",
    "x-print-bridge-token",
    "x-api-key",
}

# Body/context keys that would carry credentials or customer PII.
_SENSITIVE_KEYS = {
    "password",
    "current_password",
    "new_password",
    "temporary_password",
    "pin",
    "token",
    "access_token",
    "refresh_token",
    "refresh_jti_hash",
    "password_hash",
    "pin_hash",
    "secret",
    "api_key",
    "translation_api_key",
    "jwt_secret",
    "card",
    "card_number",
    "phone",
    "email",
}

REDACTED = "[redacted]"


def _scrub(value: Any, depth: int = 0) -> Any:
    """Recursively redact anything that looks like a credential or PII."""
    if depth > 6:
        return value
    if isinstance(value, dict):
        return {
            key: (
                REDACTED
                if isinstance(key, str) and key.lower() in _SENSITIVE_KEYS
                else _scrub(item, depth + 1)
            )
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_scrub(item, depth + 1) for item in value]
    return value


def _before_send(event: Event, _hint: Hint) -> Event:
    request = event.get("request")
    if isinstance(request, dict):
        headers = request.get("headers")
        if isinstance(headers, dict):
            request["headers"] = {
                name: (REDACTED if name.lower() in _SENSITIVE_HEADERS else value)
                for name, value in headers.items()
            }
        # Query strings can carry tokens (e.g. realtime tickets); drop the values.
        request.pop("cookies", None)
        if isinstance(request.get("data"), dict | list):
            request["data"] = _scrub(request["data"])
    for section in ("extra", "contexts", "tags"):
        if isinstance(event.get(section), dict):
            event[section] = _scrub(event[section])
    return event


def configure_sentry(settings: Settings) -> bool:
    """Enable error reporting when a DSN is configured.

    Returns whether Sentry was initialised. Absent DSN is the normal case for
    local development and tests, and must stay a silent no-op.
    """
    dsn = settings.sentry_dsn.get_secret_value().strip() if settings.sentry_dsn else ""
    if not dsn:
        return False
    try:
        import sentry_sdk
    except ImportError:
        logger.warning("sentry.sdk_missing")
        return False

    sentry_sdk.init(
        dsn=dsn,
        environment=settings.environment,
        release=settings.sentry_release,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        # PII must be opt-in-never here: receipts, customer names and phone
        # numbers all flow through this API.
        send_default_pii=False,
        before_send=_before_send,
    )
    return True
