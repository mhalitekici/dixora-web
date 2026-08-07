from __future__ import annotations

from uuid import UUID

from sqlalchemy import select

from app.models import AuditLog, DiningTable, Order, TableSession
from app.models.enums import OrderStatus, TableSessionStatus, TableState
from tests.conftest import ApiContext, auth_headers, login, seeded_resources


async def _create_cashier_order(
    api: ApiContext,
    headers: dict[str, str],
    *,
    table_id: str,
    product_id: str,
    idempotency_key: str,
) -> dict:
    response = await api.client.post(
        "/api/v1/orders",
        headers=headers,
        json={
            "table_id": table_id,
            "items": [{"product_id": product_id, "quantity": "1"}],
            "idempotency_key": idempotency_key,
            "auto_accept": True,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _table(api: ApiContext, headers: dict[str, str], table_id: str) -> dict:
    response = await api.client.get(f"/api/v1/tables/{table_id}", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


async def test_cashier_closes_only_the_exact_fully_settled_table_session(
    api: ApiContext,
) -> None:
    cashier = await login(api, username="cashier@dixora.test")
    headers = auth_headers(cashier)
    resources = await seeded_resources(api, headers)
    selected_table = resources["tables"][2]
    order = await _create_cashier_order(
        api,
        headers,
        table_id=selected_table["id"],
        product_id=resources["burger"]["id"],
        idempotency_key="cashier-close-order-0001",
    )
    session_id = order["table_session_id"]
    table_before_payment = await _table(api, headers, selected_table["id"])

    unpaid_close = await api.client.post(
        f"/api/v1/tables/{selected_table['id']}/sessions/{session_id}/close",
        headers=headers,
        json={"expected_table_version": table_before_payment["version"]},
    )
    assert unpaid_close.status_code == 409
    assert unpaid_close.json()["error"]["code"] == "table_has_open_orders"

    waiter = await login(api, username="waiter@dixora.test")
    waiter_close = await api.client.post(
        f"/api/v1/tables/{selected_table['id']}/sessions/{session_id}/close",
        headers=auth_headers(waiter),
        json={"expected_table_version": table_before_payment["version"]},
    )
    assert waiter_close.status_code == 403
    assert waiter_close.json()["error"]["code"] == "permission_denied"

    payment = await api.client.post(
        f"/api/v1/orders/{order['id']}/payments",
        headers=headers,
        json={
            "method": "CASH",
            "amount": order["total"],
            "idempotency_key": "cashier-close-payment-0001",
        },
    )
    assert payment.status_code == 201, payment.text
    settled_table = await _table(api, headers, selected_table["id"])
    assert settled_table["state"] == TableState.CLEANING.value

    stale_close = await api.client.post(
        f"/api/v1/tables/{selected_table['id']}/sessions/{session_id}/close",
        headers=headers,
        json={"expected_table_version": settled_table["version"] - 1},
    )
    assert stale_close.status_code == 409
    assert stale_close.json()["error"]["code"] == "table_version_conflict"

    close = await api.client.post(
        f"/api/v1/tables/{selected_table['id']}/sessions/{session_id}/close",
        headers=headers,
        json={"expected_table_version": settled_table["version"]},
    )
    assert close.status_code == 200, close.text
    assert close.json()["already_closed"] is False
    assert close.json()["table"]["state"] == TableState.AVAILABLE.value
    closed_version = close.json()["table"]["version"]

    async with api.database.session_factory() as db:
        session = await db.get(TableSession, UUID(session_id))
        table = await db.get(DiningTable, UUID(selected_table["id"]))
        audit = (
            await db.execute(
                select(AuditLog).where(
                    AuditLog.action == "table_session.closed",
                    AuditLog.resource_id == session_id,
                )
            )
        ).scalar_one()
        assert session is not None
        assert session.status == TableSessionStatus.CLOSED
        assert session.closed_at is not None
        assert table is not None
        assert table.version == closed_version
        assert audit.actor_role == "CASHIER"

    replay = await api.client.post(
        f"/api/v1/tables/{selected_table['id']}/sessions/{session_id}/close",
        headers=headers,
        json={"expected_table_version": settled_table["version"]},
    )
    assert replay.status_code == 200, replay.text
    assert replay.json()["already_closed"] is True
    assert replay.json()["table"]["version"] == closed_version

    new_order = await _create_cashier_order(
        api,
        headers,
        table_id=selected_table["id"],
        product_id=resources["burger"]["id"],
        idempotency_key="cashier-close-order-0002",
    )
    assert new_order["table_session_id"] != session_id
    safe_replay = await api.client.post(
        f"/api/v1/tables/{selected_table['id']}/sessions/{session_id}/close",
        headers=headers,
        json={"expected_table_version": closed_version},
    )
    assert safe_replay.status_code == 200, safe_replay.text
    assert safe_replay.json()["already_closed"] is True
    assert safe_replay.json()["table"]["state"] == TableState.PREPARING.value

    active = await api.client.get(
        f"/api/v1/tables/{selected_table['id']}/active-order",
        headers=headers,
    )
    assert active.status_code == 200, active.text
    assert active.json()["id"] == new_order["id"]


async def test_table_close_rejects_paid_status_with_an_unsettled_balance(
    api: ApiContext,
) -> None:
    cashier = await login(api, username="cashier@dixora.test")
    headers = auth_headers(cashier)
    resources = await seeded_resources(api, headers)
    selected_table = resources["tables"][3]
    order_payload = await _create_cashier_order(
        api,
        headers,
        table_id=selected_table["id"],
        product_id=resources["burger"]["id"],
        idempotency_key="cashier-unsettled-order-0001",
    )

    async with api.database.session_factory() as db:
        order = await db.get(Order, UUID(order_payload["id"]))
        table = await db.get(DiningTable, UUID(selected_table["id"]))
        assert order is not None
        assert table is not None
        order.status = OrderStatus.PAID
        table.state = TableState.CLEANING
        table.version += 1
        expected_version = table.version
        await db.commit()

    response = await api.client.post(
        (
            f"/api/v1/tables/{selected_table['id']}/sessions/"
            f"{order_payload['table_session_id']}/close"
        ),
        headers=headers,
        json={"expected_table_version": expected_version},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "table_has_unsettled_balance"
