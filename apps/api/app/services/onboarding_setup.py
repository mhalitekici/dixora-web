from __future__ import annotations

import logging
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Area, DiningTable, TenantOnboarding

logger = logging.getLogger(__name__)

DEFAULT_AREA_NAME = "Salon"
# A questionnaire answer should never be able to spawn an unbounded number of
# rows; anything larger is a typo or an attack, not a restaurant.
MAX_AUTO_TABLES = 200


class OnboardingOutcome:
    """What actually changed as a result of the answers.

    Returned so the wizard can tell the owner what was set up rather than
    silently doing work behind their back.
    """

    def __init__(self) -> None:
        self.tables_created = 0
        self.area_created = False
        self.delivery_enabled = False
        self.payment_methods: list[str] = []

    def as_dict(self) -> dict[str, object]:
        return {
            "tables_created": self.tables_created,
            "area_created": self.area_created,
            "delivery_enabled": self.delivery_enabled,
            "payment_methods": self.payment_methods,
        }


async def apply_onboarding(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    branch_id: UUID,
    record: TenantOnboarding,
) -> OnboardingOutcome:
    """Turn questionnaire answers into real configuration.

    Without this the questions are a survey. The valuable one is table count:
    a new venue otherwise has to create 24 tables by hand before it can take a
    single order.
    """
    outcome = OnboardingOutcome()
    outcome.delivery_enabled = bool(record.offers_delivery)
    outcome.payment_methods = list(record.payment_methods)

    desired = record.table_count or 0
    if desired <= 0:
        return outcome

    existing = int(
        (
            await db.execute(
                select(func.count(DiningTable.id)).where(
                    DiningTable.tenant_id == tenant_id,
                    DiningTable.branch_id == branch_id,
                )
            )
        ).scalar_one()
    )
    # Only ever fills the gap: re-running the wizard must not duplicate a floor
    # plan the owner has since edited by hand.
    missing = min(desired, MAX_AUTO_TABLES) - existing
    if missing <= 0:
        return outcome

    area = (
        await db.execute(
            select(Area).where(
                Area.tenant_id == tenant_id,
                Area.branch_id == branch_id,
                Area.is_active.is_(True),
            )
            .order_by(Area.sort_order)
            .limit(1)
        )
    ).scalar_one_or_none()
    if area is None:
        area = Area(
            tenant_id=tenant_id,
            branch_id=branch_id,
            name=DEFAULT_AREA_NAME,
            sort_order=0,
            is_active=True,
        )
        db.add(area)
        await db.flush()
        outcome.area_created = True

    for index in range(existing + 1, existing + missing + 1):
        db.add(
            DiningTable(
                tenant_id=tenant_id,
                branch_id=branch_id,
                area_id=area.id,
                name=str(index),
                capacity=4,
                sort_order=index,
                is_active=True,
            )
        )
    await db.flush()
    outcome.tables_created = missing
    return outcome
