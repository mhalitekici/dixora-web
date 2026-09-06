"""Erasing a business removes all of it, and only it."""

from __future__ import annotations

from io import BytesIO
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID, uuid4

import pytest
from PIL import Image
from sqlalchemy import func, select

from app.models import AuditLog, Permission, Role, Tenant, User
from app.services.media_storage import MediaObjectNotFound
from app.services.tenant_deletion import tenant_scoped_tables
from tests.conftest import ApiContext, auth_headers, login, seeded_resources


async def _super_headers(api: ApiContext) -> dict[str, str]:
    return auth_headers(
        await login(
            api,
            username="superadmin@dixora.app",
            password="Dixora!2026",
            business=None,
        )
    )


async def _owner_headers(api: ApiContext) -> dict[str, str]:
    return auth_headers(await login(api))


async def _seeded_tenant_id(api: ApiContext) -> UUID:
    async with api.database.session_factory() as db:
        tenant = (
            await db.execute(select(Tenant).where(Tenant.slug == "dixora-lab"))
        ).scalar_one()
        return tenant.id


async def _second_business(api: ApiContext, headers: dict[str, str]) -> dict[str, Any]:
    response = await api.client.post(
        "/api/v1/businesses",
        headers=headers,
        json={
            "name": "Aleyin Mutfagi",
            "slug": "aleyin-mutfagi",
            "business_type": "RESTAURANT",
            "first_branch": {
                "name": "Merkez",
                "slug": "merkez",
                "timezone": "Europe/Istanbul",
            },
            "owner": {
                "username": "owner@aleyin.test",
                "email": "owner@aleyin.test",
                "display_name": "Aleyin Sahibi",
                "temporary_password": "AleyinLab!2026",
            },
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _tenant_row_counts(api: ApiContext, tenant_id: UUID) -> dict[str, int]:
    """How many rows each tenant-scoped table holds for one business."""
    counts: dict[str, int] = {}
    async with api.database.session_factory() as db:
        for table in tenant_scoped_tables():
            total = (
                await db.execute(
                    select(func.count())
                    .select_from(table)
                    .where(table.c.tenant_id == tenant_id)
                )
            ).scalar_one()
            if total:
                counts[table.name] = int(total)
    return counts


async def test_a_platform_admin_erases_a_business_and_everything_under_it(
    api: ApiContext,
) -> None:
    headers = await _super_headers(api)
    doomed = await _seeded_tenant_id(api)

    before = await _tenant_row_counts(api, doomed)
    assert before, "the seeded business should own rows worth deleting"

    response = await api.client.request(
        "DELETE",
        f"/api/v1/businesses/{doomed}",
        headers=headers,
        json={"confirm_name": "Dixora Lab", "reason": "Musteri talebi"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["slug"] == "dixora-lab"
    assert body["deleted_rows"]["tenants"] == 1
    assert body["deleted_rows"]["users"] >= 1

    assert await _tenant_row_counts(api, doomed) == {}
    async with api.database.session_factory() as db:
        assert (await db.get(Tenant, doomed)) is None


async def test_deleting_one_business_leaves_another_tenants_data_alone(
    api: ApiContext,
) -> None:
    """The isolation guarantee, measured rather than assumed."""
    headers = await _super_headers(api)
    keep = await _second_business(api, headers)
    keep_id = UUID(keep["id"])
    doomed = await _seeded_tenant_id(api)

    survivors_before = await _tenant_row_counts(api, keep_id)
    assert survivors_before, "the surviving business should own rows to protect"

    response = await api.client.request(
        "DELETE",
        f"/api/v1/businesses/{doomed}",
        headers=headers,
        json={"confirm_name": "Dixora Lab"},
    )
    assert response.status_code == 200, response.text

    assert await _tenant_row_counts(api, keep_id) == survivors_before

    # Platform-owned rows carry no tenant and must survive untouched: the
    # super-admin account itself, the SUPER_ADMIN role, the permission catalogue.
    async with api.database.session_factory() as db:
        assert (
            await db.execute(
                select(func.count(User.id)).where(User.tenant_id.is_(None))
            )
        ).scalar_one() >= 1
        assert (
            await db.execute(
                select(func.count(Role.id)).where(Role.tenant_id.is_(None))
            )
        ).scalar_one() >= 1
        assert (await db.execute(select(func.count(Permission.id)))).scalar_one() > 0

    # And the surviving business still answers for itself.
    still_there = await api.client.get(
        f"/api/v1/businesses/{keep_id}", headers=headers
    )
    assert still_there.status_code == 200


async def test_the_confirmation_must_repeat_the_business_name(
    api: ApiContext,
) -> None:
    headers = await _super_headers(api)
    doomed = await _seeded_tenant_id(api)

    response = await api.client.request(
        "DELETE",
        f"/api/v1/businesses/{doomed}",
        headers=headers,
        json={"confirm_name": "dixora lab"},
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "confirmation_mismatch"

    async with api.database.session_factory() as db:
        assert (await db.get(Tenant, doomed)) is not None


async def test_a_business_owner_cannot_delete_their_own_business(
    api: ApiContext,
) -> None:
    headers = await _owner_headers(api)
    doomed = await _seeded_tenant_id(api)

    response = await api.client.request(
        "DELETE",
        f"/api/v1/businesses/{doomed}",
        headers=headers,
        json={"confirm_name": "Dixora Lab"},
    )
    assert response.status_code == 403

    async with api.database.session_factory() as db:
        assert (await db.get(Tenant, doomed)) is not None


async def test_the_platform_permission_alone_does_not_open_the_delete_route(
    api: ApiContext,
) -> None:
    """A tenant role holding `platform.businesses.manage` is still refused.

    Every other route on this router treats that permission as equivalent to
    being a platform operator. Deletion does not: it is pinned to the flag on
    the account, so a misconfigured or hostile tenant role cannot reach it.
    """
    async with api.database.session_factory() as db:
        owner = (
            await db.execute(select(User).where(User.username == "owner@dixora.test"))
        ).scalar_one()
        role = await db.get(Role, owner.role_id)
        assert role is not None
        permission = (
            await db.execute(
                select(Permission).where(
                    Permission.code == "platform.businesses.manage"
                )
            )
        ).scalar_one()
        role.permissions.append(permission)
        await db.commit()

    headers = await _owner_headers(api)
    doomed = await _seeded_tenant_id(api)
    response = await api.client.request(
        "DELETE",
        f"/api/v1/businesses/{doomed}",
        headers=headers,
        json={"confirm_name": "Dixora Lab"},
    )
    assert response.status_code == 403

    async with api.database.session_factory() as db:
        assert (await db.get(Tenant, doomed)) is not None


async def test_deleting_an_unknown_business_is_a_404(api: ApiContext) -> None:
    headers = await _super_headers(api)
    response = await api.client.request(
        "DELETE",
        f"/api/v1/businesses/{uuid4()}",
        headers=headers,
        json={"confirm_name": "Anything"},
    )
    assert response.status_code == 404


async def test_the_deletion_is_recorded_where_the_deletion_cannot_reach_it(
    api: ApiContext,
) -> None:
    """The audit row is platform-scoped, so it outlives the business it describes."""
    headers = await _super_headers(api)
    doomed = await _seeded_tenant_id(api)

    response = await api.client.request(
        "DELETE",
        f"/api/v1/businesses/{doomed}",
        headers=headers,
        json={"confirm_name": "Dixora Lab", "reason": "KVKK silme talebi"},
    )
    assert response.status_code == 200, response.text

    async with api.database.session_factory() as db:
        entry = (
            await db.execute(
                select(AuditLog).where(AuditLog.action == "business.deleted")
            )
        ).scalar_one()
        assert entry.tenant_id is None
        assert entry.resource_id == str(doomed)
        assert entry.reason == "KVKK silme talebi"
        assert entry.previous_value == {
            "name": "Dixora Lab",
            "slug": "dixora-lab",
            "state": "TRIAL",
            "is_active": True,
        }


async def test_the_delete_route_refuses_an_anonymous_caller(api: ApiContext) -> None:
    doomed = await _seeded_tenant_id(api)
    response = await api.client.request(
        "DELETE",
        f"/api/v1/businesses/{doomed}",
        json={"confirm_name": "Dixora Lab"},
    )
    assert response.status_code == 401


async def _uploaded_product_image_key(
    api: ApiContext, headers: dict[str, str]
) -> str:
    """Give the seeded business a real stored image, and report its object key."""
    resources = await seeded_resources(api, headers)
    buffer = BytesIO()
    Image.new("RGB", (64, 64), color=(236, 90, 32)).save(buffer, format="PNG")

    response = await api.client.post(
        f"/api/v1/media/products/{resources['burger']['id']}/image",
        headers=headers,
        files={"file": ("burger.png", buffer.getvalue(), "image/png")},
    )
    assert response.status_code == 200, response.text
    path = urlsplit(response.json()["image_url"]).path
    return path.removeprefix("/api/v1/media/")


async def test_the_stored_images_go_with_the_business(api: ApiContext) -> None:
    """Deleting the rows must not leave the objects paying for storage forever."""
    owner = await _owner_headers(api)
    key = await _uploaded_product_image_key(api, owner)
    assert await api.media_storage.get_object(key)

    headers = await _super_headers(api)
    doomed = await _seeded_tenant_id(api)
    response = await api.client.request(
        "DELETE",
        f"/api/v1/businesses/{doomed}",
        headers=headers,
        json={"confirm_name": "Dixora Lab"},
    )
    assert response.status_code == 200, response.text

    with pytest.raises(MediaObjectNotFound):
        await api.media_storage.get_object(key)


async def test_another_business_keeps_its_images(api: ApiContext) -> None:
    owner = await _owner_headers(api)
    survivor_key = await _uploaded_product_image_key(api, owner)

    headers = await _super_headers(api)
    victim = await _second_business(api, headers)

    response = await api.client.request(
        "DELETE",
        f"/api/v1/businesses/{victim['id']}",
        headers=headers,
        json={"confirm_name": victim["name"]},
    )
    assert response.status_code == 200, response.text

    assert await api.media_storage.get_object(survivor_key)
