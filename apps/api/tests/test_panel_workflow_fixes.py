from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select

from app.models import QrOrderRequest, Receipt, StockMovement, Subscription, Tenant, User
from app.models.enums import TenantState
from app.security import utcnow
from tests.conftest import ApiContext, auth_headers, login, seeded_resources
from tests.test_orders import _create_burger_order
from tests.test_shifts import _close, _open


async def _jobs(api: ApiContext, headers: dict[str, str], order_id: str) -> list[dict]:
    response = await api.client.get(
        "/api/v1/printing/jobs", headers=headers, params={"order_id": order_id}
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _cashier_printer(api: ApiContext, headers: dict[str, str]) -> None:
    response = await api.client.post(
        "/api/v1/printing/devices",
        headers=headers,
        json={"code": "RECEIPT-FIXES", "name": "Kasa", "purpose": "CASHIER", "transport": "MOCK"},
    )
    assert response.status_code == 201, response.text


async def test_additions_wait_for_manual_print_and_never_repeat_old_complimentary_items(
    api: ApiContext,
) -> None:
    headers = auth_headers(await login(api))
    resources = await seeded_resources(api, headers)
    order = await _create_burger_order(
        api,
        headers,
        table_id=resources["tables"][0]["id"],
        product_id=resources["burger"]["id"],
        key="print-additions-original",
    )
    item = order["items"][0]
    original_jobs = await _jobs(api, headers, order["id"])
    assert len(original_jobs) == 1
    response = await api.client.patch(
        f"/api/v1/orders/{order['id']}/items/{item['id']}",
        headers=headers,
        json={
            "action": "INCREASE",
            "expected_version": order["version"],
            "idempotency_key": "manual-extra-portion",
        },
    )
    assert response.status_code == 200, response.text
    order = response.json()
    extra = next(row for row in order["items"] if row["status"] == "SUBMITTED")
    assert Decimal(extra["quantity"]) == 1
    assert await _jobs(api, headers, order["id"]) == original_jobs
    replay = await api.client.patch(
        f"/api/v1/orders/{order['id']}/items/{item['id']}",
        headers=headers,
        json={
            "action": "INCREASE",
            "expected_version": 1,
            "idempotency_key": "manual-extra-portion",
        },
    )
    assert replay.status_code == 200
    assert len(replay.json()["items"]) == 2
    response = await api.client.patch(
        f"/api/v1/orders/{order['id']}/items/{item['id']}",
        headers=headers,
        json={
            "action": "SET_COMPLIMENTARY",
            "expected_version": order["version"],
            "idempotency_key": "manual-existing-complimentary",
            "reason": "Misafir memnuniyeti",
        },
    )
    assert response.status_code == 200, response.text
    order = response.json()
    assert await _jobs(api, headers, order["id"]) == original_jobs
    appended = await api.client.post(
        f"/api/v1/orders/{order['id']}/items",
        headers=headers,
        json={
            "items": [
                {
                    "product_id": resources["burger"]["id"],
                    "quantity": "1",
                    "note": "Soğansız",
                }
            ],
            "auto_accept": False,
            "idempotency_key": "manual-whole-addition",
        },
    )
    assert appended.status_code == 200, appended.text
    order = appended.json()
    assert await _jobs(api, headers, order["id"]) == original_jobs
    printed = await api.client.post(f"/api/v1/orders/{order['id']}/accept", headers=headers)
    assert printed.status_code == 200, printed.text
    jobs = await _jobs(api, headers, order["id"])
    assert len(jobs) == 2
    addition_job = next(job for job in jobs if job["id"] != original_jobs[0]["id"])
    lines = addition_job["payload"]["document"]["lines"]
    assert sorted(Decimal(line["quantity"]) for line in lines) == [Decimal("1"), Decimal("1")]
    assert not any(line["complimentary"] for line in lines)
    assert not any("adjustment_label" in line for line in lines)
    assert "ADET ARTTIRILDI" not in str(addition_job["payload"])
    again = await api.client.post(f"/api/v1/orders/{order['id']}/accept", headers=headers)
    assert again.status_code == 200
    assert len(await _jobs(api, headers, order["id"])) == 2
    async with api.database.session_factory() as db:
        movements = (
            (
                await db.execute(
                    select(StockMovement).where(
                        StockMovement.order_item_id.in_([UUID(row["id"]) for row in order["items"]])
                    )
                )
            )
            .scalars()
            .all()
        )
        for original in (row for row in movements if str(row.order_item_id) == item["id"]):
            used = sum(
                (
                    row.quantity_delta
                    for row in movements
                    if row.inventory_item_id == original.inventory_item_id
                ),
                Decimal("0"),
            )
            assert used == original.quantity_delta * Decimal("3")


async def test_waiter_can_edit_notes_without_getting_cashier_permissions(api: ApiContext) -> None:
    headers = auth_headers(await login(api, username="waiter@dixora.test"))
    resources = await seeded_resources(api, headers)
    order = await _create_burger_order(
        api,
        headers,
        table_id=resources["tables"][1]["id"],
        product_id=resources["burger"]["id"],
        quantity="1",
        key="waiter-whole-note-original",
    )
    item = order["items"][0]
    assert Decimal(item["line_total"]) == Decimal(resources["burger"]["selling_price"])
    note = {
        "expected_version": order["version"],
        "idempotency_key": "waiter-whole-note-edit",
        "note": "  Sos ayrı, soğansız  ",
    }
    response = await api.client.patch(
        f"/api/v1/orders/{order['id']}/items/{item['id']}/note",
        headers=headers,
        json=note,
    )
    assert response.status_code == 200, response.text
    assert response.json()["items"][0]["note"] == "Sos ayrı, soğansız"
    replay = await api.client.patch(
        f"/api/v1/orders/{order['id']}/items/{item['id']}/note",
        headers=headers,
        json=note,
    )
    assert replay.status_code == 200
    assert replay.json()["version"] == response.json()["version"]
    forbidden = await api.client.patch(
        f"/api/v1/orders/{order['id']}/items/{item['id']}",
        headers=headers,
        json={
            "action": "INCREASE",
            "expected_version": response.json()["version"],
            "idempotency_key": "waiter-must-not-increase",
        },
    )
    assert forbidden.status_code == 403


async def test_staff_cannot_create_or_append_fractional_products(api: ApiContext) -> None:
    headers = auth_headers(await login(api))
    resources = await seeded_resources(api, headers)
    for source in ("WAITER", "CASHIER"):
        for quantity in ("0.5", "1.5"):
            response = await api.client.post(
                "/api/v1/orders",
                headers=headers,
                json={
                    "table_id": resources["tables"][0]["id"],
                    "source": source,
                    "items": [{"product_id": resources["burger"]["id"], "quantity": quantity}],
                    "idempotency_key": f"invalid-fraction-{source}-{quantity}",
                },
            )
            assert response.status_code == 422, response.text
    order = await _create_burger_order(
        api,
        headers,
        table_id=resources["tables"][0]["id"],
        product_id=resources["burger"]["id"],
        key="whole-product-before-invalid-append",
    )
    for quantity in ("0.5", "1.5"):
        response = await api.client.post(
            f"/api/v1/orders/{order['id']}/items",
            headers=headers,
            json={
                "items": [{"product_id": resources["burger"]["id"], "quantity": quantity}],
                "idempotency_key": f"invalid-fraction-append-{quantity}",
                "auto_accept": False,
            },
        )
        assert response.status_code == 422, response.text
    unchanged = await api.client.get(f"/api/v1/orders/{order['id']}", headers=headers)
    assert unchanged.json()["version"] == order["version"]
    assert len(unchanged.json()["items"]) == 1


async def test_qr_whole_product_keeps_quantity_and_price_after_staff_approval(
    api: ApiContext,
) -> None:
    headers = auth_headers(await login(api))
    resources = await seeded_resources(api, headers)
    table = resources["tables"][4]
    menu = await api.client.get(
        "/api/v1/qr/public/dixora-lab/merkez", params={"table_token": table["qr_token"]}
    )
    assert menu.status_code == 200, menu.text
    burger = next(row for row in menu.json()["products"] if row["name"] == "Classic Burger")
    for quantity in ("0.5", "1.5"):
        invalid = await api.client.post(
            "/api/v1/qr/public/dixora-lab/merkez/requests",
            json={
                "table_token": table["qr_token"],
                "session_token": menu.json()["session_token"],
                "items": [{"product_id": burger["id"], "quantity": quantity}],
                "idempotency_key": f"qr-invalid-fraction-{quantity}",
            },
        )
        assert invalid.status_code == 422, invalid.text
    requested = await api.client.post(
        "/api/v1/qr/public/dixora-lab/merkez/requests",
        json={
            "table_token": table["qr_token"],
            "session_token": menu.json()["session_token"],
            "items": [{"product_id": burger["id"], "quantity": "1", "note": "Sos ayrı"}],
            "idempotency_key": "qr-whole-product-request",
        },
    )
    assert requested.status_code == 201, requested.text
    # A pending request created before whole quantities became mandatory must
    # produce an actionable error, rather than an internal validation failure.
    pending = await api.client.get(
        "/api/v1/qr/requests", headers=headers, params={"status": "PENDING"}
    )
    request_id = next(row["id"] for row in pending.json() if row["table_id"] == table["id"])
    async with api.database.session_factory() as db:
        legacy_request = await db.get(QrOrderRequest, UUID(request_id))
        assert legacy_request is not None
        whole_items = legacy_request.items_payload
        legacy_request.items_payload = [dict(whole_items[0], quantity="0.5")]
        await db.commit()
    invalid_approval = await api.client.post(
        f"/api/v1/qr/requests/{request_id}/approve", headers=headers
    )
    assert invalid_approval.status_code == 422, invalid_approval.text
    assert invalid_approval.json()["error"]["code"] == "whole_quantity_required"
    async with api.database.session_factory() as db:
        legacy_request = await db.get(QrOrderRequest, UUID(request_id))
        assert legacy_request is not None
        assert legacy_request.order_id is None
        legacy_request.items_payload = whole_items
        await db.commit()
    pending = await api.client.get(
        "/api/v1/qr/requests", headers=headers, params={"status": "PENDING"}
    )
    request_id = next(row["id"] for row in pending.json() if row["table_id"] == table["id"])
    approved = await api.client.post(f"/api/v1/qr/requests/{request_id}/approve", headers=headers)
    assert approved.status_code == 200, approved.text
    order = await api.client.get(f"/api/v1/orders/{approved.json()['order_id']}", headers=headers)
    assert order.status_code == 200
    item = order.json()["items"][0]
    assert Decimal(item["quantity"]) == Decimal("1")
    assert Decimal(item["line_total"]) == Decimal(resources["burger"]["selling_price"])
    assert item["note"] == "Sos ayrı"


async def test_receipts_use_selected_shift_cashier_and_preserve_name_after_closing(
    api: ApiContext,
) -> None:
    headers = auth_headers(await login(api))
    shift = await _open(api, headers)
    resources = await seeded_resources(api, headers)
    await _cashier_printer(api, headers)
    response = await api.client.post(
        "/api/v1/orders",
        headers=headers,
        json={
            "table_id": resources["tables"][2]["id"],
            "source": "CASHIER",
            "items": [{"product_id": resources["burger"]["id"], "quantity": "1"}],
            "idempotency_key": "selected-cashier-receipt",
            "auto_accept": True,
        },
    )
    assert response.status_code == 201, response.text
    order = response.json()
    preparation = (await _jobs(api, headers, order["id"]))[0]
    assert preparation["payload"]["document"]["waiter_name"] == shift["cashier_name"]
    response = await api.client.post(
        "/api/v1/printing/jobs",
        headers=headers,
        json={
            "order_id": order["id"],
            "payload": {"type": "BILL"},
            "kind": "ORIGINAL",
            "idempotency_key": "selected-cashier-bill",
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["payload"]["document"]["waiter_name"] == shift["cashier_name"]
    assert response.json()["payload"]["receipt"]["meta"]["staffName"] == shift["cashier_name"]
    await _close(api, headers, shift["id"], "0.00")
    async with api.database.session_factory() as db:
        cashier = await db.get(User, UUID(shift["user_id"]))
        assert cashier is not None
        cashier.display_name = "Sonradan değiştirilen isim"
        await db.commit()
    reprint = await api.client.post(
        "/api/v1/printing/jobs",
        headers=headers,
        json={
            "order_id": order["id"],
            "payload": {"type": "BILL"},
            "kind": "REPRINT",
            "idempotency_key": "selected-cashier-reprint",
        },
    )
    assert reprint.status_code == 201, reprint.text
    assert reprint.json()["payload"]["document"]["waiter_name"] == shift["cashier_name"]
    receipts = await api.client.get("/api/v1/printing/receipts", headers=headers)
    assert receipts.status_code == 200
    assert receipts.json()[0]["cashier_name"] == shift["cashier_name"]


async def test_receipt_number_search_works_across_pages_and_distinguishes_business_dates(
    api: ApiContext,
) -> None:
    tokens = await login(api)
    headers = auth_headers(tokens)
    resources = await seeded_resources(api, headers)
    now = utcnow()
    orders = []
    for index in range(2):
        order = await _create_burger_order(
            api,
            headers,
            table_id=resources["tables"][index]["id"],
            product_id=resources["burger"]["id"],
            key=f"receipt-number-search-{index}",
        )
        orders.append(order)
        async with api.database.session_factory() as db:
            db.add(
                Receipt(
                    tenant_id=UUID(tokens["user"]["tenant_id"]),
                    branch_id=UUID(order["branch_id"]),
                    order_id=UUID(order["id"]),
                    daily_number=7,
                    business_date=(now - timedelta(days=index)).date(),
                    issued_at=now - timedelta(days=index),
                    issued_by_user_id=UUID(tokens["user"]["id"]),
                )
            )
            await db.commit()
    response = await api.client.get(
        "/api/v1/orders", headers=headers, params={"receipt_number": 7, "limit": 1, "offset": 1}
    )
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 2
    assert len(response.json()["items"]) == 1
    response = await api.client.get(
        "/api/v1/orders",
        headers=headers,
        params={"receipt_number": 7, "receipt_date": now.date().isoformat()},
    )
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["id"] == orders[0]["id"]
    assert response.json()["items"][0]["receipt_number"] == 7
    empty = await api.client.get("/api/v1/orders", headers=headers, params={"receipt_number": 8})
    assert empty.json()["total"] == 0


async def test_bill_requested_order_can_take_new_items_before_payment(api: ApiContext) -> None:
    headers = auth_headers(await login(api))
    resources = await seeded_resources(api, headers)
    order = await _create_burger_order(
        api,
        headers,
        table_id=resources["tables"][3]["id"],
        product_id=resources["burger"]["id"],
        key="bill-then-new-items-original",
    )
    requested = await api.client.post(f"/api/v1/orders/{order['id']}/bill-request", headers=headers)
    assert requested.status_code == 200, requested.text
    response = await api.client.post(
        f"/api/v1/orders/{order['id']}/items",
        headers=headers,
        json={
            "items": [{"product_id": resources["burger"]["id"], "quantity": "1"}],
            "idempotency_key": "bill-then-new-items-append",
            "auto_accept": False,
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "ACCEPTED"
    assert len(await _jobs(api, headers, order["id"])) == 1
    printed = await api.client.post(f"/api/v1/orders/{order['id']}/accept", headers=headers)
    assert printed.status_code == 200
    assert len(await _jobs(api, headers, order["id"])) == 2


async def test_expired_membership_moves_next_payment_by_exact_extension_days(
    api: ApiContext,
    monkeypatch,
) -> None:
    headers = auth_headers(
        await login(
            api,
            username="superadmin@dixora.app",
            password="Dixora!2026",
            business=None,
        )
    )
    now = utcnow()
    monkeypatch.setattr("app.api.businesses.utcnow", lambda: now)
    async with api.database.session_factory() as db:
        tenant = (await db.execute(select(Tenant).where(Tenant.slug == "dixora-lab"))).scalar_one()
        subscription = (
            await db.execute(select(Subscription).where(Subscription.tenant_id == tenant.id))
        ).scalar_one()
        subscription.ends_at = now - timedelta(days=8)
        subscription.status = TenantState.PAST_DUE
        tenant.state = TenantState.PAST_DUE
        business_id = str(tenant.id)
        await db.commit()
    response = await api.client.post(
        f"/api/v1/businesses/{business_id}/reactivate", headers=headers, json={"extend_days": 30}
    )
    assert response.status_code == 200, response.text
    overview = await api.client.get(f"/api/v1/businesses/{business_id}/overview", headers=headers)
    assert overview.status_code == 200
    assert overview.json()["next_payment_at"] == (now + timedelta(days=30)).isoformat().replace(
        "+00:00", "Z"
    )
