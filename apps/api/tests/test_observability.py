from __future__ import annotations

from typing import Any, cast

from app.config import Settings
from app.observability import REDACTED, _before_send, configure_sentry


def _settings(**overrides: Any) -> Settings:
    return Settings(
        environment="test",
        database_url="sqlite+aiosqlite:///:memory:",
        jwt_secret="test-secret-that-is-at-least-thirty-two-characters",
        print_bridge_key="test-legacy-print-key-with-32-chars",
        **overrides,
    )


def test_sentry_stays_disabled_without_a_dsn() -> None:
    """Local development and tests must not ship errors anywhere."""
    assert configure_sentry(_settings()) is False


def test_auth_headers_are_never_reported() -> None:
    event = cast(
        Any,
        {
            "request": {
                "headers": {
                    "Authorization": "Bearer super-secret-token",
                    "Cookie": "dixora_access=abc",
                    "X-Print-Bridge-Key": "pb_live_secret",
                    "User-Agent": "Dixora/1.0",
                },
                "cookies": {"dixora_refresh": "leaked"},
            }
        },
    )
    scrubbed = cast(Any, _before_send(event, cast(Any, {})))
    headers = scrubbed["request"]["headers"]

    assert headers["Authorization"] == REDACTED
    assert headers["Cookie"] == REDACTED
    assert headers["X-Print-Bridge-Key"] == REDACTED
    # Harmless diagnostics survive.
    assert headers["User-Agent"] == "Dixora/1.0"
    # Cookies are dropped wholesale.
    assert "cookies" not in scrubbed["request"]


def test_passwords_and_customer_data_are_scrubbed_from_payloads() -> None:
    event = cast(
        Any,
        {
            "request": {
                "data": {
                    "username": "owner@dixora.test",
                    "password": "DixoraLab!2026",
                    "new_password": "Str0ng!",
                    "nested": {"pin": "1357", "phone": "+90 555 000 00 00"},
                }
            },
            "extra": {"refresh_token": "rt_secret", "order_id": "abc"},
        },
    )
    scrubbed = cast(Any, _before_send(event, cast(Any, {})))
    data = scrubbed["request"]["data"]

    assert data["password"] == REDACTED
    assert data["new_password"] == REDACTED
    assert data["nested"]["pin"] == REDACTED
    assert data["nested"]["phone"] == REDACTED
    assert scrubbed["extra"]["refresh_token"] == REDACTED
    # Non-sensitive context is preserved so reports stay useful.
    assert data["username"] == "owner@dixora.test"
    assert scrubbed["extra"]["order_id"] == "abc"


def test_scrubbing_survives_unexpected_shapes() -> None:
    """A malformed event must not crash the reporter."""
    event = cast(Any, {"request": "not-a-dict", "extra": [1, 2, 3]})
    assert _before_send(event, cast(Any, {})) is not None
