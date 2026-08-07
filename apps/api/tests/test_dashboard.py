from __future__ import annotations

from decimal import Decimal

from tests.conftest import ApiContext, auth_headers, login, seeded_resources
from tests.test_orders import _create_burger_order


async def test_dashboard_returns_live_operational_aggregates(api: ApiContext) -> None:
    owner = await login(api)
    headers = auth_headers(owner)
    resources = await seeded_resources(api, headers)
    order = await _create_burger_order(
        api,
        headers,
        table_id=resources["tables"][0]["id"],
        product_id=resources["burger"]["id"],
        quantity="2",
        key="dashboard-paid-order-0001",
    )
    paid = await api.client.post(
        f"/api/v1/orders/{order['id']}/payments",
        headers=headers,
        json={
            "method": "CARD",
            "amount": order["total"],
            "idempotency_key": "dashboard-payment-0001",
        },
    )
    assert paid.status_code == 201, paid.text

    response = await api.client.get("/api/v1/dashboard", headers=headers)
    assert response.status_code == 200, response.text
    summary = response.json()

    assert summary["total_tables"] == len(resources["tables"])
    assert summary["paid_orders_today"] == 1
    assert Decimal(summary["sales_today"]) == Decimal(order["total"])
    assert Decimal(summary["average_order_value"]) == Decimal(order["total"])
    assert summary["current_shift_status"] in {"OPEN", "CLOSED"}
    assert len(summary["hourly_sales"]) == 24
    assert sum(point["orders"] for point in summary["hourly_sales"]) == 1
    assert sum(Decimal(point["revenue"]) for point in summary["hourly_sales"]) == Decimal(
        order["total"]
    )
    assert summary["top_products"][0]["product_id"] == resources["burger"]["id"]
    assert Decimal(summary["top_products"][0]["quantity"]) == Decimal("2")
    assert isinstance(summary["low_stock_products"], list)
    assert summary["printer_warnings"] >= 0
    assert summary["station_warnings"] >= 0
