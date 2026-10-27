"""Persisted command fingerprints and transaction-scoped PostgreSQL serialization."""

from __future__ import annotations

import hashlib
import json
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import DomainError


def request_fingerprint(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def require_same_request(previous: str | None, current: str) -> None:
    # Old rows have no fingerprint. Do not invent one from mutable order state.
    if previous is not None and previous != current:
        raise DomainError(
            "idempotency_conflict",
            "İşlem anahtarı farklı bir istek için kullanılmış",
            status_code=409,
        )


async def lock_command(db: AsyncSession, tenant_id: UUID, namespace: str, key: str) -> None:
    """Serialize identical commands across API workers until commit/rollback.

    Unique constraints remain the final invariant. Hash collisions merely serialize
    unrelated requests; no identity or authorization decision uses this hash.
    SQLite tests rely on their single-writer database instead.
    """
    if db.get_bind().dialect.name == "postgresql":
        digest = hashlib.sha256(f"{tenant_id}:{namespace}:{key}".encode()).digest()
        lock_id = int.from_bytes(digest[:8], "big", signed=True)
        await db.execute(select(func.pg_advisory_xact_lock(lock_id)))
