from __future__ import annotations

import logging

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError


def _serializable_validation_errors(exc: RequestValidationError) -> list[dict[str, Any]]:
    """Flatten pydantic errors into something JSON can actually encode.

    A validator that raises `ValueError` puts the exception object itself into
    the error's `ctx`, and `input` may be any arbitrary payload. Serialising
    those directly turns a 422 into a 500, so anything that is not a plain JSON
    value is rendered as text.
    """

    def plain(value: Any) -> Any:
        if value is None or isinstance(value, str | int | float | bool):
            return value
        if isinstance(value, dict):
            return {str(key): plain(item) for key, item in value.items()}
        if isinstance(value, list | tuple):
            return [plain(item) for item in value]
        return str(value)

    return [
        {key: plain(value) for key, value in error.items() if key != "url"}
        for error in exc.errors()
    ]


class DomainError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int = 400,
        details: Any | None = None,
    ) -> None:
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details
        super().__init__(message)


def error_payload(request: Request, code: str, message: str, details: Any = None) -> dict[str, Any]:
    return {
        "error": {"code": code, "message": message, "details": details},
        "request_id": getattr(request.state, "request_id", None),
    }


logger = logging.getLogger(__name__)


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(DomainError)
    async def domain_error_handler(request: Request, exc: DomainError) -> JSONResponse:
        if exc.status_code == 401:
            # Authentication rejections are worth a trace: without the specific
            # code, every one of them looks alike from the outside.
            logger.warning(
                "auth.rejected code=%s path=%s", exc.code, request.url.path
            )
        return JSONResponse(
            status_code=exc.status_code,
            content=error_payload(request, exc.code, exc.message, exc.details),
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content=error_payload(
                request,
                "validation_error",
                "Request validation failed",
                _serializable_validation_errors(exc),
            ),
        )

    @app.exception_handler(IntegrityError)
    async def integrity_error_handler(request: Request, _: IntegrityError) -> JSONResponse:
        return JSONResponse(
            status_code=409,
            content=error_payload(
                request,
                "conflict",
                "The operation conflicts with existing data",
            ),
        )
