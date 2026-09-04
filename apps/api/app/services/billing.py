"""Turning subscriptions into invoices.

Deliberately knows nothing about how money is collected. A payment provider is
one adapter away, and none of the arithmetic here changes when it arrives —
which also means this is testable without a merchant account.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import DomainError
from app.models import Invoice, Subscription, SubscriptionPlan, Tenant
from app.models.enums import TenantState
from app.security import utcnow
from app.services.pricing import count_active_branches, money, quote_monthly_total

logger = logging.getLogger(__name__)

# Invoice lifecycle. DRAFT exists so a period can be priced and reviewed before
# anyone is charged; only ISSUED invoices are owed.
DRAFT = "DRAFT"
ISSUED = "ISSUED"
PAID = "PAID"
FAILED = "FAILED"
VOID = "VOID"

PAYMENT_TERM_DAYS = 7


def period_bounds(when: date) -> tuple[date, date]:
    """First and last day of the calendar month containing `when`."""
    start = when.replace(day=1)
    if start.month == 12:
        next_start = start.replace(year=start.year + 1, month=1)
    else:
        next_start = start.replace(month=start.month + 1)
    return start, next_start - timedelta(days=1)



@dataclass(frozen=True)
class InvoiceDraft:
    tenant_id: UUID
    subscription_id: UUID
    amount: Decimal
    base_amount: Decimal
    extra_branch_amount: Decimal
    branch_count: int
    currency: str


def invoice_number(tenant_slug: str, period_start: date) -> str:
    """Stable and readable: the same period always yields the same number."""
    return f"DX-{period_start:%Y%m}-{tenant_slug[:20].upper()}"


async def price_subscription(
    db: AsyncSession, *, subscription: Subscription
) -> InvoiceDraft:
    plan = await db.get(SubscriptionPlan, subscription.plan_id)
    if plan is None:
        raise DomainError(
            "subscription_plan_missing",
            "Abonelik planı bulunamadı.",
            status_code=409,
        )
    branches = await count_active_branches(db, subscription.tenant_id)
    total = quote_monthly_total(
        base_monthly_price=plan.monthly_price,
        included_branches=plan.included_branches,
        additional_branch_price=plan.additional_branch_price,
        active_branches=branches,
    )
    extra = money(total - plan.monthly_price)
    return InvoiceDraft(
        tenant_id=subscription.tenant_id,
        subscription_id=subscription.id,
        amount=total,
        base_amount=plan.monthly_price,
        extra_branch_amount=extra,
        branch_count=branches,
        currency=plan.currency,
    )


async def generate_invoices(
    db: AsyncSession, *, on: date | None = None
) -> list[Invoice]:
    """Issue one invoice per billable subscription for the month containing `on`.

    Safe to run repeatedly: a subscription already invoiced for the period is
    skipped, and a concurrent run loses the race to the unique constraint
    rather than double-billing.
    """
    today = on or utcnow().date()
    period_start, period_end = period_bounds(today)

    subscriptions = (
        (
            await db.execute(
                select(Subscription).where(
                    # Trials and suspended accounts are not billed; only a
                    # tenant actually using the product owes anything.
                    Subscription.status == TenantState.ACTIVE
                )
            )
        )
        .scalars()
        .all()
    )

    created: list[Invoice] = []
    for subscription in subscriptions:
        already = (
            await db.execute(
                select(Invoice.id).where(
                    Invoice.subscription_id == subscription.id,
                    Invoice.period_start == period_start,
                )
            )
        ).scalar_one_or_none()
        if already is not None:
            continue

        tenant = await db.get(Tenant, subscription.tenant_id)
        if tenant is None or not tenant.is_active:
            continue

        draft = await price_subscription(db, subscription=subscription)
        invoice = Invoice(
            tenant_id=draft.tenant_id,
            subscription_id=draft.subscription_id,
            number=invoice_number(tenant.slug, period_start),
            amount=draft.amount,
            currency=draft.currency,
            status=ISSUED,
            issued_at=utcnow(),
            due_at=utcnow() + timedelta(days=PAYMENT_TERM_DAYS),
            period_start=period_start,
            period_end=period_end,
            branch_count=draft.branch_count,
            base_amount=draft.base_amount,
            extra_branch_amount=draft.extra_branch_amount,
        )
        db.add(invoice)
        try:
            await db.flush()
        except IntegrityError:
            # Another worker issued this period first. Its row is the truth.
            await db.rollback()
            logger.info(
                "billing.invoice_race subscription=%s period=%s",
                subscription.id,
                period_start,
            )
            continue
        created.append(invoice)

    return created


async def mark_paid(db: AsyncSession, *, invoice: Invoice) -> Invoice:
    if invoice.status == PAID:
        # Providers retry webhooks; settling twice must be a no-op.
        return invoice
    if invoice.status == VOID:
        raise DomainError(
            "invoice_void", "İptal edilmiş fatura ödenemez.", status_code=409
        )
    invoice.status = PAID
    invoice.paid_at = utcnow()
    invoice.failure_reason = None
    await db.flush()
    return invoice


async def mark_failed(db: AsyncSession, *, invoice: Invoice, reason: str) -> Invoice:
    if invoice.status == PAID:
        raise DomainError(
            "invoice_already_paid",
            "Ödenmiş fatura başarısız olarak işaretlenemez.",
            status_code=409,
        )
    invoice.status = FAILED
    invoice.attempt_count += 1
    invoice.failure_reason = reason[:255]
    await db.flush()
    return invoice


async def outstanding_for_tenant(
    db: AsyncSession, *, tenant_id: UUID
) -> list[Invoice]:
    rows = (
        (
            await db.execute(
                select(Invoice)
                .where(
                    Invoice.tenant_id == tenant_id,
                    Invoice.status.in_([ISSUED, FAILED]),
                )
                .order_by(Invoice.period_start)
            )
        )
        .scalars()
        .all()
    )
    # `.all()` hands back a Sequence; the caller's contract is a list.
    return list(rows)
