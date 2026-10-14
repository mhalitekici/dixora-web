from __future__ import annotations

from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import Identity, require_branch, require_tenant
from app.models import CashierShift, Receipt, User


async def current_operator_shift(
    db: AsyncSession, identity: Identity, *, lock: bool = False
) -> CashierShift | None:
    query = (
        select(CashierShift)
        .where(
            CashierShift.tenant_id == require_tenant(identity),
            CashierShift.branch_id == require_branch(identity),
            or_(
                CashierShift.opened_by_user_id == identity.user_id,
                CashierShift.user_id == identity.user_id,
            ),
            CashierShift.status == "OPEN",
        )
        .order_by(
            (CashierShift.user_id == identity.user_id).desc(),
            CashierShift.opened_at.desc(),
        )
        .limit(1)
    )
    return (await db.execute(query.with_for_update() if lock else query)).scalar_one_or_none()


async def operator_cashier_name(
    db: AsyncSession, *, tenant_id: UUID, branch_id: UUID, actor_user_id: UUID
) -> str | None:
    shift = (
        await db.execute(
            select(CashierShift)
            .where(
                CashierShift.tenant_id == tenant_id,
                CashierShift.branch_id == branch_id,
                or_(
                    CashierShift.opened_by_user_id == actor_user_id,
                    CashierShift.user_id == actor_user_id,
                ),
                CashierShift.status == "OPEN",
            )
            .order_by(
                (CashierShift.user_id == actor_user_id).desc(),
                CashierShift.opened_at.desc(),
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    user_id = shift.user_id if shift else actor_user_id
    if shift and shift.cashier_name:
        return shift.cashier_name
    return (
        await db.execute(
            select(User.display_name).where(User.id == user_id, User.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()


async def receipt_cashier_names(db: AsyncSession, receipts: list[Receipt]) -> dict[UUID, str]:
    """Use the issuing shift's name, including after handoff and on reprints."""
    if not receipts:
        return {}
    user_ids = {receipt.issued_by_user_id for receipt in receipts if receipt.issued_by_user_id}
    tenant_ids = {receipt.tenant_id for receipt in receipts}
    users = (
        await db.execute(
            select(User.id, User.display_name).where(
                User.id.in_(user_ids), User.tenant_id.in_(tenant_ids)
            )
        )
    ).all()
    names = {user_id: display_name for user_id, display_name in users}
    shifts = (
        (
            await db.execute(
                select(CashierShift)
                .where(
                    CashierShift.tenant_id.in_(tenant_ids),
                    CashierShift.user_id.in_(user_ids),
                    CashierShift.opened_at <= max(receipt.issued_at for receipt in receipts),
                    or_(
                        CashierShift.closed_at.is_(None),
                        CashierShift.closed_at >= min(receipt.issued_at for receipt in receipts),
                    ),
                )
                .order_by(CashierShift.opened_at.desc())
            )
        )
        .scalars()
        .all()
    )
    result: dict[UUID, str] = {}
    for receipt in receipts:
        for shift in shifts:
            if (
                shift.tenant_id == receipt.tenant_id
                and shift.branch_id == receipt.branch_id
                and shift.user_id == receipt.issued_by_user_id
                and shift.opened_at <= receipt.issued_at
                and (shift.closed_at is None or shift.closed_at >= receipt.issued_at)
                and shift.cashier_name
            ):
                result[receipt.id] = shift.cashier_name
                break
        else:
            if receipt.issued_by_user_id is not None and receipt.issued_by_user_id in names:
                result[receipt.id] = names[receipt.issued_by_user_id]
    return result
