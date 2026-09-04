"""Turning subscriptions into invoices.

The invoices table existed for a long time with nothing writing to it, so every
rule here is new and none of it has ever been exercised in production.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.models import Invoice, Subscription, SubscriptionPlan, Tenant
from app.models.enums import TenantState
from app.services.billing import (
    ISSUED,
    PAID,
    generate_invoices,
    invoice_number,
    mark_failed,
    mark_paid,
    period_bounds,
)
from tests.conftest import ApiContext


async def _activate_subscription(api: ApiContext) -> None:
    """Put the seeded business onto the paid plan.

    It ships on a trial, which is priced at zero and capped at one branch —
    deliberately not billable. Flipping only the status would leave a nonsense
    state: an active subscription to a free plan.
    """
    async with api.database.session_factory() as db:
        subscription = (await db.execute(select(Subscription))).scalars().first()
        assert subscription is not None
        standard = (
            await db.execute(
                select(SubscriptionPlan).where(SubscriptionPlan.code == "STANDARD")
            )
        ).scalar_one()
        subscription.plan_id = standard.id
        subscription.status = TenantState.ACTIVE
        await db.commit()


def test_period_bounds_cover_the_whole_month() -> None:
    assert period_bounds(date(2026, 8, 13)) == (date(2026, 8, 1), date(2026, 8, 31))
    # February, and a year boundary — the two places month arithmetic breaks.
    assert period_bounds(date(2026, 2, 5)) == (date(2026, 2, 1), date(2026, 2, 28))
    assert period_bounds(date(2026, 12, 20)) == (date(2026, 12, 1), date(2026, 12, 31))


def test_the_invoice_number_is_stable_for_a_period() -> None:
    """Re-running billing must not mint a second number for the same month."""
    first = invoice_number("dixora-lab", date(2026, 8, 1))
    assert first == invoice_number("dixora-lab", date(2026, 8, 1))
    assert first != invoice_number("dixora-lab", date(2026, 9, 1))


async def test_an_active_subscription_is_billed_for_its_branches(
    api: ApiContext,
) -> None:
    await _activate_subscription(api)
    async with api.database.session_factory() as db:
        subscription = (await db.execute(select(Subscription))).scalars().first()
        assert subscription is not None
        plan = await db.get(SubscriptionPlan, subscription.plan_id)
        assert plan is not None

        invoices = await generate_invoices(db, on=date(2026, 8, 13))
        await db.commit()

        assert len(invoices) == 1
        invoice = invoices[0]
        assert invoice.status == ISSUED
        assert invoice.period_start == date(2026, 8, 1)
        assert invoice.period_end == date(2026, 8, 31)
        # The bill is base + extras, and the breakdown adds back up.
        assert invoice.base_amount == plan.monthly_price
        assert invoice.amount == invoice.base_amount + invoice.extra_branch_amount
        assert invoice.branch_count >= 1


async def test_running_billing_twice_does_not_invoice_the_month_twice(
    api: ApiContext,
) -> None:
    await _activate_subscription(api)
    async with api.database.session_factory() as db:
        first = await generate_invoices(db, on=date(2026, 8, 13))
        await db.commit()
        second = await generate_invoices(db, on=date(2026, 8, 20))
        await db.commit()

        assert len(first) == 1
        # Same month, later day: nothing new is owed.
        assert second == []
        rows = (await db.execute(select(Invoice))).scalars().all()
        assert len(rows) == 1


async def test_a_new_month_is_billed_separately(api: ApiContext) -> None:
    await _activate_subscription(api)
    async with api.database.session_factory() as db:
        await generate_invoices(db, on=date(2026, 8, 13))
        await db.commit()
        september = await generate_invoices(db, on=date(2026, 9, 2))
        await db.commit()

        assert len(september) == 1
        assert september[0].period_start == date(2026, 9, 1)


async def test_an_inactive_business_is_not_billed(api: ApiContext) -> None:
    """Suspending a business must stop the meter, not just hide the screens."""
    await _activate_subscription(api)
    async with api.database.session_factory() as db:
        tenant = (await db.execute(select(Tenant))).scalars().first()
        assert tenant is not None
        tenant.is_active = False
        await db.commit()

        invoices = await generate_invoices(db, on=date(2026, 8, 13))
        await db.commit()
        assert invoices == []


async def test_an_extra_branch_raises_next_month_but_not_last(
    api: ApiContext,
) -> None:
    """The breakdown is frozen at issue time.

    A branch opened in September must not quietly change what August cost.
    """
    await _activate_subscription(api)
    async with api.database.session_factory() as db:
        august = (await generate_invoices(db, on=date(2026, 8, 13)))[0]
        august_amount = august.amount
        august_branches = august.branch_count
        await db.commit()

    headers = {}
    tokens = await _login(api)
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    created = await api.client.post(
        "/api/v1/branches",
        headers=headers,
        json={"name": "İkinci Şube", "slug": f"sube-{august_branches + 1}"},
    )
    assert created.status_code == 201, created.text

    async with api.database.session_factory() as db:
        september = (await generate_invoices(db, on=date(2026, 9, 1)))[0]
        await db.commit()

        assert september.branch_count == august_branches + 1
        assert september.amount > august_amount

        stored_august = await db.get(Invoice, august.id)
        assert stored_august is not None
        assert stored_august.amount == august_amount
        assert stored_august.branch_count == august_branches


async def test_settling_an_invoice_twice_is_harmless(api: ApiContext) -> None:
    """Payment providers retry their webhooks."""
    await _activate_subscription(api)
    async with api.database.session_factory() as db:
        invoice = (await generate_invoices(db, on=date(2026, 8, 13)))[0]
        await mark_paid(db, invoice=invoice)
        first_paid_at = invoice.paid_at
        await mark_paid(db, invoice=invoice)
        await db.commit()

        assert invoice.status == PAID
        assert invoice.paid_at == first_paid_at


async def test_a_paid_invoice_cannot_be_marked_failed(api: ApiContext) -> None:
    """A late failure webhook must not un-pay a settled bill."""
    await _activate_subscription(api)
    from app.errors import DomainError

    async with api.database.session_factory() as db:
        invoice = (await generate_invoices(db, on=date(2026, 8, 13)))[0]
        await mark_paid(db, invoice=invoice)
        with pytest.raises(DomainError) as excinfo:
            await mark_failed(db, invoice=invoice, reason="kart reddedildi")
        assert excinfo.value.code == "invoice_already_paid"


async def test_a_failed_attempt_is_counted_and_explained(api: ApiContext) -> None:
    await _activate_subscription(api)
    async with api.database.session_factory() as db:
        invoice = (await generate_invoices(db, on=date(2026, 8, 13)))[0]
        await mark_failed(db, invoice=invoice, reason="Yetersiz bakiye")
        await mark_failed(db, invoice=invoice, reason="Yetersiz bakiye")
        await db.commit()

        assert invoice.attempt_count == 2
        assert invoice.failure_reason == "Yetersiz bakiye"
        # Priced from the paid plan, so a real amount is still owed.
        assert invoice.amount > Decimal("0")


async def _login(api: ApiContext) -> dict:
    response = await api.client.post(
        "/api/v1/auth/login",
        json={
            "business": "dixora-lab",
            "username": "owner@dixora.test",
            "password": "DixoraLab!2026",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()
