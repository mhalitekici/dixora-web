from __future__ import annotations

import hashlib
import hmac
from datetime import UTC, datetime, timedelta

from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.errors import DomainError
from app.models import LoyaltyVerificationRateLimit
from app.models.base import utcnow


def verification_token_hash(token: str) -> str:
    """Hash the high-entropy signed token before persisting it."""

    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def verification_private_hash(settings: Settings, value: str) -> str:
    """Create a non-reversible, installation-specific lookup value."""

    return hmac.new(
        settings.jwt_secret.get_secret_value().encode("utf-8"),
        value.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


async def consume_verification_rate_limit(
    db: AsyncSession,
    *,
    settings: Settings,
    scope: str,
    limit: int,
    window_seconds: int,
    message: str,
) -> int:
    """Atomically consume one fixed-window allowance for SQLite or PostgreSQL."""

    now = utcnow()
    bucket_epoch = int(now.timestamp()) // window_seconds * window_seconds
    bucket_start = datetime.fromtimestamp(bucket_epoch, tz=UTC)
    expires_at = bucket_start + timedelta(seconds=window_seconds * 2)
    scope_hash = verification_private_hash(settings, scope)
    values = {
        "scope_hash": scope_hash,
        "bucket_start": bucket_start,
        "attempts": 1,
        "expires_at": expires_at,
    }
    dialect = db.get_bind().dialect.name
    if dialect == "postgresql":
        postgres_insert = postgresql_insert(LoyaltyVerificationRateLimit).values(**values)
        postgres_statement = postgres_insert.on_conflict_do_update(
            index_elements=["scope_hash", "bucket_start"],
            set_={
                "attempts": LoyaltyVerificationRateLimit.attempts + 1,
                "expires_at": expires_at,
            },
        ).returning(LoyaltyVerificationRateLimit.attempts)
        attempts = int((await db.execute(postgres_statement)).scalar_one())
    elif dialect == "sqlite":
        sqlite_insert_statement = sqlite_insert(LoyaltyVerificationRateLimit).values(**values)
        sqlite_statement = sqlite_insert_statement.on_conflict_do_update(
            index_elements=["scope_hash", "bucket_start"],
            set_={
                "attempts": LoyaltyVerificationRateLimit.attempts + 1,
                "expires_at": expires_at,
            },
        ).returning(LoyaltyVerificationRateLimit.attempts)
        attempts = int((await db.execute(sqlite_statement)).scalar_one())
    else:  # pragma: no cover - production and tests use PostgreSQL/SQLite.
        raise RuntimeError(f"Unsupported rate-limit database dialect: {dialect}")
    if attempts > limit:
        retry_after = max(
            1,
            int(
                (
                    bucket_start + timedelta(seconds=window_seconds) - now
                ).total_seconds()
            ),
        )
        raise DomainError(
            "loyalty_verification_rate_limited",
            message,
            status_code=429,
            details={"retry_after_seconds": retry_after},
        )
    return attempts
