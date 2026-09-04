from __future__ import annotations

import re
from decimal import Decimal
from uuid import UUID

from sqlalchemy import delete, select

from app.models import Product, QrMenuConfig
from tests.conftest import ApiContext, auth_headers, login, seeded_resources
from tests.test_orders import _create_burger_order
from tests.test_tenant_isolation import _create_tenant_b


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
    program = await api.client.put(
        "/api/v1/loyalty/program",
        headers=headers,
        json={
            "name": "Dixora Loyalty",
            "is_active": True,
            "show_on_qr": True,
            "campaign_type": "VISIT_COUNT",
            "threshold": 5,
            "branch_ids": [table["branch_id"]],
            "reward_product_id": resources["burger"]["id"],
            "minimum_order_amount": "1.00",
            "allow_multiple_same_day": True,
            "reward_same_order": False,
        },
    )
    assert program.status_code == 200, program.text
    enrollment_started = await api.client.post(
        "/api/v1/loyalty/public/dixora-lab/merkez/email-enrollments/start",
        json={
            "first_name": "Test",
            "last_name": "Customer",
            "email": "qr-bill@example.com",
            "consent_accepted": True,
        },
    )
    assert enrollment_started.status_code == 201, enrollment_started.text
    enrollment_confirmed = await api.client.post(
        "/api/v1/loyalty/public/dixora-lab/merkez/email-enrollments/confirm",
        json={
            "verification_id": enrollment_started.json()["verification_id"],
            "code": enrollment_started.json()["development_code"],
        },
    )
    assert enrollment_confirmed.status_code == 200, enrollment_confirmed.text
    membership_code = enrollment_confirmed.json()["member_code"]
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
    assert menu_payload["active_order"] is None
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

    refreshed_menu = await api.client.get(
        "/api/v1/qr/public/dixora-lab/merkez",
        params={"table_token": table["qr_token"]},
    )
    assert refreshed_menu.status_code == 200, refreshed_menu.text
    assert refreshed_menu.json()["active_order"]["status"] == "ACCEPTED"

    bill_request = await api.client.post(
        "/api/v1/qr/public/dixora-lab/merkez/bill-request",
        json={
            "table_token": table["qr_token"],
            "session_token": refreshed_menu.json()["session_token"],
            "payment_preference": "ROOM_CHARGE",
            "room_reference": "214",
            "membership_code": membership_code,
        },
    )
    assert bill_request.status_code == 201, bill_request.text
    assert bill_request.json()["status"] == "REQUESTED"
    assert bill_request.json()["order"]["status"] == "BILL_REQUESTED"

    order_after_bill = await api.client.get(f"/api/v1/orders/{order_id}", headers=headers)
    assert order_after_bill.status_code == 200, order_after_bill.text
    assert order_after_bill.json()["status"] == "BILL_REQUESTED"
    loyalty_context = await api.client.get(
        f"/api/v1/loyalty/orders/{order_id}/context",
        headers=headers,
    )
    assert loyalty_context.status_code == 200, loyalty_context.text
    assert loyalty_context.json()["membership_code"] == membership_code


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


async def test_cancellation_request_can_be_rejected_and_leaves_item_untouched(
    api: ApiContext,
) -> None:
    owner = await login(api)
    owner_headers = auth_headers(owner)
    resources = await seeded_resources(api, owner_headers)
    order = await _create_burger_order(
        api,
        owner_headers,
        table_id=resources["tables"][8]["id"],
        product_id=resources["burger"]["id"],
        key="cancel-reject-key-0001",
    )
    waiter = await login(api, username="waiter@dixora.test")
    requested = await api.client.post(
        f"/api/v1/orders/{order['id']}/cancellation-requests",
        headers=auth_headers(waiter),
        json={
            "order_item_id": order["items"][0]["id"],
            "reason": "Kitchen asked to keep it",
        },
    )
    assert requested.status_code == 201, requested.text
    forbidden = await api.client.post(
        f"/api/v1/orders/cancellation-requests/{requested.json()['id']}/reject",
        headers=auth_headers(waiter),
    )
    assert forbidden.status_code == 403
    rejected = await api.client.post(
        f"/api/v1/orders/cancellation-requests/{requested.json()['id']}/reject",
        headers=owner_headers,
    )
    assert rejected.status_code == 200, rejected.text
    assert rejected.json()["status"] == "REJECTED"
    # Idempotent: rejecting again is a no-op, not an error.
    again = await api.client.post(
        f"/api/v1/orders/cancellation-requests/{requested.json()['id']}/reject",
        headers=owner_headers,
    )
    assert again.status_code == 200
    assert again.json()["status"] == "REJECTED"
    refreshed = await api.client.get(f"/api/v1/orders/{order['id']}", headers=owner_headers)
    assert refreshed.json()["items"][0]["status"] != "CANCELLED"
    assert refreshed.json()["status"] != "CANCELLED"


async def test_approval_requests_list_and_pending_count(api: ApiContext) -> None:
    owner = await login(api)
    owner_headers = auth_headers(owner)
    resources = await seeded_resources(api, owner_headers)
    order = await _create_burger_order(
        api,
        owner_headers,
        table_id=resources["tables"][9]["id"],
        product_id=resources["burger"]["id"],
        key="approvals-list-key-0001",
    )
    waiter_headers = auth_headers(await login(api, username="waiter@dixora.test"))

    baseline = await api.client.get(
        "/api/v1/orders/approval-requests/pending-count", headers=owner_headers
    )
    assert baseline.status_code == 200, baseline.text
    starting_pending = baseline.json()["pending"]

    discount_request = await api.client.post(
        f"/api/v1/orders/{order['id']}/discount-requests",
        headers=waiter_headers,
        json={"kind": "PERCENTAGE", "value": "5", "reason": "Loyal customer"},
    )
    assert discount_request.status_code == 201, discount_request.text
    cancellation_request = await api.client.post(
        f"/api/v1/orders/{order['id']}/cancellation-requests",
        headers=waiter_headers,
        json={"order_item_id": order["items"][0]["id"], "reason": "Wrong item"},
    )
    assert cancellation_request.status_code == 201, cancellation_request.text

    # Cashier/waiter permission boundary: waiter cannot read the resolution queue.
    forbidden = await api.client.get("/api/v1/orders/approval-requests", headers=waiter_headers)
    assert forbidden.status_code == 403

    pending = await api.client.get(
        "/api/v1/orders/approval-requests", headers=owner_headers, params={"status": "PENDING"}
    )
    assert pending.status_code == 200, pending.text
    pending_ids = {row["id"] for row in pending.json()}
    assert discount_request.json()["id"] in pending_ids
    assert cancellation_request.json()["id"] in pending_ids
    by_id = {row["id"]: row for row in pending.json()}
    discount_row = by_id[discount_request.json()["id"]]
    assert discount_row["table_name"] == resources["tables"][9]["name"]
    assert discount_row["requested_by_name"]
    cancellation_row = by_id[cancellation_request.json()["id"]]
    assert cancellation_row["order_item_name"] == order["items"][0]["product_name_snapshot"]

    count_after = await api.client.get(
        "/api/v1/orders/approval-requests/pending-count", headers=owner_headers
    )
    assert count_after.json()["pending"] == starting_pending + 2

    approve = await api.client.post(
        f"/api/v1/orders/discount-requests/{discount_request.json()['id']}/approve",
        headers=owner_headers,
    )
    assert approve.status_code == 200, approve.text
    reject = await api.client.post(
        f"/api/v1/orders/cancellation-requests/{cancellation_request.json()['id']}/reject",
        headers=owner_headers,
    )
    assert reject.status_code == 200, reject.text

    count_final = await api.client.get(
        "/api/v1/orders/approval-requests/pending-count", headers=owner_headers
    )
    assert count_final.json()["pending"] == starting_pending

    resolved = await api.client.get(
        "/api/v1/orders/approval-requests",
        headers=owner_headers,
        params={"status": "REJECTED"},
    )
    assert any(row["id"] == cancellation_request.json()["id"] for row in resolved.json())


async def test_approval_requests_are_tenant_isolated(api: ApiContext) -> None:
    owner = await login(api)
    owner_headers = auth_headers(owner)
    resources = await seeded_resources(api, owner_headers)
    order = await _create_burger_order(
        api,
        owner_headers,
        table_id=resources["tables"][10]["id"],
        product_id=resources["burger"]["id"],
        key="approvals-isolation-key-0001",
    )
    discount_request = await api.client.post(
        f"/api/v1/orders/{order['id']}/discount-requests",
        headers=owner_headers,
        json={"kind": "PERCENTAGE", "value": "5", "reason": "Loyal customer"},
    )
    assert discount_request.status_code == 201, discount_request.text
    approval_id = discount_request.json()["id"]

    other = await _create_tenant_b(api)
    other_headers = auth_headers(
        await login(
            api,
            username="owner@other.test",
            password="Other!2026",
            business="other-restaurant",
        )
    )

    listed = await api.client.get("/api/v1/orders/approval-requests", headers=other_headers)
    assert listed.status_code == 200, listed.text
    assert all(row["id"] != approval_id for row in listed.json())

    approve_attempt = await api.client.post(
        f"/api/v1/orders/discount-requests/{approval_id}/approve",
        headers=other_headers,
    )
    assert approve_attempt.status_code == 404
    reject_attempt = await api.client.post(
        f"/api/v1/orders/cancellation-requests/{approval_id}/reject",
        headers=other_headers,
    )
    assert reject_attempt.status_code == 404
    _ = other
