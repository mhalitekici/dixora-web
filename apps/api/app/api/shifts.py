from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select

from app.dependencies import (
    DbSession,
    Identity,
    require_branch,
    require_permissions,
    require_tenant,
)
from app.errors import DomainError
from app.models import CashierShift, Payment, User
from app.models.enums import PaymentStatus
from app.schemas import ShiftClose, ShiftHandoff, ShiftHandoffOut, ShiftOpen, ShiftOut
from app.services.audit import add_audit_log

router = APIRouter(prefix="/shifts", tags=["cashier-shifts"])
ShiftOperator = Annotated[Identity, Depends(require_permissions("payments.manage"))]


def _shift_out(shift: CashierShift, display_name: str | None) -> ShiftOut:
    return ShiftOut.model_validate(shift).model_copy(update={"user_display_name": display_name})


@router.get("/current", response_model=ShiftOut | None)
async def current_shift(identity: ShiftOperator, db: DbSession) -> ShiftOut | None:
    shift = (
        await db.execute(
            select(CashierShift).where(
                CashierShift.tenant_id == require_tenant(identity),
                CashierShift.branch_id == require_branch(identity),
                CashierShift.user_id == identity.user_id,
                CashierShift.status == "OPEN",
            )
        )
    ).scalar_one_or_none()
    return _shift_out(shift, identity.display_name) if shift else None


@router.get("/history", response_model=list[ShiftOut])
async def shift_history(
    identity: ShiftOperator,
    db: DbSession,
    user_id: UUID | None = None,
    limit: int = Query(default=50, ge=1, le=200),
) -> list[ShiftOut]:
    predicates = [
        CashierShift.tenant_id == require_tenant(identity),
        CashierShift.branch_id == require_branch(identity),
    ]
    if identity.role == "CASHIER":
        predicates.append(CashierShift.user_id == identity.user_id)
    elif user_id:
        predicates.append(CashierShift.user_id == user_id)
    rows = (
        (
            await db.execute(
                select(CashierShift)
                .where(*predicates)
                .order_by(CashierShift.opened_at.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    user_ids = {shift.user_id for shift in rows}
    names_by_id: dict[UUID, str] = {}
    if user_ids:
        name_rows = (
            await db.execute(
                select(User.id, User.display_name).where(
                    User.tenant_id == require_tenant(identity),
                    User.id.in_(user_ids),
                )
            )
        ).all()
        names_by_id = {row.id: row.display_name for row in name_rows}
    return [_shift_out(shift, names_by_id.get(shift.user_id)) for shift in rows]


@router.post("/open", response_model=ShiftOut, status_code=status.HTTP_201_CREATED)
async def open_shift(
    payload: ShiftOpen,
    identity: ShiftOperator,
    db: DbSession,
) -> ShiftOut:
    tenant_id = require_tenant(identity)
    branch_id = require_branch(identity)
    existing = (
        await db.execute(
            select(CashierShift.id).where(
                CashierShift.tenant_id == tenant_id,
                CashierShift.branch_id == branch_id,
                CashierShift.user_id == identity.user_id,
                CashierShift.status == "OPEN",
            )
        )
    ).scalar_one_or_none()
    if existing:
        raise DomainError("shift_already_open", "A shift is already open", status_code=409)
    shift = CashierShift(
        tenant_id=tenant_id,
        branch_id=branch_id,
        user_id=identity.user_id,
        cashier_name=payload.cashier_name.strip(),
        opening_cash=payload.opening_cash,
        opening_note=payload.note,
        opened_at=datetime.now(UTC),
    )
    db.add(shift)
    await db.flush()
    add_audit_log(
        db,
        identity=identity,
        action="shift.opened",
        resource_type="cashier_shift",
        resource_id=shift.id,
        new_value={"opening_cash": str(shift.opening_cash), "cashier_name": shift.cashier_name},
    )
    await db.commit()
    return _shift_out(shift, identity.display_name)


async def _close_shift(
    db: DbSession,
    *,
    shift: CashierShift,
    closing_cash: Decimal,
    note: str | None,
    identity: Identity,
    action: str = "shift.closed",
) -> None:
    """Compute expected cash from completed payments and close the shift in place.

    Caller is responsible for locking the shift row and committing.
    """
    payments = (
        (
            await db.execute(
                select(Payment).where(
                    Payment.tenant_id == shift.tenant_id,
                    Payment.branch_id == shift.branch_id,
                    Payment.recorded_by_user_id == shift.user_id,
                    Payment.status == PaymentStatus.COMPLETED,
                    Payment.created_at >= shift.opened_at,
                )
            )
        )
        .scalars()
        .all()
    )
    cash_sales = sum(
        (payment.amount for payment in payments if payment.method.upper() == "CASH"),
        Decimal("0"),
    )
    card_sales = sum(
        (payment.amount for payment in payments if payment.method.upper() == "CARD"),
        Decimal("0"),
    )
    total_sales = sum((payment.amount for payment in payments), Decimal("0"))
    shift.status = "CLOSED"
    shift.closing_cash = closing_cash
    shift.cash_sales = cash_sales
    shift.card_sales = card_sales
    shift.total_sales = total_sales
    shift.cash_variance = closing_cash - shift.opening_cash - cash_sales
    shift.closed_at = datetime.now(UTC)
    shift.closing_note = note
    add_audit_log(
        db,
        identity=identity,
        action=action,
        resource_type="cashier_shift",
        resource_id=shift.id,
        new_value={
            "closing_cash": str(shift.closing_cash),
            "total_sales": str(shift.total_sales),
            "cash_variance": str(shift.cash_variance),
        },
    )


@router.post("/{shift_id}/close", response_model=ShiftOut)
async def close_shift(
    shift_id: UUID,
    payload: ShiftClose,
    identity: ShiftOperator,
    db: DbSession,
) -> ShiftOut:
    shift = (
        await db.execute(
            select(CashierShift)
            .where(
                CashierShift.id == shift_id,
                CashierShift.tenant_id == require_tenant(identity),
                CashierShift.branch_id == require_branch(identity),
                CashierShift.user_id == identity.user_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if shift is None:
        raise DomainError("shift_not_found", "Shift not found", status_code=404)
    if shift.status == "CLOSED":
        return _shift_out(shift, identity.display_name)
    await _close_shift(
        db,
        shift=shift,
        closing_cash=payload.closing_cash,
        note=payload.note,
        identity=identity,
    )
    await db.commit()
    return _shift_out(shift, identity.display_name)


@router.post("/{shift_id}/handoff", response_model=ShiftHandoffOut)
async def handoff_shift(
    shift_id: UUID,
    payload: ShiftHandoff,
    identity: ShiftOperator,
    db: DbSession,
) -> ShiftHandoffOut:
    """Close the caller's active shift and immediately open a new one.

    Many cafes share one terminal login across staff, so a handoff does not
    require a separate user account for the next person — it stays on the
    same authenticated login and simply records who is physically holding
    the till now via ``next_cashier_name``. The new shift's opening cash
    defaults to the counted cash handed over, unless an explicit
    ``next_opening_cash`` is provided (e.g. the till is topped up or
    partially withdrawn during the handoff).
    """
    tenant_id = require_tenant(identity)
    branch_id = require_branch(identity)
    shift = (
        await db.execute(
            select(CashierShift)
            .where(
                CashierShift.id == shift_id,
                CashierShift.tenant_id == tenant_id,
                CashierShift.branch_id == branch_id,
                CashierShift.user_id == identity.user_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if shift is None:
        raise DomainError("shift_not_found", "Shift not found", status_code=404)

    if shift.status == "CLOSED":
        successor = (
            await db.execute(
                select(CashierShift).where(
                    CashierShift.tenant_id == tenant_id,
                    CashierShift.branch_id == branch_id,
                    CashierShift.predecessor_shift_id == shift.id,
                )
            )
        ).scalar_one_or_none()
        if successor is not None:
            return ShiftHandoffOut(
                closed=_shift_out(shift, identity.display_name),
                opened=_shift_out(successor, identity.display_name),
            )
        raise DomainError(
            "shift_already_closed",
            "This shift was already closed without a handoff",
            status_code=409,
        )

    await _close_shift(
        db,
        shift=shift,
        closing_cash=payload.counted_cash,
        note=payload.note,
        identity=identity,
        action="shift.handoff",
    )
    successor = CashierShift(
        tenant_id=tenant_id,
        branch_id=branch_id,
        user_id=identity.user_id,
        predecessor_shift_id=shift.id,
        cashier_name=payload.next_cashier_name.strip(),
        opening_cash=(
            payload.next_opening_cash
            if payload.next_opening_cash is not None
            else payload.counted_cash
        ),
        opening_note=payload.note,
        opened_at=datetime.now(UTC),
    )
    db.add(successor)
    await db.flush()
    add_audit_log(
        db,
        identity=identity,
        action="shift.handoff_opened",
        resource_type="cashier_shift",
        resource_id=successor.id,
        new_value={
            "opening_cash": str(successor.opening_cash),
            "predecessor_shift_id": str(shift.id),
            "cashier_name": successor.cashier_name,
        },
    )
    await db.commit()
    return ShiftHandoffOut(
        closed=_shift_out(shift, identity.display_name),
        opened=_shift_out(successor, identity.display_name),
    )
