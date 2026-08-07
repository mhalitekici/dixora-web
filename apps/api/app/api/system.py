from __future__ import annotations

from fastapi import APIRouter, Request, status
from fastapi.responses import JSONResponse

router = APIRouter(tags=["system"])


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "dixora-api"}


@router.get("/ready")
async def readiness(request: Request) -> JSONResponse:
    database_ready = await request.app.state.database.ping()
    return JSONResponse(
        status_code=status.HTTP_200_OK if database_ready else status.HTTP_503_SERVICE_UNAVAILABLE,
        content={"status": "ready" if database_ready else "not_ready", "database": database_ready},
    )
