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
    assert "data" not in scrubbed["request"]
    assert scrubbed["extra"]["refresh_token"] == REDACTED
    # Non-sensitive context is preserved so reports stay useful.
    assert scrubbed["extra"]["order_id"] == "abc"


def test_scrubbing_survives_unexpected_shapes() -> None:
    """A malformed event must not crash the reporter."""
    event = cast(Any, {"request": "not-a-dict", "extra": [1, 2, 3]})
    assert _before_send(event, cast(Any, {})) is not None


def test_query_tokens_raw_bodies_and_exception_locals_never_leave_the_reporter() -> None:
    event = cast(
        Any,
        {
            "request": {
                "url": "https://example.test/ws?ticket=secret",
                "query_string": "pin=1357",
                "data": '{"password":"secret"}',
            },
            "user": {"email": "private@example.test"},
            "breadcrumbs": [{"message": "customer input"}],
            "exception": {
                "values": [
                    {
                        "value": "SQL parameters including secrets",
                        "stacktrace": {"frames": [{"vars": {"pin": "1357"}, "lineno": 1}]},
                    }
                ]
            },
        },
    )
    scrubbed = cast(Any, _before_send(event, cast(Any, {})))
    assert scrubbed["request"] == {}
    assert "user" not in scrubbed and "breadcrumbs" not in scrubbed
    assert scrubbed["exception"]["values"][0]["value"] == REDACTED
    assert "vars" not in scrubbed["exception"]["values"][0]["stacktrace"]["frames"][0]


def test_transport_logs_do_not_capture_websocket_query_tickets() -> None:
    import logging

    from app.logging import TransportPrivacyFilter

    record = logging.LogRecord(
        "uvicorn.error",
        logging.INFO,
        "",
        1,
        "WebSocket /api/v1/ws?ticket=secret [accepted]",
        (),
        None,
    )
    assert TransportPrivacyFilter().filter(record) is False


def test_resend_requires_an_api_key_in_every_environment() -> None:
    """Selecting a provider without its credential can never work."""
    import pytest

    # The key is pinned to None rather than left to the environment: inside the
    # deployed container a real DIXORA_RESEND_API_KEY is present, which silently
    # satisfied the requirement and made this test assert nothing.
    with pytest.raises(Exception, match="RESEND_API_KEY"):
        _settings(email_provider="resend", resend_api_key=None)


def test_resend_is_selected_when_configured() -> None:
    from app.services.email import ResendEmailSender, get_email_sender

    sender = get_email_sender(_settings(email_provider="resend", resend_api_key="re_test_key"))
    assert isinstance(sender, ResendEmailSender)
    assert sender.mode == "RESEND"


def test_masked_contact_survives_a_customer_without_a_phone() -> None:
    """Email-enrolled members have no phone; the admin list must not crash."""
    from app.services.loyalty import mask_contact

    assert mask_contact(email="ahmet@example.com", phone=None) == "a***t@example.com"
    assert mask_contact(email=None, phone="+905551112233") == "+905***2233"
    assert mask_contact(email=None, phone=None) == "—"
