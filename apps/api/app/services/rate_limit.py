from __future__ import annotations

import hashlib
import logging
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING

from app.config import Settings

if TYPE_CHECKING:
    from redis.asyncio import Redis

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class RateLimitResult:
    allowed: bool
    retry_after_seconds: int


def limiter_key(*parts: str) -> str:
    """Hash the identifying parts so raw emails never sit in Redis keys."""
    digest = hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()
    return f"dixora:rl:{digest}"


class _InProcessWindows:
    """Fallback counter for local development and tests.

    Per-process only, so it is not a real limit behind multiple workers — but it
    keeps the behaviour testable and still blocks a naive loop. Production is
    expected to have Redis configured.
    """

    def __init__(self) -> None:
        self._hits: dict[str, list[float]] = {}

    def hit(self, key: str, limit: int, window_seconds: int) -> RateLimitResult:
        now = time.monotonic()
        cutoff = now - window_seconds
        bucket = [stamp for stamp in self._hits.get(key, []) if stamp > cutoff]
        bucket.append(now)
        self._hits[key] = bucket
        if len(bucket) > limit:
            oldest = min(bucket)
            return RateLimitResult(False, max(1, int(window_seconds - (now - oldest))))
        return RateLimitResult(True, 0)


_fallback = _InProcessWindows()


class RateLimiter:
    """Fixed-window counter, shared across workers when Redis is configured."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._redis: Redis | None = None

    async def _client(self) -> Redis | None:
        if not self._settings.redis_url:
            return None
        if self._redis is None:
            from redis.asyncio import Redis

            self._redis = Redis.from_url(
                self._settings.redis_url, decode_responses=True
            )
        return self._redis

    async def hit(self, key: str, *, limit: int, window_seconds: int) -> RateLimitResult:
        client = await self._client()
        if client is None:
            return _fallback.hit(key, limit, window_seconds)
        try:
            count = int(await client.incr(key))
            if count == 1:
                await client.expire(key, window_seconds)
            if count > limit:
                ttl = int(await client.ttl(key))
                return RateLimitResult(False, ttl if ttl > 0 else window_seconds)
            return RateLimitResult(True, 0)
        except Exception:
            # A Redis outage must not take signup down; fall back to the local
            # window rather than letting the request through unmetered.
            logger.warning("rate_limit.redis_unavailable", exc_info=True)
            return _fallback.hit(key, limit, window_seconds)

    async def close(self) -> None:
        if self._redis is not None:
            try:
                await self._redis.aclose()
            finally:
                self._redis = None


_shared: RateLimiter | None = None


def get_rate_limiter(settings: Settings) -> RateLimiter:
    """Return the process-wide limiter.

    Constructing one per request opened a fresh Redis connection pool every
    time and never closed it, so signup traffic leaked connections until the
    server ran out. The counters are in Redis, not in the object, so a single
    shared instance is also the correct scope.
    """
    global _shared
    if _shared is None:
        _shared = RateLimiter(settings)
    return _shared


async def close_rate_limiter() -> None:
    """Release the shared connection pool on shutdown."""
    global _shared
    if _shared is not None:
        await _shared.close()
        _shared = None


def reset_fallback_state() -> None:
    """Test hook: clears the in-process windows between cases."""
    _fallback._hits.clear()
