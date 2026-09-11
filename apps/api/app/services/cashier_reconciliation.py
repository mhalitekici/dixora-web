from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, time
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CashierShift, Order, OrderItem, Payment, Receipt


def money(value: Decimal | int) -> Decimal:
    return Decimal(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def business_window(
    timezone_name: str, target: date | None = None
) -> tuple[date, datetime, datetime]:
    try:
        zone = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        zone = ZoneInfo("Europe/Istanbul")
    local_date = target or datetime.now(zone).date()
    start = datetime.combine(local_date, time.min, tzinfo=zone).astimezone(UTC)
    end = datetime.combine(local_date, time.max, tzinfo=zone).astimezone(UTC)
    return local_date, start, end


@dataclass(frozen=True)
class ReconciliationTotals:
    opening_cash: Decimal = Decimal("0.00")
    cash_sales: Decimal = Decimal("0.00")
    card_sales: Decimal = Decimal("0.00")
    cash_refunds: Decimal = Decimal("0.00")
    card_refunds: Decimal = Decimal("0.00")
    discounts_total: Decimal = Decimal("0.00")
    complimentary_total: Decimal = Decimal("0.00")
    service_charge_total: Decimal = Decimal("0.00")
    receipt_count: int = 0

    @property
    def expected_cash(self) -> Decimal:
        return money(self.opening_cash + self.cash_sales - self.cash_refunds)

    @property
    def net_cash(self) -> Decimal:
        return money(self.cash_sales - self.cash_refunds)

    @property
    def net_card(self) -> Decimal:
        return money(self.card_sales - self.card_refunds)

    @property
    def sales_total(self) -> Decimal:
        return money(self.net_cash + self.net_card)


async def shift_totals(db: AsyncSession, shift: CashierShift) -> ReconciliationTotals:
    payments = (
        (
            await db.execute(
                select(Payment).where(
                    Payment.tenant_id == shift.tenant_id,
                    Payment.branch_id == shift.branch_id,
                    (Payment.shift_id == shift.id) | (Payment.refund_shift_id == shift.id),
                )
            )
        )
        .scalars()
        .all()
    )
    cash_sales = sum(
        (p.amount for p in payments if p.shift_id == shift.id and p.method == "CASH"), Decimal()
    )
    card_sales = sum(
        (p.amount for p in payments if p.shift_id == shift.id and p.method == "CARD"), Decimal()
    )
    cash_refunds = sum(
        (p.amount for p in payments if p.refund_shift_id == shift.id and p.method == "CASH"),
        Decimal(),
    )
    card_refunds = sum(
        (p.amount for p in payments if p.refund_shift_id == shift.id and p.method == "CARD"),
        Decimal(),
    )
    return ReconciliationTotals(
        opening_cash=money(shift.opening_cash),
        cash_sales=money(cash_sales),
        card_sales=money(card_sales),
        cash_refunds=money(cash_refunds),
        card_refunds=money(card_refunds),
    )


async def day_totals(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    branch_id: UUID,
    business_date: date,
    start: datetime,
    end: datetime,
) -> ReconciliationTotals:
    payments = (
        (
            await db.execute(
                select(Payment).where(
                    Payment.tenant_id == tenant_id,
                    Payment.branch_id == branch_id,
                    (
                        ((Payment.created_at >= start) & (Payment.created_at <= end))
                        | ((Payment.refunded_at >= start) & (Payment.refunded_at <= end))
                    ),
                )
            )
        )
        .scalars()
        .all()
    )
    cash_sales = sum(
        (p.amount for p in payments if start <= p.created_at <= end and p.method == "CASH"),
        Decimal(),
    )
    card_sales = sum(
        (p.amount for p in payments if start <= p.created_at <= end and p.method == "CARD"),
        Decimal(),
    )
    cash_refunds = sum(
        (
            p.amount
            for p in payments
            if p.refunded_at is not None and start <= p.refunded_at <= end and p.method == "CASH"
        ),
        Decimal(),
    )
    card_refunds = sum(
        (
            p.amount
            for p in payments
            if p.refunded_at is not None and start <= p.refunded_at <= end and p.method == "CARD"
        ),
        Decimal(),
    )
    opening_cash = (
        await db.execute(
            select(CashierShift.opening_cash)
            .where(
                CashierShift.tenant_id == tenant_id,
                CashierShift.branch_id == branch_id,
                CashierShift.business_date == business_date,
            )
            .order_by(CashierShift.opened_at)
            .limit(1)
        )
    ).scalar_one_or_none() or Decimal()
    order_totals = (
        await db.execute(
            select(
                func.coalesce(func.sum(Order.discount_total), 0),
                func.coalesce(func.sum(Order.service_charge_amount), 0),
            ).where(
                Order.tenant_id == tenant_id,
                Order.branch_id == branch_id,
                Order.paid_at >= start,
                Order.paid_at <= end,
            )
        )
    ).one()
    complimentary_rows = (
        await db.execute(
            select(OrderItem.unit_price, OrderItem.quantity).where(
                OrderItem.tenant_id == tenant_id,
                OrderItem.branch_id == branch_id,
                OrderItem.is_complimentary.is_(True),
                OrderItem.complimentary_at >= start,
                OrderItem.complimentary_at <= end,
            )
        )
    ).all()
    receipt_count = (
        await db.execute(
            select(func.count(Receipt.id)).where(
                Receipt.tenant_id == tenant_id,
                Receipt.branch_id == branch_id,
                Receipt.business_date == business_date,
            )
        )
    ).scalar_one()
    return ReconciliationTotals(
        opening_cash=money(opening_cash),
        cash_sales=money(cash_sales),
        card_sales=money(card_sales),
        cash_refunds=money(cash_refunds),
        card_refunds=money(card_refunds),
        discounts_total=money(order_totals[0]),
        complimentary_total=money(
            sum((price * quantity for price, quantity in complimentary_rows), Decimal())
        ),
        service_charge_total=money(order_totals[1]),
        receipt_count=receipt_count,
    )
