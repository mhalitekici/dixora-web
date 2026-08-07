from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.config import Settings
from app.db import Database
from app.main import create_app
from app.seed import seed_database
from app.services.media_storage import InMemoryMediaStorage


@dataclass
class ApiContext:
    client: AsyncClient
    database: Database
    settings: Settings
    app: Any
    media_storage: InMemoryMediaStorage


@pytest_asyncio.fixture
async def api() -> ApiContext:
    settings = Settings(
        environment="test",
        database_url="sqlite+aiosqlite:///:memory:",
        jwt_secret="test-secret-that-is-at-least-thirty-two-characters",
        print_bridge_key="test-legacy-print-key-with-32-chars",
        dev_seed_enabled=True,
        pin_login_enabled=True,
        auto_create_schema=False,
        log_level="WARNING",
        media_public_base_url="http://test/api/v1/media",
    )
    database = Database(settings)
    await database.create_schema()
    async with database.session_factory() as session:
        await seed_database(session)
    media_storage = InMemoryMediaStorage()
    app = create_app(settings, database, media_storage=media_storage)
    client = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    try:
        yield ApiContext(
            client=client,
            database=database,
            settings=settings,
            app=app,
            media_storage=media_storage,
        )
    finally:
        await client.aclose()
        await database.dispose()


async def login(
    api: ApiContext,
    username: str = "owner@dixora.test",
    password: str = "DixoraLab!2026",
    business: str | None = "dixora-lab",
) -> dict[str, Any]:
    response = await api.client.post(
        "/api/v1/auth/login",
        json={"business": business, "username": username, "password": password},
    )
    assert response.status_code == 200, response.text
    return response.json()


def auth_headers(tokens: dict[str, Any]) -> dict[str, str]:
    return {"Authorization": f"Bearer {tokens['access_token']}"}


async def seeded_resources(api: ApiContext, headers: dict[str, str]) -> dict[str, Any]:
    tables_response = await api.client.get("/api/v1/tables", headers=headers)
    products_response = await api.client.get("/api/v1/catalog/products", headers=headers)
    assert tables_response.status_code == 200
    assert products_response.status_code == 200
    products = products_response.json()["items"]
    return {
        "tables": tables_response.json(),
        "products": products,
        "burger": next(item for item in products if item["name"] == "Classic Burger"),
    }
