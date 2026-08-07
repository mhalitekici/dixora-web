from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends
from sqlalchemy import func, or_, select

from app.dependencies import (
    DbSession,
    Identity,
    require_branch,
    require_permissions,
    require_tenant,
)
from app.models import (
    Branch,
    Cancellation,
    CashierShift,
    DiningTable,
    Discount,
    InventoryItem,
    KitchenTicket,
    Order,
    OrderItem,
    PrinterDevice,
    PrintJob,
    StockBalance,
)
from app.models.enums import (
    KitchenTicketStatus,
    OrderItemStatus,
    OrderStatus,
    PrintJobStatus,
    TableState,
)
from app.schemas import (
    DashboardHourlySaleOut,
    DashboardLowStockOut,
    DashboardOut,
    DashboardTopProductOut,
)

router = APIRouter(prefix="/dashboard", tags=["dashboard"])
DashboardReader = Annotated[Identity, Depends(require_permissions("dashboard.read"))]


def _branch_day_bounds(timezone_name: str) -> tuple[datetime, datetime, ZoneInfo]:
    try:
        branch_timezone = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        branch_timezone = ZoneInfo("UTC")
    local_now = datetime.now(branch_timezone)
    local_start = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    start = local_start.astimezone(UTC)
    return start, (local_start + timedelta(days=1)).astimezone(UTC), branch_timezone


@router.get("", response_model=DashboardOut)
async def dashboard(identity: DashboardReader, db: DbSession) -> DashboardOut:
    tenant_id = require_tenant(identity)
    branch_id = require_branch(identity)
    timezone_name = (
        await db.execute(
            select(Branch.timezone).where(
                Branch.id == branch_id,
                Branch.tenant_id == tenant_id,
            )
        )
    ).scalar_one()
    today, tomorrow, branch_timezone = _branch_day_bounds(timezone_name)
    table_predicates = [
        DiningTable.tenant_id == tenant_id,
        DiningTable.branch_id == branch_id,
        DiningTable.is_active.is_(True),
    ]
    total_tables = (
        await db.execute(select(func.count(DiningTable.id)).where(*table_predicates))
    ).scalar_one()
    open_tables = (
        await db.execute(
            select(func.count(DiningTable.id)).where(
                *table_predicates,
                DiningTable.state.notin_([TableState.AVAILABLE, TableState.DISABLED]),
            )
        )
    ).scalar_one()
    active_statuses = [
        OrderStatus.SUBMITTED,
        OrderStatus.AWAITING_APPROVAL,
        OrderStatus.ACCEPTED,
        OrderStatus.PREPARING,
        OrderStatus.PARTIALLY_READY,
        OrderStatus.READY,
        OrderStatus.SERVED,
        OrderStatus.BILL_REQUESTED,
        OrderStatus.PAYMENT_PENDING,
    ]
    active_orders = (
        await db.execute(
            select(func.count(Order.id)).where(
                Order.tenant_id == tenant_id,
                Order.branch_id == branch_id,
                Order.status.in_(active_statuses),
            )
        )
    ).scalar_one()
    waiting = (
        await db.execute(
            select(func.count(Order.id)).where(
                Order.tenant_id == tenant_id,
                Order.branch_id == branch_id,
                Order.status.in_(
                    [OrderStatus.SUBMITTED, OrderStatus.ACCEPTED, OrderStatus.PREPARING]
                ),
            )
        )
    ).scalar_one()
    ready = (
        await db.execute(
            select(func.count(Order.id)).where(
                Order.tenant_id == tenant_id,
                Order.branch_id == branch_id,
                Order.status.in_([OrderStatus.PARTIALLY_READY, OrderStatus.READY]),
            )
        )
    ).scalar_one()
    paid_rows = (
        await db.execute(
            select(Order.total, Order.paid_at).where(
                Order.tenant_id == tenant_id,
                Order.branch_id == branch_id,
                Order.status == OrderStatus.PAID,
                Order.paid_at >= today,
                Order.paid_at < tomorrow,
            )
        )
    ).all()
    sales = sum((Decimal(total) for total, _paid_at in paid_rows), Decimal("0.00"))
    paid_orders = len(paid_rows)
    average_order_value = sales / paid_orders if paid_orders else Decimal("0.00")

    hourly_revenue = {hour: Decimal("0.00") for hour in range(24)}
    hourly_orders = {hour: 0 for hour in range(24)}
    for total, paid_at in paid_rows:
        if paid_at is None:
            continue
        aware_paid_at = paid_at if paid_at.tzinfo else paid_at.replace(tzinfo=UTC)
        hour = aware_paid_at.astimezone(branch_timezone).hour
        hourly_revenue[hour] += Decimal(total)
        hourly_orders[hour] += 1
    hourly_sales = [
        DashboardHourlySaleOut(
            hour=f"{hour:02d}:00",
            revenue=hourly_revenue[hour],
            orders=hourly_orders[hour],
        )
        for hour in range(24)
    ]

    top_product_rows = (
        await db.execute(
            select(
                OrderItem.product_id,
                OrderItem.product_name_snapshot,
                func.coalesce(func.sum(OrderItem.quantity), 0),
                func.coalesce(func.sum(OrderItem.line_total), 0),
            )
            .join(Order, Order.id == OrderItem.order_id)
            .where(
                Order.tenant_id == tenant_id,
                Order.branch_id == branch_id,
                Order.status == OrderStatus.PAID,
                Order.paid_at >= today,
                Order.paid_at < tomorrow,
                OrderItem.status.notin_([OrderItemStatus.CANCELLED, OrderItemStatus.VOIDED]),
            )
            .group_by(OrderItem.product_id, OrderItem.product_name_snapshot)
            .order_by(func.sum(OrderItem.quantity).desc())
            .limit(5)
        )
    ).all()
    top_products = [
        DashboardTopProductOut(
            product_id=product_id,
            name=name,
            quantity=Decimal(quantity),
            revenue=Decimal(revenue),
        )
        for product_id, name, quantity, revenue in top_product_rows
    ]

    balance_totals = (
        select(
            StockBalance.inventory_item_id.label("inventory_item_id"),
            func.coalesce(func.sum(StockBalance.quantity), 0).label("current_stock"),
        )
        .where(
            StockBalance.tenant_id == tenant_id,
            StockBalance.branch_id == branch_id,
        )
        .group_by(StockBalance.inventory_item_id)
        .subquery()
    )
    current_stock = func.coalesce(balance_totals.c.current_stock, 0)
    low_stock_rows = (
        await db.execute(
            select(
                InventoryItem.id,
                InventoryItem.name,
                InventoryItem.unit,
                current_stock,
                InventoryItem.minimum_stock,
            )
            .outerjoin(
                balance_totals,
                balance_totals.c.inventory_item_id == InventoryItem.id,
            )
            .where(
                InventoryItem.tenant_id == tenant_id,
                InventoryItem.branch_id == branch_id,
                InventoryItem.is_active.is_(True),
                current_stock <= InventoryItem.minimum_stock,
            )
            .order_by(
                (InventoryItem.minimum_stock - current_stock).desc(),
                InventoryItem.name,
            )
        )
    ).all()
    low_stock_products = [
        DashboardLowStockOut(
            item_id=item_id,
            name=name,
            unit=unit,
            current_stock=Decimal(stock),
            minimum_stock=Decimal(minimum),
        )
        for item_id, name, unit, stock, minimum in low_stock_rows[:5]
    ]

    cancelled_items = (
        await db.execute(
            select(func.count(Cancellation.id)).where(
                Cancellation.tenant_id == tenant_id,
                Cancellation.branch_id == branch_id,
                Cancellation.order_item_id.is_not(None),
                Cancellation.created_at >= today,
                Cancellation.created_at < tomorrow,
            )
        )
    ).scalar_one()
    discounts = (
        await db.execute(
            select(func.coalesce(func.sum(Discount.amount), 0)).where(
                Discount.tenant_id == tenant_id,
                Discount.branch_id == branch_id,
                Discount.created_at >= today,
                Discount.created_at < tomorrow,
            )
        )
    ).scalar_one()
    open_shift = (
        await db.execute(
            select(func.count(CashierShift.id)).where(
                CashierShift.tenant_id == tenant_id,
                CashierShift.branch_id == branch_id,
                CashierShift.status == "OPEN",
            )
        )
    ).scalar_one()
    stale_before = datetime.now(UTC) - timedelta(minutes=5)
    printer_device_warnings = (
        await db.execute(
            select(func.count(PrinterDevice.id)).where(
                PrinterDevice.tenant_id == tenant_id,
                PrinterDevice.branch_id == branch_id,
                or_(
                    PrinterDevice.is_active.is_(False),
                    PrinterDevice.last_seen_at.is_(None),
                    PrinterDevice.last_seen_at < stale_before,
                ),
            )
        )
    ).scalar_one()
    failed_print_jobs = (
        await db.execute(
            select(func.count(PrintJob.id)).where(
                PrintJob.tenant_id == tenant_id,
                PrintJob.branch_id == branch_id,
                PrintJob.status == PrintJobStatus.FAILED,
                PrintJob.created_at >= today,
                PrintJob.created_at < tomorrow,
            )
        )
    ).scalar_one()
    delayed_before = datetime.now(UTC) - timedelta(minutes=15)
    station_warnings = (
        await db.execute(
            select(func.count(KitchenTicket.id)).where(
                KitchenTicket.tenant_id == tenant_id,
                KitchenTicket.branch_id == branch_id,
                KitchenTicket.status.in_(
                    [
                        KitchenTicketStatus.NEW,
                        KitchenTicketStatus.ACCEPTED,
                        KitchenTicketStatus.PREPARING,
                    ]
                ),
                KitchenTicket.created_at < delayed_before,
            )
        )
    ).scalar_one()

    return DashboardOut(
        open_tables=open_tables,
        total_tables=total_tables,
        active_orders=active_orders,
        waiting_preparation=waiting,
        ready_orders=ready,
        sales_today=Decimal(sales),
        paid_orders_today=paid_orders,
        average_order_value=average_order_value,
        low_stock_items=len(low_stock_rows),
        cancelled_items_today=cancelled_items,
        discounts_today=Decimal(discounts),
        current_shift_status="OPEN" if open_shift else "CLOSED",
        printer_warnings=printer_device_warnings + failed_print_jobs,
        station_warnings=station_warnings,
        hourly_sales=hourly_sales,
        top_products=top_products,
        low_stock_products=low_stock_products,
    )
