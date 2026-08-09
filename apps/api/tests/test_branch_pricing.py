from __future__ import annotations

from decimal import Decimal

import pytest
from sqlalchemy import select

from app.models import Branch, Subscription, SubscriptionPlan, Tenant
from app.services.pricing import (
    DEFAULT_ADDITIONAL_BRANCH_PRICE,
    DEFAULT_BASE_MONTHLY_PRICE,
    DEFAULT_INCLUDED_BRANCHES,
    branch_pricing_for_tenant,
    quote_monthly_total,
)
from tests.conftest import ApiContext


def _quote(active_branches: int) -> Decimal:
    return quote_monthly_total(
        base_monthly_price=DEFAULT_BASE_MONTHLY_PRICE,
        included_branches=DEFAULT_INCLUDED_BRANCHES,
        additional_branch_price=DEFAULT_ADDITIONAL_BRANCH_PRICE,
        active_branches=active_branches,
    )


@pytest.mark.parametrize(
    ("branches", "expected"),
    [
        (1, Decimal("1200.00")),
        (2, Decimal("2050.00")),
        (3, Decimal("2900.00")),
        (5, Decimal("4600.00")),
    ],
)
def test_published_price_points(branches: int, expected: Decimal) -> None:
    assert _quote(branches) == expected


def test_zero_branches_never_prices_below_the_base() -> None:
    assert _quote(0) == Decimal("1200.00")


async def test_trial_tenant_is_not_billed_per_branch(api: ApiContext) -> None:
    """A trial business pays nothing regardless of how many branches it opens."""
    async with api.database.session_factory() as db:
        tenant = (
            await db.execute(select(Tenant).where(Tenant.slug == "dixora-lab"))
        ).scalar_one()
        db.add(
            Branch(
                tenant_id=tenant.id,
                name="Deneme Şube",
                slug="deneme-sube",
                timezone="Europe/Istanbul",
                is_active=True,
            )
        )
        await db.commit()
        pricing = await branch_pricing_for_tenant(db, tenant.id)

    assert pricing.active_branches == 2
    assert pricing.monthly_total == Decimal("0.00")


async def test_archived_branches_are_not_billable(api: ApiContext) -> None:
    """Only ACTIVE branches count toward the monthly total."""
    async with api.database.session_factory() as db:
        tenant = (
            await db.execute(select(Tenant).where(Tenant.slug == "dixora-lab"))
        ).scalar_one()
        # Put this business on the paid plan so real pricing applies.
        standard = (
            await db.execute(
                select(SubscriptionPlan).where(SubscriptionPlan.code == "STANDARD")
            )
        ).scalar_one()
        subscription = (
            await db.execute(
                select(Subscription).where(Subscription.tenant_id == tenant.id)
            )
        ).scalar_one()
        subscription.plan_id = standard.id
        for index, active in ((1, True), (2, True), (3, False)):
            db.add(
                Branch(
                    tenant_id=tenant.id,
                    name=f"Şube {index}",
                    slug=f"sube-{index}",
                    timezone="Europe/Istanbul",
                    is_active=active,
                )
            )
        await db.commit()

        pricing = await branch_pricing_for_tenant(db, tenant.id)

    # One seeded branch + two new active ones = 3 billable; the archived one is ignored.
    assert pricing.active_branches == 3
    assert pricing.billable_extra_branches == 2
    assert pricing.monthly_total == Decimal("2900.00")
    assert pricing.next_branch_monthly_total == Decimal("3750.00")
