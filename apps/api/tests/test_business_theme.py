"""The colour scheme a business pins for its guest and staff screens."""

from __future__ import annotations

from sqlalchemy import select

from app.models import Tenant
from app.models.enums import ThemeMode
from tests.conftest import ApiContext, auth_headers, login


async def _owner_headers(api: ApiContext) -> dict[str, str]:
    return auth_headers(await login(api))


async def _enable_qr_menu(api: ApiContext, headers: dict[str, str]) -> None:
    response = await api.client.put(
        "/api/v1/qr/config",
        headers=headers,
        json={"is_enabled": True, "order_mode": "WAITER_APPROVAL"},
    )
    assert response.status_code == 200, response.text


async def test_an_existing_business_still_follows_the_device(api: ApiContext) -> None:
    """The default has to be the old behaviour, or every live menu changes look."""
    async with api.database.session_factory() as db:
        tenant = (
            await db.execute(select(Tenant).where(Tenant.slug == "dixora-lab"))
        ).scalar_one()
        assert tenant.theme_mode is ThemeMode.SYSTEM


async def test_the_owner_pins_the_theme_and_the_public_menu_reports_it(
    api: ApiContext,
) -> None:
    headers = await _owner_headers(api)
    await _enable_qr_menu(api, headers)

    businesses = await api.client.get("/api/v1/businesses", headers=headers)
    business = businesses.json()["items"][0]
    assert business["theme_mode"] == "SYSTEM"

    updated = await api.client.patch(
        f"/api/v1/businesses/{business['id']}",
        headers=headers,
        json={"theme_mode": "LIGHT"},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["theme_mode"] == "LIGHT"

    appearance = await api.client.get("/api/v1/qr/public/dixora-lab/appearance")
    assert appearance.status_code == 200
    assert appearance.json() == {"theme_mode": "LIGHT"}

    menu = await api.client.get("/api/v1/qr/public/dixora-lab/merkez")
    assert menu.status_code == 200, menu.text
    assert menu.json()["config"]["theme_mode"] == "LIGHT"


async def test_the_session_carries_the_theme_to_the_staff_screens(
    api: ApiContext,
) -> None:
    headers = await _owner_headers(api)
    businesses = await api.client.get("/api/v1/businesses", headers=headers)
    business_id = businesses.json()["items"][0]["id"]
    await api.client.patch(
        f"/api/v1/businesses/{business_id}",
        headers=headers,
        json={"theme_mode": "DARK"},
    )

    me = await api.client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["tenant"]["theme_mode"] == "DARK"


async def test_the_appearance_route_never_reveals_which_slugs_exist(
    api: ApiContext,
) -> None:
    """It decides a CSS class; it must not double as a slug oracle."""
    response = await api.client.get("/api/v1/qr/public/no-such-business/appearance")
    assert response.status_code == 200
    assert response.json() == {"theme_mode": "SYSTEM"}


async def test_the_appearance_route_is_never_cached(api: ApiContext) -> None:
    """A theme switch must land on the next load, not when a cache expires."""
    response = await api.client.get("/api/v1/qr/public/dixora-lab/appearance")
    assert response.headers["cache-control"] == "private, no-store"


async def test_the_theme_is_rejected_when_it_is_not_one_of_the_three(
    api: ApiContext,
) -> None:
    headers = await _owner_headers(api)
    businesses = await api.client.get("/api/v1/businesses", headers=headers)
    business_id = businesses.json()["items"][0]["id"]
    response = await api.client.patch(
        f"/api/v1/businesses/{business_id}",
        headers=headers,
        json={"theme_mode": "NEON"},
    )
    assert response.status_code == 422
