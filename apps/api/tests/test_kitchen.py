from __future__ import annotations

from tests.conftest import ApiContext, auth_headers, login, seeded_resources
from tests.test_orders import _create_burger_order


async def _advance_ticket(
    api: ApiContext, headers: dict[str, str], ticket_id: str, status: str
) -> dict:
    response = await api.client.patch(
        f"/api/v1/kitchen/tickets/{ticket_id}/status",
        headers=headers,
        json={"status": status},
    )
    assert response.status_code == 200, response.text
    return response.json()


async def test_paid_order_is_not_reverted_by_a_late_kitchen_ticket_update(
    api: ApiContext,
) -> None:
    """Regression test: a kitchen ticket completing *after* the bill was
    already paid must not clobber the order back to a kitchen-progress
    status (e.g. READY) — this previously broke closing/paying the table."""
    owner = await login(api)
    headers = auth_headers(owner)
    resources = await seeded_resources(api, headers)
    order = await _create_burger_order(
        api,
        headers,
        table_id=resources["tables"][14]["id"],
        product_id=resources["burger"]["id"],
        key="kitchen-late-update-key-0001",
    )

    tickets = await api.client.get("/api/v1/kitchen/tickets", headers=headers)
    assert tickets.status_code == 200, tickets.text
    ticket = next(item for item in tickets.json() if item["order_id"] == order["id"])

    await _advance_ticket(api, headers, ticket["id"], "ACCEPTED")
    await _advance_ticket(api, headers, ticket["id"], "PREPARING")
    ready_ticket = await _advance_ticket(api, headers, ticket["id"], "READY")
    assert ready_ticket["status"] == "READY"

    mid_flight = await api.client.get(f"/api/v1/orders/{order['id']}", headers=headers)
    assert mid_flight.json()["status"] == "READY"

    payment = await api.client.post(
        f"/api/v1/orders/{order['id']}/payments",
        headers=headers,
        json={
            "method": "CASH",
            "amount": order["total"],
            "idempotency_key": "kitchen-late-update-payment-0001",
        },
    )
    assert payment.status_code == 201, payment.text

    paid_order = await api.client.get(f"/api/v1/orders/{order['id']}", headers=headers)
    assert paid_order.json()["status"] == "PAID", paid_order.text

    # The kitchen marks the ticket completed only after the guest already paid.
    completed_ticket = await _advance_ticket(api, headers, ticket["id"], "COMPLETED")
    assert completed_ticket["status"] == "COMPLETED"

    final_order = await api.client.get(f"/api/v1/orders/{order['id']}", headers=headers)
    assert final_order.status_code == 200
    assert final_order.json()["status"] == "PAID", (
        "A late kitchen ticket update must not revert a paid order's status"
    )
    assert all(item["status"] == "SERVED" for item in final_order.json()["items"]), (
        "Item-level status should still track the ticket even when the order status is frozen"
    )
