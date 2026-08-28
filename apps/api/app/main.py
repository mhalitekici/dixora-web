from __future__ import annotations

import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.api.system import router as system_router
from app.config import Settings, get_settings
from app.db import Database
from app.errors import register_error_handlers
from app.logging import bind_request_context, configure_logging, logger
from app.observability import configure_sentry
from app.realtime import RealtimeBroadcaster, RealtimeHub, RedisRealtimeHub
from app.services.rate_limit import close_rate_limiter
from app.services.media_storage import MediaStorage, create_media_storage


def create_app(
    settings: Settings | None = None,
    database: Database | None = None,
    media_storage: MediaStorage | None = None,
) -> FastAPI:
    app_settings = settings or get_settings()
    configure_logging(app_settings.log_level)
    app_database = database or Database(app_settings)
    app_media_storage = media_storage or create_media_storage(app_settings)

    sentry_enabled = configure_sentry(app_settings)

    # Redis-backed fan-out is what makes multiple API workers safe; without a
    # Redis URL the process-local hub keeps single-worker deployments working
    # exactly as before.
    realtime: RealtimeBroadcaster
    if app_settings.redis_url:
        realtime = RedisRealtimeHub(app_settings.redis_url)
    else:
        realtime = RealtimeHub()

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        if app_settings.auto_create_schema:
            await app_database.create_schema()
        if isinstance(realtime, RedisRealtimeHub):
            await realtime.start()
        logger.info(
            "application.started",
            environment=app_settings.environment,
            database_backend=app_database.engine.url.get_backend_name(),
            realtime_backend="redis" if app_settings.redis_url else "in-process",
            error_reporting="sentry" if sentry_enabled else "disabled",
        )
        yield
        if isinstance(realtime, RedisRealtimeHub):
            await realtime.stop()
        await close_rate_limiter()
        await app_database.dispose()
        logger.info("application.stopped")

    application = FastAPI(
        title=app_settings.app_name,
        version="0.1.0",
        openapi_url=f"{app_settings.api_prefix}/openapi.json",
        docs_url=f"{app_settings.api_prefix}/docs",
        redoc_url=f"{app_settings.api_prefix}/redoc",
        lifespan=lifespan,
    )
    application.state.settings = app_settings
    application.state.database = app_database
    application.state.media_storage = app_media_storage
    application.state.realtime = realtime
    application.add_middleware(
        CORSMiddleware,
        allow_origins=app_settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @application.middleware("http")
    async def request_context(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        started = time.perf_counter()
        incoming_id = request.headers.get("x-request-id", "")
        request_id = incoming_id[:100] if incoming_id and incoming_id.isprintable() else uuid4().hex
        request.state.request_id = request_id
        bind_request_context(
            request_id=request_id,
            method=request.method,
            path=request.url.path,
        )
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        logger.info(
            "http.request",
            status_code=response.status_code,
            duration_ms=round((time.perf_counter() - started) * 1000, 2),
        )
        return response

    register_error_handlers(application)
    application.include_router(system_router)
    application.include_router(api_router, prefix=app_settings.api_prefix)
    return application


app = create_app()
