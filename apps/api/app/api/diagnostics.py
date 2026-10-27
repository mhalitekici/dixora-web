from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field

from app.dependencies import CurrentIdentity
from app.errors import DomainError
from app.logging import logger
from app.services.rate_limit import get_rate_limiter, limiter_key

router = APIRouter(prefix="/diagnostics", tags=["diagnostics"])


class FrontendIncident(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["react_boundary", "unhandled_error", "unhandled_rejection"]
    screen: Literal["admin", "waiter", "cashier", "other"]
    digest: str | None = Field(default=None, pattern=r"^[a-zA-Z0-9_-]{1,64}$")


@router.post("/frontend-errors", status_code=202)
async def frontend_incident(
    payload: FrontendIncident,
    identity: CurrentIdentity,
    request: Request,
) -> dict[str, bool]:
    limiter = get_rate_limiter(request.app.state.settings)
    limited = await limiter.hit(
        limiter_key("frontend-incident", str(identity.session_id)),
        limit=10,
        window_seconds=60,
    )
    if not limited.allowed:
        raise DomainError("rate_limited", "Too many incident reports", status_code=429)
    # Never accept messages, stack traces, URLs, arbitrary context or customer
    # values from the browser. Correlate only with the server request ID.
    logger.error("frontend.incident", **payload.model_dump(exclude_none=True))
    return {"accepted": True}
