from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import aliased

from app.dependencies import (
    DbSession,
    Identity,
    require_branch,
    require_permissions,
    require_tenant,
)
from app.errors import DomainError
from app.models import (
    Category,
    DeliveryOrder,
    DiningTable,
    KitchenTicket,
    LoyaltyMembership,
    Order,
    OrderItem,
    Payment,
    Product,
    TableSession,
    User,
)
from app.models.enums import (
    DeliveryChannel,
    OrderItemStatus,
    OrderSource,
    OrderStatus,
    PaymentStatus,
)
from app.schemas import (
    OrderActivityOut,
    SalesAnalyticsCategoryBreakdownOut,
    SalesAnalyticsOrderSourceBreakdownOut,
    SalesAnalyticsOut,
    SalesAnalyticsProductBreakdownOut,
    SalesAnalyticsTimeBucketOut,
    SalesSummaryOut,
)
from app.security import as_utc


def _naive(value: datetime) -> datetime:
    """Order timestamps are stored naive-UTC, so incoming bounds must match.

    Comparing an aware bound against a naive column silently returned nothing.
    """
    return value.astimezone(UTC).replace(tzinfo=None) if value.tzinfo else value


router = APIRouter(prefix="/reports", tags=["reports"])
ReportReader = Annotated[Identity, Depends(require_permissions("reports.read"))]
Granularity = Literal["day", "hour"]
ZERO_MONEY = Decimal("0.00")
MONEY_QUANTUM = Decimal("0.01")


@dataclass
class _ItemBreakdown:
    name: str
    quantity: Decimal = Decimal("0")
    gross_sales: Decimal = ZERO_MONEY
    order_ids: set[UUID] = field(default_factory=set)


@dataclass
class _OrderBreakdown:
    gross_sales: Decimal = ZERO_MONEY
    order_count: int = 0


def _decimal(value: object) -> Decimal:
    return Decimal(str(value if value is not None else 0))


def _money(value: Decimal) -> Decimal:
    return value.quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)


def _analytics_range(
    date_from: datetime | None,
    date_to: datetime | None,
) -> tuple[datetime, datetime]:
    now = datetime.now(UTC)
    end = as_utc(date_to) if date_to is not None else now
    start = as_utc(date_from) if date_from is not None else end - timedelta(days=30)
    if start > end:
        raise DomainError(
            "invalid_report_range",
            "date_from must be earlier than or equal to date_to",
            status_code=422,
        )
    if end - start > timedelta(days=366):
        raise DomainError(
            "report_range_too_large",
            "Report date range cannot exceed 366 days",
            status_code=422,
        )
    return start, end


def _bucket_start(value: datetime, granularity: Granularity) -> datetime:
    value = as_utc(value)
    if granularity == "hour":
        return value.replace(minute=0, second=0, microsecond=0)
    return value.replace(hour=0, minute=0, second=0, microsecond=0)


def _duration_minutes(started_at: datetime, ready_at: datetime) -> Decimal | None:
    delta = as_utc(ready_at) - as_utc(started_at)
    if delta.total_seconds() < 0:
        return None
    seconds = Decimal(delta.days * 86_400 + delta.seconds) + (
        Decimal(delta.microseconds) / Decimal("1000000")
    )
    return seconds / Decimal("60")


@router.get("/sales-summary", response_model=SalesSummaryOut)
async def sales_summary(
    identity: ReportReader,
    db: DbSession,
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
) -> SalesSummaryOut:
    start = date_from or (datetime.now(UTC) - timedelta(days=30))
    end = date_to or datetime.now(UTC)
    tenant_id = require_tenant(identity)
    branch_id = require_branch(identity)
    predicates = [
        Order.tenant_id == tenant_id,
        Order.branch_id == branch_id,
        Order.status == OrderStatus.PAID,
        Order.paid_at >= start,
        Order.paid_at <= end,
    ]
    row = (
        await db.execute(
            select(func.coalesce(func.sum(Order.total), 0), func.count(Order.id)).where(*predicates)
        )
    ).one()
    gross = Decimal(row[0])
    paid_orders = int(row[1])
    payment_rows = (
        await db.execute(
            select(Payment.method, func.sum(Payment.amount))
            .join(Order, Order.id == Payment.order_id)
            .where(
                *predicates,
                Payment.status == PaymentStatus.COMPLETED,
            )
            .group_by(Payment.method)
        )
    ).all()
    return SalesSummaryOut(
        gross_sales=gross,
        paid_orders=paid_orders,
        average_order_value=(gross / paid_orders if paid_orders else Decimal("0.00")),
        by_payment_method={method: Decimal(amount) for method, amount in payment_rows},
    )


@router.get("/sales-analytics", response_model=SalesAnalyticsOut)
async def sales_analytics(
    identity: ReportReader,
    db: DbSession,
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    granularity: Granularity = Query(default="day"),
) -> SalesAnalyticsOut:
    start, end = _analytics_range(date_from, date_to)
    tenant_id = require_tenant(identity)
    branch_id = require_branch(identity)
    order_predicates = [
        Order.tenant_id == tenant_id,
        Order.branch_id == branch_id,
        Order.status == OrderStatus.PAID,
        Order.paid_at >= start,
        Order.paid_at <= end,
    ]
    order_rows = (
        await db.execute(
            select(
                Order.id,
                Order.paid_at,
                Order.total,
                Order.discount_total,
                Order.source,
            ).where(*order_predicates)
        )
    ).all()

    gross_sales = ZERO_MONEY
    total_discount = ZERO_MONEY
    paid_orders = 0
    bucket_sales: dict[datetime, Decimal] = {}
    bucket_discounts: dict[datetime, Decimal] = {}
    bucket_orders: dict[datetime, int] = {}
    source_breakdowns: dict[OrderSource, _OrderBreakdown] = {}
    for _order_id, paid_at, total, discount_total, source_value in order_rows:
        if paid_at is None:
            continue
        paid_orders += 1
        order_total = _decimal(total)
        order_discount = _decimal(discount_total)
        gross_sales += order_total
        total_discount += order_discount
        bucket = _bucket_start(paid_at, granularity)
        bucket_sales[bucket] = bucket_sales.get(bucket, ZERO_MONEY) + order_total
        bucket_discounts[bucket] = (
            bucket_discounts.get(bucket, ZERO_MONEY) + order_discount
        )
        bucket_orders[bucket] = bucket_orders.get(bucket, 0) + 1
        source = (
            source_value
            if isinstance(source_value, OrderSource)
            else OrderSource(str(source_value))
        )
        source_breakdown = source_breakdowns.setdefault(source, _OrderBreakdown())
        source_breakdown.gross_sales += order_total
        source_breakdown.order_count += 1

    product_breakdowns: dict[UUID, _ItemBreakdown] = {}
    category_breakdowns: dict[UUID, _ItemBreakdown] = {}
    cancelled_items = 0
    voided_items = 0
    item_rows = (
        await db.execute(
            select(
                OrderItem.order_id,
                OrderItem.product_id,
                OrderItem.product_name_snapshot,
                OrderItem.quantity,
                OrderItem.line_total,
                OrderItem.status,
                Product.category_id,
                Category.name,
            )
            .join(
                Order,
                (Order.id == OrderItem.order_id)
                & (Order.tenant_id == OrderItem.tenant_id),
            )
            .join(
                Product,
                (Product.id == OrderItem.product_id)
                & (Product.tenant_id == OrderItem.tenant_id),
            )
            .join(
                Category,
                (Category.id == Product.category_id)
                & (Category.tenant_id == Product.tenant_id),
            )
            .where(
                *order_predicates,
                OrderItem.tenant_id == tenant_id,
                OrderItem.branch_id == branch_id,
            )
        )
    ).all()
    for (
        order_id,
        product_id,
        product_name,
        quantity,
        line_total,
        status_value,
        category_id,
        category_name,
    ) in item_rows:
        item_status = (
            status_value
            if isinstance(status_value, OrderItemStatus)
            else OrderItemStatus(str(status_value))
        )
        if item_status == OrderItemStatus.CANCELLED:
            cancelled_items += 1
            continue
        if item_status == OrderItemStatus.VOIDED:
            voided_items += 1
            continue
        item_quantity = _decimal(quantity)
        item_sales = _decimal(line_total)
        product_breakdown = product_breakdowns.setdefault(
            product_id,
            _ItemBreakdown(name=product_name),
        )
        product_breakdown.quantity += item_quantity
        product_breakdown.gross_sales += item_sales
        product_breakdown.order_ids.add(order_id)
        category_breakdown = category_breakdowns.setdefault(
            category_id,
            _ItemBreakdown(name=category_name),
        )
        category_breakdown.quantity += item_quantity
        category_breakdown.gross_sales += item_sales
        category_breakdown.order_ids.add(order_id)

    preparation_rows = (
        await db.execute(
            select(KitchenTicket.started_at, KitchenTicket.ready_at)
            .join(
                Order,
                (Order.id == KitchenTicket.order_id)
                & (Order.tenant_id == KitchenTicket.tenant_id),
            )
            .where(
                *order_predicates,
                KitchenTicket.tenant_id == tenant_id,
                KitchenTicket.branch_id == branch_id,
                KitchenTicket.started_at.is_not(None),
                KitchenTicket.ready_at.is_not(None),
            )
        )
    ).all()
    preparation_durations = [
        duration
        for started_at, ready_at in preparation_rows
        if started_at is not None
        and ready_at is not None
        and (duration := _duration_minutes(started_at, ready_at)) is not None
    ]
    average_preparation_minutes = (
        (
            sum(preparation_durations, Decimal("0"))
            / Decimal(len(preparation_durations))
        ).quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)
        if preparation_durations
        else None
    )

    step = timedelta(hours=1) if granularity == "hour" else timedelta(days=1)
    cursor = _bucket_start(start, granularity)
    last_bucket = _bucket_start(end, granularity)
    timeseries: list[SalesAnalyticsTimeBucketOut] = []
    while cursor <= last_bucket:
        timeseries.append(
            SalesAnalyticsTimeBucketOut(
                bucket=cursor,
                gross_sales=_money(bucket_sales.get(cursor, ZERO_MONEY)),
                paid_orders=bucket_orders.get(cursor, 0),
                discount_total=_money(
                    bucket_discounts.get(cursor, ZERO_MONEY)
                ),
            )
        )
        cursor += step

    by_product = [
        SalesAnalyticsProductBreakdownOut(
            product_id=product_id,
            product_name=breakdown.name,
            quantity=breakdown.quantity,
            gross_sales=_money(breakdown.gross_sales),
            order_count=len(breakdown.order_ids),
        )
        for product_id, breakdown in sorted(
            product_breakdowns.items(),
            key=lambda item: (-item[1].gross_sales, item[1].name.casefold()),
        )
    ]
    by_category = [
        SalesAnalyticsCategoryBreakdownOut(
            category_id=category_id,
            category_name=breakdown.name,
            quantity=breakdown.quantity,
            gross_sales=_money(breakdown.gross_sales),
            order_count=len(breakdown.order_ids),
        )
        for category_id, breakdown in sorted(
            category_breakdowns.items(),
            key=lambda item: (-item[1].gross_sales, item[1].name.casefold()),
        )
    ]
    by_order_source = [
        SalesAnalyticsOrderSourceBreakdownOut(
            source=source,
            gross_sales=_money(breakdown.gross_sales),
            order_count=breakdown.order_count,
        )
        for source, breakdown in sorted(
            source_breakdowns.items(),
            key=lambda item: (-item[1].gross_sales, item[0].value),
        )
    ]
    gross_sales = _money(gross_sales)
    return SalesAnalyticsOut(
        date_from=start,
        date_to=end,
        granularity=granularity,
        gross_sales=gross_sales,
        paid_orders=paid_orders,
        average_order_value=(
            _money(gross_sales / Decimal(paid_orders))
            if paid_orders
            else ZERO_MONEY
        ),
        total_discount=_money(total_discount),
        cancelled_items=cancelled_items,
        voided_items=voided_items,
        average_preparation_minutes=average_preparation_minutes,
        timeseries=timeseries,
        by_product=by_product,
        by_category=by_category,
        by_order_source=by_order_source,
    )


@router.get("/order-activity", response_model=list[OrderActivityOut])
async def order_activity(
    identity: ReportReader,
    db: DbSession,
    branch_id: UUID | None = Query(default=None),
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
) -> list[OrderActivityOut]:
    """Who put what through the till, most recent first.

    One row per order with the attribution a manager actually asks about: which
    channel it came from, which member of staff, which table, whether a loyalty
    code was used, and — for package orders — the delivery channel.
    """
    tenant_id = require_tenant(identity)
    if branch_id is not None:
        # Validates membership; a browser-supplied branch is never trusted.
        scope = {require_branch(identity, branch_id)}
    else:
        scope = set(identity.accessible_branch_ids)
    if not scope:
        return []

    staff = aliased(User)
    query = (
        select(
            Order.id,
            Order.created_at,
            Order.status,
            Order.source,
            Order.total,
            Order.branch_id,
            DiningTable.name.label("table_name"),
            staff.display_name.label("staff_name"),
            LoyaltyMembership.lookup_code.label("member_code"),
            DeliveryOrder.channel.label("delivery_channel"),
            DeliveryOrder.customer_name.label("delivery_customer"),
        )
        .select_from(Order)
        # An order reaches its table through the session, not directly.
        .outerjoin(TableSession, TableSession.id == Order.table_session_id)
        .outerjoin(DiningTable, DiningTable.id == TableSession.table_id)
        .outerjoin(staff, staff.id == Order.created_by_user_id)
        .outerjoin(
            LoyaltyMembership, LoyaltyMembership.id == Order.loyalty_membership_id
        )
        .outerjoin(DeliveryOrder, DeliveryOrder.order_id == Order.id)
        .where(Order.tenant_id == tenant_id, Order.branch_id.in_(sorted(scope)))
    )
    if date_from is not None:
        query = query.where(Order.created_at >= _naive(date_from))
    if date_to is not None:
        query = query.where(Order.created_at <= _naive(date_to))
    query = query.order_by(Order.created_at.desc()).limit(limit)
    rows = (await db.execute(query)).all()
    return [
        OrderActivityOut(
            order_id=row.id,
            created_at=row.created_at,
            branch_id=row.branch_id,
            status=OrderStatus(row.status).value,
            source=OrderSource(row.source).value,
            table_name=row.table_name,
            # QR orders have no operator, which is itself the useful fact.
            staff_name=row.staff_name,
            member_code=row.member_code,
            delivery_channel=(
                DeliveryChannel(row.delivery_channel).value
                if row.delivery_channel
                else None
            ),
            customer_name=row.delivery_customer,
            total=row.total,
        )
        for row in rows
    ]
