from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Branch, Subscription, SubscriptionPlan

CENT = Decimal("0.01")


def money(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)

# Defaults for the standard Dixora plan. These live here, in one place, so the
# price is never duplicated across the API, the seed and the frontend.
DEFAULT_BASE_MONTHLY_PRICE = Decimal("1200.00")
DEFAULT_INCLUDED_BRANCHES = 1
DEFAULT_ADDITIONAL_BRANCH_PRICE = Decimal("850.00")
DEFAULT_CURRENCY = "TRY"


@dataclass(frozen=True, slots=True)
class BranchPricing:
    currency: str
    base_monthly_price: Decimal
    included_branches: int
    additional_branch_price: Decimal
    active_branches: int
    billable_extra_branches: int
    monthly_total: Decimal

    @property
    def next_branch_monthly_total(self) -> Decimal:
        """What the bill becomes if one more branch is opened right now."""
        return quote_monthly_total(
            base_monthly_price=self.base_monthly_price,
            included_branches=self.included_branches,
            additional_branch_price=self.additional_branch_price,
            active_branches=self.active_branches + 1,
        )


def quote_monthly_total(
    *,
    base_monthly_price: Decimal,
    included_branches: int,
    additional_branch_price: Decimal,
    active_branches: int,
) -> Decimal:
    """base + max(active - included, 0) x additional.

    Pure function so the arithmetic can be tested without touching a database.
    """
    extra = max(active_branches - included_branches, 0)
    return money(base_monthly_price + (additional_branch_price * extra))


async def count_active_branches(db: AsyncSession, tenant_id: UUID) -> int:
    """Archived/disabled branches are not billable."""
    return int(
        (
            await db.execute(
                select(func.count(Branch.id)).where(
                    Branch.tenant_id == tenant_id,
                    Branch.is_active.is_(True),
                )
            )
        ).scalar_one()
    )


async def branch_pricing_for_tenant(db: AsyncSession, tenant_id: UUID) -> BranchPricing:
    plan = (
        await db.execute(
            select(SubscriptionPlan)
            .join(Subscription, Subscription.plan_id == SubscriptionPlan.id)
            .where(Subscription.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()

    base = plan.monthly_price if plan else DEFAULT_BASE_MONTHLY_PRICE
    included = plan.included_branches if plan else DEFAULT_INCLUDED_BRANCHES
    additional = plan.additional_branch_price if plan else DEFAULT_ADDITIONAL_BRANCH_PRICE
    currency = plan.currency if plan else DEFAULT_CURRENCY

    active = await count_active_branches(db, tenant_id)
    return BranchPricing(
        currency=currency,
        base_monthly_price=money(base),
        included_branches=included,
        additional_branch_price=money(additional),
        active_branches=active,
        billable_extra_branches=max(active - included, 0),
        monthly_total=quote_monthly_total(
            base_monthly_price=base,
            included_branches=included,
            additional_branch_price=additional,
            active_branches=active,
        ),
    )
