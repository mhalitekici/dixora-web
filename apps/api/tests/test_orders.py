from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select

from app.models import StockBalance, StockMovement
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
