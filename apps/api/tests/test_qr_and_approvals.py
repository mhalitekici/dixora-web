from __future__ import annotations

import re
from decimal import Decimal
from uuid import UUID

from sqlalchemy import delete, select

from app.models import Product, QrMenuConfig
from tests.conftest import ApiContext, auth_headers, login, seeded_resources
from tests.test_orders import _create_burger_order


async def test_first_qr_config_save_uses_safe_defaults_and_disabled_mode_is_private(
    api: ApiContext,
) -> None:
    owner = await login(api)
    headers = auth_headers(owner)
    tenant_id = UUID(owner["user"]["tenant_id"])
    branch_id = UUID(owner["user"]["branch_id"])
    async with api.database.session_factory() as session:
        await session.execute(
            delete(QrMenuConfig).where(
                QrMenuConfig.tenant_id == tenant_id,
                QrMenuConfig.branch_id == branch_id,
            )
        )
        await session.commit()

    first_save = await api.client.put(
        "/api/v1/qr/config",
        headers=headers,
        json={"menu_name": "İlk Menü"},
    )
    assert first_save.status_code == 200, first_save.text
    assert first_save.json()["is_enabled"] is False
    assert first_save.json()["order_mode"] == "WAITER_APPROVAL"

    published = await api.client.put(
        "/api/v1/qr/config",
        headers=headers,
        json={"is_enabled": True, "order_mode": "WAITER_APPROVAL"},
    )
    assert published.status_code == 200, published.text
    assert (await api.client.get("/api/v1/qr/public/dixora-lab/merkez")).status_code == 200

    disabled = await api.client.put(
        "/api/v1/qr/config",
        headers=headers,
        json={"is_enabled": True, "order_mode": "DISABLED"},
    )
    assert disabled.status_code == 200, disabled.text
    assert (await api.client.get("/api/v1/qr/public/dixora-lab/merkez")).status_code == 404


async def test_public_menu_hides_legacy_media_paths_containing_internal_ids(
    api: ApiContext,
) -> None:
    owner = await login(api)
    headers = auth_headers(owner)
    resources = await seeded_resources(api, headers)
    tenant_id = UUID(owner["user"]["tenant_id"])
    branch_id = UUID(owner["user"]["branch_id"])
    legacy_product_url = (
        f"http://test/api/v1/media/tenants/{tenant_id.hex}/products/"
        "0123456789abcdef0123456789abcdef.png"
    )
    legacy_logo_url = (
        f"http://test/api/v1/media/tenants/{tenant_id.hex}/qr-menu/"
        f"{branch_id.hex}/logo/0123456789abcdef0123456789abcdef.png"
    )
    async with api.database.session_factory() as session:
        product = await session.get(Product, UUID(resources["burger"]["id"]))
        config = (
            await session.execute(
                select(QrMenuConfig).where(
                    QrMenuConfig.tenant_id == tenant_id,
                    QrMenuConfig.branch_id == branch_id,
                )
            )
        ).scalar_one()
        assert product is not None
        product.image_url = legacy_product_url
        config.logo_url = legacy_logo_url
        await session.commit()

    response = await api.client.get("/api/v1/qr/public/dixora-lab/merkez")
    assert response.status_code == 200, response.text
    payload = response.json()
    burger = next(item for item in payload["products"] if item["name"] == "Classic Burger")
    assert burger["image_url"] is None
    assert payload["config"]["logo_url"] is None
    assert tenant_id.hex not in response.text


async def test_qr_config_rejects_direct_brand_asset_urls(api: ApiContext) -> None:
    owner = await login(api)
    response = await api.client.put(
        "/api/v1/qr/config",
        headers=auth_headers(owner),
        json={"logo_url": "https://tracking.invalid/logo.png"},
    )
    assert response.status_code == 422


async def test_qr_request_requires_staff_approval_then_uses_unified_order_engine(
    api: ApiContext,
) -> None:
    branches = await api.client.get("/api/v1/qr/public/dixora-lab/branches")
    assert branches.status_code == 200
    assert branches.json()[0]["slug"] == "merkez"
    owner = await login(api)
    headers = auth_headers(owner)
    resources = await seeded_resources(api, headers)
    table = resources["tables"][2]
    menu = await api.client.get(
        "/api/v1/qr/public/dixora-lab/merkez",
        params={"table_token": table["qr_token"]},
    )
    assert menu.status_code == 200, menu.text
    menu_payload = menu.json()
    assert (
        re.search(
            r"[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
            menu.text,
            re.IGNORECASE,
        )
        is None
    )
    session_token = menu_payload["session_token"]
    public_burger = next(
        product for product in menu_payload["products"] if product["name"] == "Classic Burger"
    )
    assert public_burger["id"].startswith("p_")
    assert public_burger["category_id"].startswith("c_")
    assert "tenant_id" not in menu_payload["config"]
    assert "branch_id" not in menu_payload["config"]
    assert "tenant_id" not in menu_payload["categories"][0]
    for group in public_burger["modifier_groups"]:
        assert group["id"].startswith("g_")
        assert "tenant_id" not in group
        assert "product_ids" not in group
        for modifier in group["modifiers"]:
            assert modifier["id"].startswith("m_")
    submitted = await api.client.post(
        "/api/v1/qr/public/dixora-lab/merkez/requests",
        json={
            "table_token": table["qr_token"],
            "session_token": session_token,
            "idempotency_key": "qr-request-key-0001",
            "items": [{"product_id": public_burger["id"], "quantity": "1"}],
            "customer_note": "No onions",
        },
    )
    assert submitted.status_code == 201, submitted.text
    assert submitted.json()["status"] == "PENDING"
    assert submitted.json()["reference"].startswith("r_")
    assert "id" not in submitted.json()
    assert "order_id" not in submitted.json()

    pending = await api.client.get(
        "/api/v1/qr/requests",
        headers=headers,
        params={"status": "PENDING"},
    )
    assert pending.status_code == 200, pending.text
    request_id = next(
        request["id"] for request in pending.json() if request["table_id"] == table["id"]
    )
    approved = await api.client.post(
        f"/api/v1/qr/requests/{request_id}/approve",
        headers=headers,
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "APPROVED"
    order_id = approved.json()["order_id"]
    order = await api.client.get(f"/api/v1/orders/{order_id}", headers=headers)
    assert order.status_code == 200
    assert order.json()["source"] == "QR"
    assert order.json()["status"] == "ACCEPTED"


async def test_qr_request_pending_quota_allows_replay_but_rejects_a_fourth_request(
    api: ApiContext,
) -> None:
    owner = await login(api)
    headers = auth_headers(owner)
    resources = await seeded_resources(api, headers)
    table = resources["tables"][4]
    menu = await api.client.get(
        "/api/v1/qr/public/dixora-lab/merkez",
        params={"table_token": table["qr_token"]},
    )
    assert menu.status_code == 200, menu.text
    menu_payload = menu.json()
    session_token = menu_payload["session_token"]
    public_burger = next(
        product for product in menu_payload["products"] if product["name"] == "Classic Burger"
    )

    submitted: list[dict[str, object]] = []
    for index in range(3):
        response = await api.client.post(
            "/api/v1/qr/public/dixora-lab/merkez/requests",
            json={
                "table_token": table["qr_token"],
                "session_token": session_token,
                "idempotency_key": f"qr-pending-quota-{index:04d}",
                "items": [{"product_id": public_burger["id"], "quantity": "1"}],
            },
        )
        assert response.status_code == 201, response.text
        assert response.json()["status"] == "PENDING"
        submitted.append(response.json())

    replay = await api.client.post(
        "/api/v1/qr/public/dixora-lab/merkez/requests",
        json={
            "table_token": table["qr_token"],
            "session_token": session_token,
            "idempotency_key": "qr-pending-quota-0000",
            "items": [{"product_id": public_burger["id"], "quantity": "1"}],
        },
    )
    assert replay.status_code == 201, replay.text
    assert replay.json()["reference"] == submitted[0]["reference"]

    rejected = await api.client.post(
        "/api/v1/qr/public/dixora-lab/merkez/requests",
        json={
            "table_token": table["qr_token"],
            "session_token": session_token,
            "idempotency_key": "qr-pending-quota-0003",
            "items": [{"product_id": public_burger["id"], "quantity": "1"}],
        },
    )
    assert rejected.status_code == 429, rejected.text
    assert rejected.json()["error"]["code"] == "qr_request_rate_limited"


async def test_discount_requires_approver_permission_and_updates_snapshot_total(
    api: ApiContext,
) -> None:
    owner = await login(api)
    owner_headers = auth_headers(owner)
    resources = await seeded_resources(api, owner_headers)
    order = await _create_burger_order(
        api,
        owner_headers,
        table_id=resources["tables"][3]["id"],
        product_id=resources["burger"]["id"],
        key="discount-order-key-0001",
    )
    waiter = await login(api, username="waiter@dixora.test")
    waiter_headers = auth_headers(waiter)
    request = await api.client.post(
        f"/api/v1/orders/{order['id']}/discount-requests",
        headers=waiter_headers,
        json={"kind": "PERCENTAGE", "value": "10", "reason": "Service recovery"},
    )
    assert request.status_code == 201, request.text
    forbidden = await api.client.post(
        f"/api/v1/orders/discount-requests/{request.json()['id']}/approve",
        headers=waiter_headers,
    )
    assert forbidden.status_code == 403
    approved = await api.client.post(
        f"/api/v1/orders/discount-requests/{request.json()['id']}/approve",
        headers=owner_headers,
    )
    assert approved.status_code == 200, approved.text
    refreshed = await api.client.get(f"/api/v1/orders/{order['id']}", headers=owner_headers)
    assert Decimal(refreshed.json()["discount_total"]) == Decimal("36.00")
    assert Decimal(refreshed.json()["total"]) == Decimal("324.00")


async def test_item_cancellation_approval_reverses_inventory(api: ApiContext) -> None:
    owner = await login(api)
    owner_headers = auth_headers(owner)
    resources = await seeded_resources(api, owner_headers)
    order = await _create_burger_order(
        api,
        owner_headers,
        table_id=resources["tables"][7]["id"],
        product_id=resources["burger"]["id"],
        key="cancel-order-key-0001",
    )
    waiter = await login(api, username="waiter@dixora.test")
    requested = await api.client.post(
        f"/api/v1/orders/{order['id']}/cancellation-requests",
        headers=auth_headers(waiter),
        json={
            "order_item_id": order["items"][0]["id"],
            "reason": "Customer changed their mind",
        },
    )
    assert requested.status_code == 201, requested.text
    approved = await api.client.post(
        f"/api/v1/orders/cancellation-requests/{requested.json()['id']}/approve",
        headers=owner_headers,
    )
    assert approved.status_code == 200, approved.text
    refreshed = await api.client.get(f"/api/v1/orders/{order['id']}", headers=owner_headers)
    assert refreshed.json()["items"][0]["status"] == "CANCELLED"
    assert refreshed.json()["status"] == "CANCELLED"
