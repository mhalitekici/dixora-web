from __future__ import annotations

import contextvars
import importlib
import json
import logging
import sys
from datetime import UTC, datetime
from typing import Any

try:
    _structlog: Any = importlib.import_module("structlog")
except ModuleNotFoundError as exc:  # pragma: no cover - exercised in minimal deployments
    if exc.name != "structlog":
        raise
    _structlog = None

structlog = _structlog

_request_context: contextvars.ContextVar[dict[str, object] | None] = contextvars.ContextVar(
    "request_context", default=None
)


def configure_logging(level: str = "INFO") -> None:
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=getattr(logging, level.upper(), logging.INFO),
        force=True,
    )
    if structlog is not None:
        structlog.configure(
            processors=[
                structlog.contextvars.merge_contextvars,
                structlog.stdlib.add_log_level,
                structlog.processors.TimeStamper(fmt="iso", utc=True),
                structlog.processors.StackInfoRenderer(),
                structlog.processors.format_exc_info,
                structlog.processors.JSONRenderer(),
            ],
            wrapper_class=structlog.make_filtering_bound_logger(
                getattr(logging, level.upper(), logging.INFO)
            ),
            logger_factory=structlog.PrintLoggerFactory(),
            cache_logger_on_first_use=True,
        )


def bind_request_context(**values: object) -> None:
    _request_context.set(values)
    if structlog is not None:
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(**values)


class _FallbackLogger:
    def _write(self, level: int, event: str, **values: Any) -> None:
        payload = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": logging.getLevelName(level).lower(),
            "event": event,
            **(_request_context.get() or {}),
            **values,
        }
        logging.getLogger("dixora.api").log(level, json.dumps(payload, default=str))

    def info(self, event: str, **values: Any) -> None:
        self._write(logging.INFO, event, **values)

    def warning(self, event: str, **values: Any) -> None:
        self._write(logging.WARNING, event, **values)

    def error(self, event: str, **values: Any) -> None:
        self._write(logging.ERROR, event, **values)


logger = structlog.get_logger("dixora.api") if structlog is not None else _FallbackLogger()
