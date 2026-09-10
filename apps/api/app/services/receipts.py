from __future__ import annotations

from datetime import UTC, date, datetime
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import DomainError
from app.models import Branch, DailyReceiptCounter, Receipt


def branch_business_date(at: datetime, timezone_name: str) -> date:
    try:
        timezone = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError as exc:
        raise DomainError(
            "invalid_branch_timezone",
            "The branch timezone is not valid",
            status_code=409,
        ) from exc
    normalized = at.replace(tzinfo=UTC) if at.tzinfo is None else at.astimezone(UTC)
    return normalized.astimezone(timezone).date()


async def allocate_order_receipt(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    branch: Branch,
    order_id: UUID,
    actor_user_id: UUID | None,
    issued_at: datetime | None = None,
) -> tuple[Receipt, bool]:
    """Allocate exactly one branch-local daily number for an order.

    The counter row is created with an atomic upsert, then locked before both
    the order receipt check and increment. Different branches/days never block
    each other, while concurrent tills for the same branch/day serialize.
    """

    now = issued_at or datetime.now(UTC)
    business_date = branch_business_date(now, branch.timezone)
    dialect = db.bind.dialect.name if db.bind is not None else ""
    values = {
        "id": uuid4(),
        "tenant_id": tenant_id,
        "branch_id": branch.id,
        "business_date": business_date,
        "last_number": 0,
        "created_at": now,
        "updated_at": now,
    }
    if dialect == "postgresql":
        statement = postgresql_insert(DailyReceiptCounter).values(**values)
        statement = statement.on_conflict_do_nothing(
            index_elements=["tenant_id", "branch_id", "business_date"]
        )
        await db.execute(statement)
    elif dialect == "sqlite":
        sqlite_statement = sqlite_insert(DailyReceiptCounter).values(**values)
        sqlite_statement = sqlite_statement.on_conflict_do_nothing(
            index_elements=["tenant_id", "branch_id", "business_date"]
        )
        await db.execute(sqlite_statement)

    counter = (
        await db.execute(
            select(DailyReceiptCounter)
            .where(
                DailyReceiptCounter.tenant_id == tenant_id,
                DailyReceiptCounter.branch_id == branch.id,
                DailyReceiptCounter.business_date == business_date,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if counter is None:
        counter = DailyReceiptCounter(**values)
        db.add(counter)
        await db.flush()

    existing = (
        await db.execute(
            select(Receipt).where(
                Receipt.tenant_id == tenant_id,
                Receipt.order_id == order_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing, False

    counter.last_number += 1
    counter.updated_at = now
    receipt = Receipt(
        tenant_id=tenant_id,
        branch_id=branch.id,
        order_id=order_id,
        issued_by_user_id=actor_user_id,
        business_date=business_date,
        daily_number=counter.last_number,
        issued_at=now,
    )
    db.add(receipt)
    await db.flush()
    return receipt, True
