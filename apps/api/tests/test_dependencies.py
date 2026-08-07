from __future__ import annotations

from collections.abc import AsyncGenerator
from types import SimpleNamespace
from typing import cast

from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db

from .conftest import ApiContext


async def test_database_dependency_returns_connection_before_generator_closes(
    api: ApiContext,
) -> None:
    connection_events: list[str] = []
    engine = api.database.engine.sync_engine

    def record_checkout(*_: object) -> None:
        connection_events.append("checkout")

    def record_checkin(*_: object) -> None:
        connection_events.append("checkin")

    event.listen(engine, "checkout", record_checkout)
    event.listen(engine, "checkin", record_checkin)
    request = SimpleNamespace(
        app=SimpleNamespace(state=SimpleNamespace(database=api.database))
    )
    dependency = cast(
        AsyncGenerator[AsyncSession, None],
        get_db(request),  # type: ignore[arg-type]
    )

    try:
        session = await anext(dependency)
        await session.execute(text("SELECT 1"))
    finally:
        await dependency.aclose()
        event.remove(engine, "checkout", record_checkout)
        event.remove(engine, "checkin", record_checkin)

    assert connection_events == ["checkout", "checkin"]
