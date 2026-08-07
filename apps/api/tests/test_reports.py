from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select

from app.models import Branch, KitchenTicket, Order, OrderItem, Payment, Product, Tenant
from app.models.enums import (
    KitchenTicketStatus,
    OrderItemStatus,
    OrderSource,
    OrderStatus,
    PaymentStatus,
    TenantState,
)
from tests.conftest import ApiContext, auth_headers, login


async def _seed_sales_analytics_data(
    api: ApiContext,
) -> tuple[datetime, datetime]:
    end = datetime.now(UTC)
    start = end - timedelta(hours=3)
    paid_at_1 = start + timedelta(minutes=30)
    paid_at_2 = start + timedelta(hours=1, minutes=30)

    async with api.database.session_factory() as db:
        tenant = (
            await db.execute(select(Tenant).where(Tenant.slug == "dixora-lab"))
        ).scalar_one()
        branch = (
            await db.execute(
                select(Branch).where(
                    Branch.tenant_id == tenant.id,
                    Branch.slug == "merkez",
                )
            )
        ).scalar_one()
        products = {
            product.name: product
            for product in (
                (
                    await db.execute(
                        select(Product).where(
                            Product.tenant_id == tenant.id,
                            Product.name.in_(
                                [
                                    "Classic Burger",
                                    "Caesar Salad",
                                    "Turkish Coffee",
                                    "Homemade Lemonade",
                                ]
                            ),
                        )
                    )
                )
                .scalars()
                .all()
            )
        }
        burger = products["Classic Burger"]
        salad = products["Caesar Salad"]
        coffee = products["Turkish Coffee"]
        lemonade = products["Homemade Lemonade"]

        waiter_order = Order(
            tenant_id=tenant.id,
            branch_id=branch.id,
            source=OrderSource.WAITER,
            status=OrderStatus.PAID,
            subtotal=Decimal("200.00"),
            discount_total=Decimal("20.00"),
            total=Decimal("180.00"),
            idempotency_key="reports-waiter-order-0001",
            paid_at=paid_at_1,
        )
        qr_order = Order(
            tenant_id=tenant.id,
            branch_id=branch.id,
            source=OrderSource.QR,
            status=OrderStatus.PAID,
            subtotal=Decimal("150.00"),
            discount_total=Decimal("10.00"),
            total=Decimal("140.00"),
            idempotency_key="reports-qr-order-0001",
            paid_at=paid_at_2,
        )
        db.add_all([waiter_order, qr_order])
        await db.flush()
        db.add_all(
            [
                OrderItem(
                    tenant_id=tenant.id,
                    branch_id=branch.id,
                    order_id=waiter_order.id,
                    product_id=burger.id,
                    preparation_station_id=burger.preparation_station_id,
                    product_name_snapshot=burger.name,
                    unit_price=Decimal("100.00"),
                    quantity=Decimal("2.00"),
                    line_total=Decimal("200.00"),
                    status=OrderItemStatus.SERVED,
                ),
                OrderItem(
                    tenant_id=tenant.id,
                    branch_id=branch.id,
                    order_id=waiter_order.id,
                    product_id=lemonade.id,
                    preparation_station_id=lemonade.preparation_station_id,
                    product_name_snapshot=lemonade.name,
                    unit_price=Decimal("50.00"),
                    quantity=Decimal("1.00"),
                    line_total=Decimal("50.00"),
                    status=OrderItemStatus.CANCELLED,
                ),
                OrderItem(
                    tenant_id=tenant.id,
                    branch_id=branch.id,
                    order_id=qr_order.id,
                    product_id=salad.id,
                    preparation_station_id=salad.preparation_station_id,
                    product_name_snapshot=salad.name,
                    unit_price=Decimal("50.00"),
                    quantity=Decimal("3.00"),
                    line_total=Decimal("150.00"),
                    status=OrderItemStatus.SERVED,
                ),
                OrderItem(
                    tenant_id=tenant.id,
                    branch_id=branch.id,
                    order_id=qr_order.id,
                    product_id=coffee.id,
                    preparation_station_id=coffee.preparation_station_id,
                    product_name_snapshot=coffee.name,
                    unit_price=Decimal("25.00"),
                    quantity=Decimal("1.00"),
                    line_total=Decimal("25.00"),
                    status=OrderItemStatus.VOIDED,
                ),
                KitchenTicket(
                    tenant_id=tenant.id,
                    branch_id=branch.id,
                    order_id=waiter_order.id,
                    preparation_station_id=burger.preparation_station_id,
                    status=KitchenTicketStatus.READY,
                    started_at=paid_at_1 - timedelta(minutes=30),
                    ready_at=paid_at_1 - timedelta(minutes=20),
                ),
                KitchenTicket(
                    tenant_id=tenant.id,
                    branch_id=branch.id,
                    order_id=qr_order.id,
                    preparation_station_id=salad.preparation_station_id,
                    status=KitchenTicketStatus.READY,
                    started_at=paid_at_2 - timedelta(minutes=40),
                    ready_at=paid_at_2 - timedelta(minutes=20),
                ),
                Payment(
                    tenant_id=tenant.id,
                    branch_id=branch.id,
                    order_id=waiter_order.id,
                    method="CASH",
                    amount=Decimal("180.00"),
                    status=PaymentStatus.COMPLETED,
                    idempotency_key="reports-payment-cash-0001",
                ),
                Payment(
                    tenant_id=tenant.id,
                    branch_id=branch.id,
                    order_id=qr_order.id,
                    method="CREDIT_CARD",
                    amount=Decimal("140.00"),
                    status=PaymentStatus.COMPLETED,
                    idempotency_key="reports-payment-card-0001",
                ),
            ]
        )
        await db.commit()
    return start, end


async def test_sales_analytics_aggregates_paid_orders_and_fills_empty_hour_buckets(
    api: ApiContext,
) -> None:
    start, end = await _seed_sales_analytics_data(api)
    headers = auth_headers(await login(api))
    response = await api.client.get(
        "/api/v1/reports/sales-analytics",
        headers=headers,
        params={
            "date_from": start.isoformat(),
            "date_to": end.isoformat(),
            "granularity": "hour",
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["granularity"] == "hour"
    assert Decimal(payload["gross_sales"]) == Decimal("320.00")
    assert payload["paid_orders"] == 2
    assert Decimal(payload["average_order_value"]) == Decimal("160.00")
    assert Decimal(payload["total_discount"]) == Decimal("30.00")
    assert payload["cancelled_items"] == 1
    assert payload["voided_items"] == 1
    assert Decimal(payload["average_preparation_minutes"]) == Decimal("15.00")

    assert sum(Decimal(point["gross_sales"]) for point in payload["timeseries"]) == Decimal(
        "320.00"
    )
    assert sum(point["paid_orders"] for point in payload["timeseries"]) == 2
    assert sum(Decimal(point["discount_total"]) for point in payload["timeseries"]) == Decimal(
        "30.00"
    )
    assert any(
        Decimal(point["gross_sales"]) == Decimal("0.00")
        and point["paid_orders"] == 0
        for point in payload["timeseries"]
    )

    products = {item["product_name"]: item for item in payload["by_product"]}
    assert set(products) == {"Classic Burger", "Caesar Salad"}
    assert Decimal(products["Classic Burger"]["quantity"]) == Decimal("2.00")
    assert Decimal(products["Classic Burger"]["gross_sales"]) == Decimal("200.00")
    assert products["Classic Burger"]["order_count"] == 1
    assert Decimal(products["Caesar Salad"]["quantity"]) == Decimal("3.00")
    assert Decimal(products["Caesar Salad"]["gross_sales"]) == Decimal("150.00")

    categories = {item["category_name"]: item for item in payload["by_category"]}
    assert Decimal(categories["Burgers"]["gross_sales"]) == Decimal("200.00")
    assert Decimal(categories["Salads"]["gross_sales"]) == Decimal("150.00")
    sources = {item["source"]: item for item in payload["by_order_source"]}
    assert Decimal(sources["WAITER"]["gross_sales"]) == Decimal("180.00")
    assert sources["WAITER"]["order_count"] == 1
    assert Decimal(sources["QR"]["gross_sales"]) == Decimal("140.00")

    summary = await api.client.get(
        "/api/v1/reports/sales-summary",
        headers=headers,
        params={"date_from": start.isoformat(), "date_to": end.isoformat()},
    )
    assert summary.status_code == 200, summary.text
    assert set(summary.json()) == {
        "gross_sales",
        "paid_orders",
        "average_order_value",
        "by_payment_method",
    }
    assert Decimal(summary.json()["gross_sales"]) == Decimal("320.00")
    assert Decimal(summary.json()["by_payment_method"]["CASH"]) == Decimal("180.00")
    assert Decimal(summary.json()["by_payment_method"]["CREDIT_CARD"]) == Decimal("140.00")


async def test_sales_analytics_is_tenant_and_branch_scoped(api: ApiContext) -> None:
    paid_at = datetime.now(UTC) - timedelta(hours=1)
    async with api.database.session_factory() as db:
        tenant = (
            await db.execute(select(Tenant).where(Tenant.slug == "dixora-lab"))
        ).scalar_one()
        main_branch = (
            await db.execute(
                select(Branch).where(
                    Branch.tenant_id == tenant.id,
                    Branch.slug == "merkez",
                )
            )
        ).scalar_one()
        secondary_branch = Branch(
            tenant_id=tenant.id,
            name="Reports Secondary",
            slug="reports-secondary",
        )
        foreign_tenant = Tenant(
            name="Reports Foreign",
            slug="reports-foreign",
            state=TenantState.ACTIVE,
            is_active=True,
        )
        db.add_all([secondary_branch, foreign_tenant])
        await db.flush()
        foreign_branch = Branch(
            tenant_id=foreign_tenant.id,
            name="Reports Foreign Main",
            slug="reports-foreign-main",
        )
        db.add(foreign_branch)
        await db.flush()
        db.add_all(
            [
                Order(
                    tenant_id=tenant.id,
                    branch_id=main_branch.id,
                    source=OrderSource.API,
                    status=OrderStatus.PAID,
                    subtotal=Decimal("75.00"),
                    total=Decimal("75.00"),
                    idempotency_key="reports-scope-main-0001",
                    paid_at=paid_at,
                ),
                Order(
                    tenant_id=tenant.id,
                    branch_id=secondary_branch.id,
                    source=OrderSource.DELIVERY,
                    status=OrderStatus.PAID,
                    subtotal=Decimal("500.00"),
                    total=Decimal("500.00"),
                    idempotency_key="reports-scope-secondary-0001",
                    paid_at=paid_at,
                ),
                Order(
                    tenant_id=foreign_tenant.id,
                    branch_id=foreign_branch.id,
                    source=OrderSource.KIOSK,
                    status=OrderStatus.PAID,
                    subtotal=Decimal("900.00"),
                    total=Decimal("900.00"),
                    idempotency_key="reports-scope-foreign-0001",
                    paid_at=paid_at,
                ),
            ]
        )
        await db.commit()

    headers = auth_headers(await login(api))
    response = await api.client.get(
        "/api/v1/reports/sales-analytics",
        headers=headers,
        params={
            "date_from": (paid_at - timedelta(hours=1)).isoformat(),
            "date_to": (paid_at + timedelta(hours=1)).isoformat(),
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert Decimal(payload["gross_sales"]) == Decimal("75.00")
    assert payload["paid_orders"] == 1
    assert payload["by_product"] == []
    assert payload["by_category"] == []
    assert payload["by_order_source"] == [
        {"source": "API", "gross_sales": "75.00", "order_count": 1}
    ]


async def test_sales_analytics_rejects_ranges_over_366_days(api: ApiContext) -> None:
    end = datetime.now(UTC)
    headers = auth_headers(await login(api))
    response = await api.client.get(
        "/api/v1/reports/sales-analytics",
        headers=headers,
        params={
            "date_from": (end - timedelta(days=367)).isoformat(),
            "date_to": end.isoformat(),
        },
    )
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "report_range_too_large"
