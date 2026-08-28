"""Token time claims must survive a small clock disagreement.

A verifying clock reading a moment behind the issuing one used to reject a
freshly minted token as "not yet valid (iat)". It surfaced as a random logout,
and it will happen on any NTP correction or between workers that are not in
perfect step.
"""

from __future__ import annotations

from datetime import timedelta

import jwt
import pytest

from app.config import Settings
from app.errors import DomainError
from app.security import CLOCK_SKEW_LEEWAY, decode_token, utcnow


def _settings() -> Settings:
    return Settings(
        environment="test",
        database_url="sqlite+aiosqlite:///:memory:",
        jwt_secret="test-secret-that-is-at-least-thirty-two-characters",
        print_bridge_key="test-legacy-print-key-with-32-chars",
    )


def _token(settings: Settings, **claims: object) -> str:
    payload = {
        "sub": "11111111-1111-1111-1111-111111111111",
        "typ": "access",
        "iss": "dixora-api",
        "aud": "dixora-app",
        "iat": utcnow(),
        "nbf": utcnow(),
        "exp": utcnow() + timedelta(minutes=15),
    }
    payload.update(claims)
    return jwt.encode(
        payload,
        settings.jwt_secret.get_secret_value(),
        algorithm=settings.jwt_algorithm,
    )


def test_a_token_stamped_slightly_ahead_is_still_accepted() -> None:
    settings = _settings()
    ahead = utcnow() + timedelta(seconds=5)
    token = _token(settings, iat=ahead, nbf=ahead)
    assert decode_token(settings, token)["typ"] == "access"


def test_a_token_far_in_the_future_is_still_refused() -> None:
    """The tolerance is for clock jitter, not for forged timestamps."""
    settings = _settings()
    ahead = utcnow() + CLOCK_SKEW_LEEWAY + timedelta(minutes=5)
    token = _token(settings, iat=ahead, nbf=ahead)
    with pytest.raises(DomainError) as excinfo:
        decode_token(settings, token)
    assert excinfo.value.code == "invalid_token"


def test_an_expired_token_is_still_refused() -> None:
    """Leeway must not quietly extend a session past its expiry."""
    settings = _settings()
    stale = utcnow() - timedelta(minutes=30)
    token = _token(
        settings,
        iat=stale,
        nbf=stale,
        exp=stale + timedelta(minutes=15),
    )
    with pytest.raises(DomainError) as excinfo:
        decode_token(settings, token)
    assert excinfo.value.code == "token_expired"
