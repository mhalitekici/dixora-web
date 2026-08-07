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
from app.models import CashierShift, Payment
from app.models.enums import PaymentStatus
from app.schemas import ShiftClose, ShiftOpen, ShiftOut
from app.services.audit import add_audit_log

router = APIRouter(prefix="/shifts", tags=["cashier-shifts"])
ShiftOperator = Annotated[Identity, Depends(require_permissions("payments.manage"))]


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
    return ShiftOut.model_validate(shift) if shift else None


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
    return [ShiftOut.model_validate(shift) for shift in rows]


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
        opening_cash=payload.opening_cash,
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
        new_value={"opening_cash": str(shift.opening_cash)},
    )
    await db.commit()
    return ShiftOut.model_validate(shift)


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
        return ShiftOut.model_validate(shift)
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
    shift.closing_cash = payload.closing_cash
    shift.cash_sales = cash_sales
    shift.card_sales = card_sales
    shift.total_sales = total_sales
    shift.cash_variance = payload.closing_cash - shift.opening_cash - cash_sales
    shift.closed_at = datetime.now(UTC)
    shift.closing_note = payload.note
    add_audit_log(
        db,
        identity=identity,
        action="shift.closed",
        resource_type="cashier_shift",
        resource_id=shift.id,
        new_value={
            "closing_cash": str(shift.closing_cash),
            "total_sales": str(shift.total_sales),
            "cash_variance": str(shift.cash_variance),
        },
    )
    await db.commit()
    return ShiftOut.model_validate(shift)
