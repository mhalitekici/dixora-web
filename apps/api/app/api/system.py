from __future__ import annotations

import asyncio
from collections.abc import Awaitable

from fastapi import APIRouter, Request, status
from fastapi.responses import JSONResponse
from redis.asyncio import Redis

router = APIRouter(tags=["system"])


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "dixora-api"}


@router.get("/ready")
async def readiness(request: Request) -> JSONResponse:
    settings = request.app.state.settings

    async def redis_ready() -> bool:
        if not settings.redis_url:
            return True
        client = Redis.from_url(settings.redis_url, socket_connect_timeout=1, socket_timeout=1)
        try:
            return bool(await client.ping())
        finally:
            await client.aclose()

    async def checked(probe: Awaitable[bool]) -> bool:
        try:
            return await asyncio.wait_for(probe, timeout=4.0)
        except Exception:
            return False

    database_ready, redis_status, media_ready = await asyncio.gather(
        checked(request.app.state.database.ping()),
        checked(redis_ready()),
        checked(request.app.state.media_storage.ping()),
    )
    ready = database_ready and redis_status and media_ready
    return JSONResponse(
        status_code=status.HTTP_200_OK if ready else status.HTTP_503_SERVICE_UNAVAILABLE,
        content={
            "status": "ready" if ready else "not_ready",
            "database": database_ready,
            "redis": redis_status if settings.redis_url else "not_configured",
            "media": media_ready,
        },
    )
