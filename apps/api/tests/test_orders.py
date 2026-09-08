from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select

from app.models import AuditLog, StockBalance, StockMovement
from tests.conftest import (
    ApiContext,
    auth_headers,
    login,
    seeded_resources,
)


async def _create_burger_order(
    api: ApiContext,
    headers: dict[str, str],
    *,
    table_id: str,
    product_id: str,
    quantity: str = "1",
    key: str = "order-create-key-0001",
) -> dict:
    response = await api.client.post(
        "/api/v1/orders",
        headers=headers,
        json={
            "table_id": table_id,
            "items": [{"product_id": product_id, "quantity": quantity}],
            "idempotency_key": key,
            "auto_accept": True,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def test_order_lifecycle_append_only_new_items_and_active_table_lookup(
    api: ApiContext,
) -> None:
    tokens = await login(api)
    headers = auth_headers(tokens)
    resources = await seeded_resources(api, headers)
    table = resources["tables"][0]
    burger = resources["burger"]
    order = await _create_burger_order(
        api,
        headers,
        table_id=table["id"],
        product_id=burger["id"],
    )
    assert order["status"] == "ACCEPTED"
    assert len(order["items"]) == 1

    append_payload = {
        "items": [{"product_id": burger["id"], "quantity": "1"}],
        "idempotency_key": "append-items-key-0001",
    }
    appended = await api.client.post(
        f"/api/v1/orders/{order['id']}/items",
        json=append_payload,
        headers=headers,
    )
    assert appended.status_code == 200, appended.text
    assert len(appended.json()["items"]) == 2
    assert Decimal(appended.json()["total"]) == Decimal("720.00")

    replay = await api.client.post(
        f"/api/v1/orders/{order['id']}/items",
        json=append_payload,
        headers=headers,
    )
    assert replay.status_code == 200
    assert len(replay.json()["items"]) == 2

    active = await api.client.get(
        f"/api/v1/tables/{table['id']}/active-order",
        headers=headers,
    )
    assert active.status_code == 200
    assert active.json()["id"] == order["id"]

    kitchen = await api.client.get("/api/v1/kitchen/tickets", headers=headers)
    assert kitchen.status_code == 200
    batches = [item for item in kitchen.json() if item["order_id"] == order["id"]]
    assert len(batches) == 2
    assert {item["batch_number"] for item in batches} == {1, 2}
    assert all(len(item["items"]) == 1 for item in batches)


async def test_branch_service_charge_is_snapshotted_into_order_total(
    api: ApiContext,
) -> None:
    tokens = await login(api)
    headers = auth_headers(tokens)
    resources = await seeded_resources(api, headers)
    branches = await api.client.get("/api/v1/branches", headers=headers)
    branch_id = branches.json()[0]["id"]
    updated = await api.client.patch(
        f"/api/v1/branches/{branch_id}",
        headers=headers,
        json={
            "service_charge_enabled": True,
            "service_charge_type": "PERCENTAGE",
            "service_charge_value": "10.00",
        },
    )
    assert updated.status_code == 200, updated.text

    order = await _create_burger_order(
        api,
        headers,
        table_id=resources["tables"][2]["id"],
        product_id=resources["burger"]["id"],
        key="service-charge-order-0001",
    )
    assert Decimal(order["subtotal"]) == Decimal("360.00")
    assert Decimal(order["service_charge_amount"]) == Decimal("36.00")
    assert Decimal(order["total"]) == Decimal("396.00")


async def test_cashier_item_quantity_and_complimentary_flow_is_versioned_and_audited(
    api: ApiContext,
) -> None:
    headers = auth_headers(await login(api))
    resources = await seeded_resources(api, headers)
    branch_id = (await api.client.get("/api/v1/branches", headers=headers)).json()[0]["id"]
    configured = await api.client.patch(
        f"/api/v1/branches/{branch_id}",
        headers=headers,
        json={
            "service_charge_enabled": True,
            "service_charge_type": "PERCENTAGE",
            "service_charge_value": "10.00",
        },
    )
    assert configured.status_code == 200, configured.text
    order = await _create_burger_order(
        api,
        headers,
        table_id=resources["tables"][3]["id"],
        product_id=resources["burger"]["id"],
        quantity="2",
        key="cashier-item-actions-0001",
    )
    item = order["items"][0]

    increased = await api.client.patch(
        f"/api/v1/orders/{order['id']}/items/{item['id']}",
        headers=headers,
        json={
            "action": "INCREASE",
            "expected_version": order["version"],
            "idempotency_key": "cashier-item-increase-0001",
        },
    )
    assert increased.status_code == 200, increased.text
    increased_order = increased.json()
    assert Decimal(increased_order["items"][0]["quantity"]) == Decimal("3.00")
    assert Decimal(increased_order["subtotal"]) == Decimal("1080.00")
    assert Decimal(increased_order["service_charge_amount"]) == Decimal("108.00")

    stale = await api.client.patch(
        f"/api/v1/orders/{order['id']}/items/{item['id']}",
        headers=headers,
        json={
            "action": "DECREASE",
            "expected_version": order["version"],
            "idempotency_key": "cashier-item-stale-0001",
        },
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "order_version_conflict"

    complimentary = await api.client.patch(
        f"/api/v1/orders/{order['id']}/items/{item['id']}",
        headers=headers,
        json={
            "action": "SET_COMPLIMENTARY",
            "expected_version": increased_order["version"],
            "idempotency_key": "cashier-item-comp-0001",
            "reason": "Müşteri memnuniyeti",
        },
    )
    assert complimentary.status_code == 200, complimentary.text
    comp_order = complimentary.json()
    comp_item = comp_order["items"][0]
    assert comp_item["is_complimentary"] is True
    assert Decimal(comp_item["unit_price"]) == Decimal("360.00")
    assert Decimal(comp_item["line_total"]) == Decimal("0.00")
    assert Decimal(comp_order["subtotal"]) == Decimal("0.00")
    assert Decimal(comp_order["service_charge_amount"]) == Decimal("0.00")
    assert Decimal(comp_order["total"]) == Decimal("0.00")

    cashier_printer = await api.client.post(
        "/api/v1/printing/devices",
        headers=headers,
        json={
            "code": "KASA-COMP",
            "name": "Kasa Hesap Yazıcısı",
            "purpose": "CASHIER",
            "transport": "MOCK",
        },
    )
    assert cashier_printer.status_code == 201, cashier_printer.text
    bill = await api.client.post(
        "/api/v1/printing/jobs",
        headers=headers,
        json={
            "order_id": order["id"],
            "payload": {"type": "BILL", "order_id": order["id"]},
            "kind": "ORIGINAL",
            "idempotency_key": "cashier-comp-bill-0001",
        },
    )
    assert bill.status_code == 201, bill.text
    bill_line = bill.json()["payload"]["document"]["lines"][0]
    assert bill_line["complimentary"] is True
    assert Decimal(bill_line["line_total"]) == Decimal("0.00")
    assert bill.json()["printer_device_id"] == cashier_printer.json()["id"]
    after_bill = await api.client.get(f"/api/v1/orders/{order['id']}", headers=headers)
    assert after_bill.status_code == 200, after_bill.text

    restored = await api.client.patch(
        f"/api/v1/orders/{order['id']}/items/{item['id']}",
        headers=headers,
        json={
            "action": "REMOVE_COMPLIMENTARY",
            "expected_version": after_bill.json()["version"],
            "idempotency_key": "cashier-item-uncomp-0001",
            "reason": "İkram kaldırıldı",
        },
    )
    assert restored.status_code == 200, restored.text
    restored_order = restored.json()
    assert restored_order["items"][0]["is_complimentary"] is False
    assert Decimal(restored_order["subtotal"]) == Decimal("1080.00")
    assert Decimal(restored_order["total"]) == Decimal("1188.00")

    decreased = await api.client.patch(
        f"/api/v1/orders/{order['id']}/items/{item['id']}",
        headers=headers,
        json={
            "action": "DECREASE",
            "expected_version": restored_order["version"],
            "idempotency_key": "cashier-item-decrease-0001",
        },
    )
    assert decreased.status_code == 200, decreased.text
    assert Decimal(decreased.json()["items"][0]["quantity"]) == Decimal("2.00")
    assert Decimal(decreased.json()["total"]) == Decimal("792.00")

    async with api.database.session_factory() as db:
        actions = set(
            (await db.execute(select(AuditLog.action).where(AuditLog.resource_id == item["id"])))
            .scalars()
            .all()
        )
    assert {
        "order.item_quantity_increased",
        "order.item_quantity_decreased",
        "order.item_complimentary_set",
        "order.item_complimentary_removed",
    } <= actions


async def test_remove_unprinted_item_and_require_cancellation_after_preparation(
    api: ApiContext,
) -> None:
    owner_headers = auth_headers(await login(api))
    resources = await seeded_resources(api, owner_headers)
    draft_response = await api.client.post(
        "/api/v1/orders",
        headers=owner_headers,
        json={
            "table_id": resources["tables"][4]["id"],
            "items": [{"product_id": resources["burger"]["id"], "quantity": "1"}],
            "idempotency_key": "unprinted-remove-order-0001",
            "auto_accept": False,
        },
    )
    assert draft_response.status_code == 201, draft_response.text
    draft = draft_response.json()
    removed = await api.client.request(
        "DELETE",
        f"/api/v1/orders/{draft['id']}/items/{draft['items'][0]['id']}",
        headers=owner_headers,
        json={
            "expected_version": draft["version"],
            "idempotency_key": "unprinted-remove-item-0001",
            "reason": "Yanlış ürün",
        },
    )
    assert removed.status_code == 200, removed.text
    assert removed.json()["items"][0]["status"] == "VOIDED"
    assert Decimal(removed.json()["total"]) == Decimal("0.00")

    accepted = await _create_burger_order(
        api,
        owner_headers,
        table_id=resources["tables"][5]["id"],
        product_id=resources["burger"]["id"],
        key="printed-remove-order-0001",
    )
    requires_cancel = await api.client.request(
        "DELETE",
        f"/api/v1/orders/{accepted['id']}/items/{accepted['items'][0]['id']}",
        headers=owner_headers,
        json={
            "expected_version": accepted["version"],
            "idempotency_key": "printed-remove-item-0001",
            "reason": "Yanlış ürün",
        },
    )
    assert requires_cancel.status_code == 409
    assert requires_cancel.json()["error"]["code"] == "item_cancellation_required"

    cashier_headers = auth_headers(
        await login(
            api,
            username="cashier@dixora.test",
            password="DixoraLab!2026",
        )
    )
    forbidden = await api.client.patch(
        f"/api/v1/orders/{accepted['id']}/items/{accepted['items'][0]['id']}",
        headers=cashier_headers,
        json={
            "action": "SET_COMPLIMENTARY",
            "expected_version": accepted["version"],
            "idempotency_key": "cashier-comp-forbidden-0001",
            "reason": "Yetkisiz ikram",
        },
    )
    assert forbidden.status_code == 403
    assert forbidden.json()["error"]["code"] == "permission_denied"


async def test_recipe_stock_deduction_is_decimal_safe_and_idempotent(api: ApiContext) -> None:
    tokens = await login(api)
    headers = auth_headers(tokens)
    resources = await seeded_resources(api, headers)
    async with api.database.session_factory() as db:
        before = {
            str(item.inventory_item_id): Decimal(item.quantity)
            for item in (await db.execute(select(StockBalance))).scalars().all()
        }
    body = {
        "table_id": resources["tables"][1]["id"],
        "items": [{"product_id": resources["burger"]["id"], "quantity": "2"}],
        "idempotency_key": "stock-deduction-key-0001",
        "auto_accept": True,
    }
    first = await api.client.post("/api/v1/orders", json=body, headers=headers)
    assert first.status_code == 201, first.text
    replay = await api.client.post("/api/v1/orders", json=body, headers=headers)
    assert replay.status_code == 201
    assert replay.json()["id"] == first.json()["id"]

    async with api.database.session_factory() as db:
        after_rows = (await db.execute(select(StockBalance))).scalars().all()
        after = {str(item.inventory_item_id): Decimal(item.quantity) for item in after_rows}
        movement_count = (
            await db.execute(
                select(func.count(StockMovement.id)).where(
                    StockMovement.order_item_id == UUID(first.json()["items"][0]["id"])
                )
            )
        ).scalar_one()
    deltas = sorted(before[key] - after[key] for key in before)
    assert deltas == [
        Decimal("2.000000"),
        Decimal("2.000000"),
        Decimal("40.000000"),
        Decimal("300.000000"),
    ]
    assert movement_count == 4


async def test_table_transfer_moves_active_session_with_audit(api: ApiContext) -> None:
    tokens = await login(api)
    headers = auth_headers(tokens)
    resources = await seeded_resources(api, headers)
    source, destination = resources["tables"][:2]
    order = await _create_burger_order(
        api,
        headers,
        table_id=source["id"],
        product_id=resources["burger"]["id"],
        key="table-transfer-order-0001",
    )
    transfer = await api.client.post(
        f"/api/v1/orders/{order['id']}/transfer",
        headers=headers,
        json={
            "destination_table_id": destination["id"],
            "reason": "Guest requested a quieter table",
        },
    )
    assert transfer.status_code == 200, transfer.text
    old_active = await api.client.get(
        f"/api/v1/tables/{source['id']}/active-order", headers=headers
    )
    new_active = await api.client.get(
        f"/api/v1/tables/{destination['id']}/active-order", headers=headers
    )
    assert old_active.status_code == 404
    assert new_active.status_code == 200
    assert new_active.json()["id"] == order["id"]


async def test_check_split_by_item_and_amount_are_validated_and_idempotent(
    api: ApiContext,
) -> None:
    tokens = await login(api)
    headers = auth_headers(tokens)
    resources = await seeded_resources(api, headers)
    table = resources["tables"][4]
    burger = resources["burger"]
    created = await api.client.post(
        "/api/v1/orders",
        headers=headers,
        json={
            "table_id": table["id"],
            "items": [
                {"product_id": burger["id"], "quantity": "1"},
                {"product_id": burger["id"], "quantity": "1"},
            ],
            "idempotency_key": "split-source-order-0001",
            "auto_accept": True,
        },
    )
    assert created.status_code == 201, created.text
    order = created.json()
    item_split = await api.client.post(
        f"/api/v1/orders/{order['id']}/split/items",
        headers=headers,
        json={
            "item_ids": [order["items"][0]["id"]],
            "idempotency_key": "item-check-split-0001",
        },
    )
    assert item_split.status_code == 200, item_split.text
    assert Decimal(item_split.json()["total"]) == Decimal("360.00")
    item_split_replay = await api.client.post(
        f"/api/v1/orders/{order['id']}/split/items",
        headers=headers,
        json={
            "item_ids": [order["items"][0]["id"]],
            "idempotency_key": "item-check-split-0001",
        },
    )
    assert item_split_replay.status_code == 200
    assert item_split_replay.json()["id"] == item_split.json()["id"]

    amount_split = await api.client.post(
        f"/api/v1/orders/{item_split.json()['id']}/split/amount",
        headers=headers,
        json={
            "parts": ["100.00", "260.00"],
            "idempotency_key": "amount-check-split-0001",
        },
    )
    assert amount_split.status_code == 200, amount_split.text
    assert amount_split.json()["parts"] == ["100.00", "260.00"]
    invalid = await api.client.post(
        f"/api/v1/orders/{item_split.json()['id']}/split/amount",
        headers=headers,
        json={
            "parts": ["100.00", "200.00"],
            "idempotency_key": "amount-check-split-invalid",
        },
    )
    assert invalid.status_code == 409


async def test_table_merge_preserves_destination_and_voids_source(api: ApiContext) -> None:
    tokens = await login(api)
    headers = auth_headers(tokens)
    resources = await seeded_resources(api, headers)
    source_table, destination_table = resources["tables"][5:7]
    source = await _create_burger_order(
        api,
        headers,
        table_id=source_table["id"],
        product_id=resources["burger"]["id"],
        key="merge-source-order-0001",
    )
    destination = await _create_burger_order(
        api,
        headers,
        table_id=destination_table["id"],
        product_id=resources["burger"]["id"],
        key="merge-destination-order-0001",
    )
    merged = await api.client.post(
        f"/api/v1/orders/{source['id']}/merge",
        headers=headers,
        json={
            "destination_table_id": destination_table["id"],
            "idempotency_key": "table-merge-key-0001",
            "reason": "Guests joined the destination table",
        },
    )
    assert merged.status_code == 200, merged.text
    assert merged.json()["id"] == destination["id"]
    assert Decimal(merged.json()["total"]) == Decimal("720.00")
    source_after = await api.client.get(f"/api/v1/orders/{source['id']}", headers=headers)
    assert source_after.json()["status"] == "VOIDED"


async def test_item_transfer_moves_partial_quantity_to_destination_table(
    api: ApiContext,
) -> None:
    tokens = await login(api)
    headers = auth_headers(tokens)
    resources = await seeded_resources(api, headers)
    source_table, destination_table = resources["tables"][7:9]
    order = await _create_burger_order(
        api,
        headers,
        table_id=source_table["id"],
        product_id=resources["burger"]["id"],
        quantity="2",
        key="item-transfer-source-0001",
    )

    transfer = await api.client.post(
        f"/api/v1/orders/{order['id']}/items/transfer",
        headers=headers,
        json={
            "destination_table_id": destination_table["id"],
            "items": [{"item_id": order["items"][0]["id"], "quantity": "1"}],
            "idempotency_key": "item-transfer-key-0001",
            "reason": "Guest moved one item",
        },
    )
    assert transfer.status_code == 200, transfer.text
    body = transfer.json()
    assert body["source_order"]["id"] == order["id"]
    assert Decimal(body["source_order"]["subtotal"]) == Decimal("360.00")
    assert Decimal(body["destination_order"]["subtotal"]) == Decimal("360.00")
    assert body["destination_order"]["table_id"] == destination_table["id"]

    replay = await api.client.post(
        f"/api/v1/orders/{order['id']}/items/transfer",
        headers=headers,
        json={
            "destination_table_id": destination_table["id"],
            "items": [{"item_id": order["items"][0]["id"], "quantity": "1"}],
            "idempotency_key": "item-transfer-key-0001",
            "reason": "Guest moved one item",
        },
    )
    assert replay.status_code == 200
    assert replay.json()["destination_order"]["id"] == body["destination_order"]["id"]
