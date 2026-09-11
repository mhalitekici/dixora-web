from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError

from app.config import Settings
from app.dependencies import (
    DbSession,
    Identity,
    get_app_settings,
    require_branch,
    require_permissions,
    require_tenant,
)
from app.errors import DomainError
from app.models import Branch, BusinessDayClose, CashierShift, User
from app.schemas import (
    BusinessDayCloseCreate,
    BusinessDayCloseOut,
    BusinessDayPreviewOut,
    ShiftClose,
    ShiftHandoff,
    ShiftHandoffOut,
    ShiftOpen,
    ShiftOut,
    StaffPinVerification,
    StaffPinVerificationOut,
)
from app.services.audit import add_audit_log
from app.services.cashier_reconciliation import business_window, day_totals, money, shift_totals
from app.services.staff_pin import verify_staff_pin

router = APIRouter(prefix="/shifts", tags=["cashier-shifts"])
ShiftOperator = Annotated[Identity, Depends(require_permissions("cashier.shift.manage"))]
DayCloser = Annotated[Identity, Depends(require_permissions("cashier.day.close"))]
ReportReader = Annotated[Identity, Depends(require_permissions("reports.read"))]


async def _branch(db: DbSession, identity: Identity, requested: UUID | None = None) -> Branch:
    branch_id = require_branch(identity, requested)
    branch = await db.get(Branch, branch_id)
    if branch is None or branch.tenant_id != require_tenant(identity):
        raise DomainError("branch_not_found", "Branch not found", status_code=404)
    return branch


async def _names(db: DbSession, tenant_id: UUID, ids: set[UUID]) -> dict[UUID, str]:
    if not ids:
        return {}
    rows = (
        await db.execute(
            select(User.id, User.display_name).where(User.tenant_id == tenant_id, User.id.in_(ids))
        )
    ).all()
    return {row.id: row.display_name for row in rows}


def _out(shift: CashierShift, names: dict[UUID, str] | None = None) -> ShiftOut:
    names = names or {}
    return ShiftOut.model_validate(shift).model_copy(
        update={
            "user_display_name": names.get(shift.user_id) or shift.cashier_name,
            "closed_by_display_name": names.get(shift.closed_by_user_id)
            if shift.closed_by_user_id
            else None,
        }
    )


async def current_operator_shift(
    db: DbSession, identity: Identity, *, lock: bool = False
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


async def _verify(
    db: DbSession,
    settings: Settings,
    request: Request,
    identity: Identity,
    payload: StaffPinVerification,
    permission: str = "cashier.shift.manage",
    *,
    explicit_branch_assignment: bool | None = None,
) -> User:
    return await verify_staff_pin(
        db,
        settings=settings,
        request=request,
        tenant_id=require_tenant(identity),
        branch_id=require_branch(identity),
        username=payload.username,
        pin=payload.pin,
        permission=permission,
        explicit_branch_assignment=(
            permission == "cashier.shift.manage"
            if explicit_branch_assignment is None
            else explicit_branch_assignment
        ),
    )


@router.post("/verify", response_model=StaffPinVerificationOut)
async def verify_employee(
    payload: StaffPinVerification,
    request: Request,
    identity: ShiftOperator,
    db: DbSession,
    settings: Settings = Depends(get_app_settings),
) -> StaffPinVerificationOut:
    user = await _verify(db, settings, request, identity, payload)
    return StaffPinVerificationOut(
        user_id=user.id, username=user.username, display_name=user.display_name
    )


@router.get("/current", response_model=ShiftOut | None)
async def current_shift(identity: ShiftOperator, db: DbSession) -> ShiftOut | None:
    shift = await current_operator_shift(db, identity)
    if shift is None:
        return None
    totals = await shift_totals(db, shift)
    return _out(shift).model_copy(
        update={
            "cash_sales": totals.cash_sales,
            "card_sales": totals.card_sales,
            "cash_refunds": totals.cash_refunds,
            "card_refunds": totals.card_refunds,
            "total_sales": totals.sales_total,
            "expected_cash": totals.expected_cash,
        }
    )


@router.get("/history", response_model=list[ShiftOut])
async def shift_history(
    identity: ShiftOperator,
    db: DbSession,
    user_id: UUID | None = None,
    branch_id: UUID | None = None,
    status_filter: str | None = Query(default=None, alias="status"),
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = Query(default=50, ge=1, le=200),
) -> list[ShiftOut]:
    predicates = [
        CashierShift.tenant_id == require_tenant(identity),
        CashierShift.branch_id == require_branch(identity, branch_id),
    ]
    if identity.role == "CASHIER":
        predicates.append(CashierShift.user_id == identity.user_id)
    elif user_id:
        predicates.append(CashierShift.user_id == user_id)
    if status_filter:
        predicates.append(CashierShift.status == status_filter.upper())
    if date_from:
        predicates.append(CashierShift.business_date >= date_from)
    if date_to:
        predicates.append(CashierShift.business_date <= date_to)
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
    ids = {row.user_id for row in rows} | {
        row.closed_by_user_id for row in rows if row.closed_by_user_id
    }
    names = await _names(db, require_tenant(identity), ids)
    return [_out(row, names) for row in rows]


@router.post("/open", response_model=ShiftOut, status_code=status.HTTP_201_CREATED)
async def open_shift(
    payload: ShiftOpen,
    request: Request,
    identity: ShiftOperator,
    db: DbSession,
    settings: Settings = Depends(get_app_settings),
) -> ShiftOut:
    employee = await _verify(db, settings, request, identity, payload)
    branch = await _branch(db, identity)
    if await current_operator_shift(db, identity):
        raise DomainError(
            "shift_already_open",
            "Bu kullanıcı için açık bir vardiya var. Mevcut vardiyadan devam edin.",
            status_code=409,
        )
    other = (
        await db.execute(
            select(CashierShift.id).where(
                CashierShift.tenant_id == branch.tenant_id,
                CashierShift.branch_id == branch.id,
                CashierShift.user_id == employee.id,
                CashierShift.status == "OPEN",
            )
        )
    ).scalar_one_or_none()
    if other:
        raise DomainError(
            "cashier_shift_already_open",
            "Bu çalışanın zaten açık bir vardiyası var. Önce mevcut vardiyayı kapatın.",
            status_code=409,
            details={"shift_id": str(other)},
        )
    business_date, _, _ = business_window(branch.timezone)
    shift = CashierShift(
        tenant_id=branch.tenant_id,
        branch_id=branch.id,
        user_id=employee.id,
        opened_by_user_id=identity.user_id,
        business_date=business_date,
        cashier_name=employee.display_name,
        opening_cash=money(payload.opening_cash),
        expected_cash=money(payload.opening_cash),
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
        new_value={
            "cashier_user_id": str(employee.id),
            "opening_cash": str(shift.opening_cash),
            "business_date": str(business_date),
        },
    )
    await db.commit()
    return _out(shift, {employee.id: employee.display_name})


async def _close(
    db: DbSession,
    *,
    shift: CashierShift,
    closing_cash: Decimal,
    reported_card_total: Decimal | None,
    note: str | None,
    identity: Identity,
    closer: User,
    action: str = "shift.closed",
) -> None:
    totals = await shift_totals(db, shift)
    shift.status = "CLOSED"
    shift.cash_sales, shift.card_sales = totals.cash_sales, totals.card_sales
    shift.cash_refunds, shift.card_refunds = totals.cash_refunds, totals.card_refunds
    shift.total_sales, shift.expected_cash = totals.sales_total, totals.expected_cash
    shift.closing_cash = money(closing_cash)
    shift.cash_variance = money(shift.closing_cash - shift.expected_cash)
    shift.reported_card_total = (
        money(reported_card_total) if reported_card_total is not None else None
    )
    shift.card_variance = (
        money(shift.reported_card_total - shift.card_sales)
        if shift.reported_card_total is not None
        else None
    )
    shift.closed_at, shift.closed_by_user_id, shift.closing_note = (
        datetime.now(UTC),
        closer.id,
        note,
    )
    snapshot = {
        "closed_by_user_id": str(closer.id),
        "expected_cash": str(shift.expected_cash),
        "closing_cash": str(shift.closing_cash),
        "cash_variance": str(shift.cash_variance),
        "cash_refunds": str(shift.cash_refunds),
        "reported_card_total": (
            str(shift.reported_card_total) if shift.reported_card_total is not None else None
        ),
        "card_variance": str(shift.card_variance) if shift.card_variance is not None else None,
    }
    add_audit_log(
        db,
        identity=identity,
        action=action,
        resource_type="cashier_shift",
        resource_id=shift.id,
        new_value=snapshot,
    )
    if shift.cash_variance:
        add_audit_log(
            db,
            identity=identity,
            action="shift.cash_difference",
            resource_type="cashier_shift",
            resource_id=shift.id,
            new_value={"difference": str(shift.cash_variance)},
        )


@router.post("/{shift_id}/close", response_model=ShiftOut)
async def close_shift(
    shift_id: UUID,
    payload: ShiftClose,
    request: Request,
    identity: ShiftOperator,
    db: DbSession,
    settings: Settings = Depends(get_app_settings),
) -> ShiftOut:
    shift = (
        await db.execute(
            select(CashierShift)
            .where(
                CashierShift.id == shift_id,
                CashierShift.tenant_id == require_tenant(identity),
                CashierShift.branch_id == require_branch(identity),
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if shift is None:
        raise DomainError("shift_not_found", "Shift not found", status_code=404)
    if shift.status != "OPEN":
        raise DomainError("shift_already_closed", "This shift is already closed", status_code=409)
    closer = await _verify(
        db,
        settings,
        request,
        identity,
        payload,
        explicit_branch_assignment=False,
    )
    permissions = {item.code for item in closer.role.permissions}
    if (
        closer.id != shift.user_id
        and "cashier.day.close" not in permissions
        and "*" not in permissions
    ):
        raise DomainError(
            "shift_close_forbidden",
            "Only this cashier or a manager may close the shift",
            status_code=403,
        )
    await _close(
        db,
        shift=shift,
        closing_cash=payload.closing_cash,
        reported_card_total=payload.reported_card_total,
        note=payload.note,
        identity=identity,
        closer=closer,
    )
    await db.commit()
    return _out(shift, {shift.user_id: shift.cashier_name or "", closer.id: closer.display_name})


@router.post("/{shift_id}/handoff", response_model=ShiftHandoffOut)
async def handoff_shift(
    shift_id: UUID,
    payload: ShiftHandoff,
    request: Request,
    identity: ShiftOperator,
    db: DbSession,
    settings: Settings = Depends(get_app_settings),
) -> ShiftHandoffOut:
    shift = (
        await db.execute(
            select(CashierShift)
            .where(
                CashierShift.id == shift_id,
                CashierShift.tenant_id == require_tenant(identity),
                CashierShift.branch_id == require_branch(identity),
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if shift is None:
        raise DomainError("shift_not_found", "Shift not found", status_code=404)
    if shift.status != "OPEN":
        raise DomainError("shift_already_closed", "This shift is already closed", status_code=409)
    closer = await _verify(
        db,
        settings,
        request,
        identity,
        payload,
        explicit_branch_assignment=False,
    )
    if closer.id != shift.user_id:
        raise DomainError(
            "shift_close_forbidden", "The active cashier must authorize handoff", status_code=403
        )
    next_employee = await _verify(
        db,
        settings,
        request,
        identity,
        StaffPinVerification(username=payload.next_username, pin=payload.next_pin),
    )
    if next_employee.id == shift.user_id:
        raise DomainError(
            "handoff_same_cashier", "Choose a different employee for handoff", status_code=409
        )
    next_open_shift = (
        await db.execute(
            select(CashierShift.id).where(
                CashierShift.tenant_id == shift.tenant_id,
                CashierShift.branch_id == shift.branch_id,
                CashierShift.user_id == next_employee.id,
                CashierShift.status == "OPEN",
                CashierShift.id != shift.id,
            )
        )
    ).scalar_one_or_none()
    if next_open_shift is not None:
        raise DomainError(
            "next_cashier_shift_already_open",
            "Devralan çalışanın açık vardiyası var. Devirden önce bu vardiyayı kapatın.",
            status_code=409,
            details={"shift_id": str(next_open_shift)},
        )
    await _close(
        db,
        shift=shift,
        closing_cash=payload.closing_cash,
        reported_card_total=payload.reported_card_total,
        note=payload.note,
        identity=identity,
        closer=closer,
        action="shift.handoff",
    )
    successor = CashierShift(
        tenant_id=shift.tenant_id,
        branch_id=shift.branch_id,
        user_id=next_employee.id,
        opened_by_user_id=identity.user_id,
        predecessor_shift_id=shift.id,
        business_date=shift.business_date,
        cashier_name=next_employee.display_name,
        opening_cash=money(payload.next_opening_cash),
        expected_cash=money(payload.next_opening_cash),
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
            "cashier_user_id": str(next_employee.id),
            "opening_cash": str(successor.opening_cash),
            "predecessor_shift_id": str(shift.id),
        },
    )
    await db.commit()
    names = {
        shift.user_id: shift.cashier_name or "",
        closer.id: closer.display_name,
        next_employee.id: next_employee.display_name,
    }
    return ShiftHandoffOut(closed=_out(shift, names), opened=_out(successor, names))


async def _preview(db: DbSession, identity: Identity, branch: Branch) -> BusinessDayPreviewOut:
    business_date, start, end = business_window(branch.timezone)
    totals = await day_totals(
        db,
        tenant_id=require_tenant(identity),
        branch_id=branch.id,
        business_date=business_date,
        start=start,
        end=end,
    )
    open_count = len(
        (
            await db.execute(
                select(CashierShift.id).where(
                    CashierShift.tenant_id == branch.tenant_id,
                    CashierShift.branch_id == branch.id,
                    CashierShift.status == "OPEN",
                )
            )
        )
        .scalars()
        .all()
    )
    return BusinessDayPreviewOut(
        branch_id=branch.id,
        business_date=business_date,
        opening_cash=totals.opening_cash,
        system_cash_total=totals.net_cash,
        system_card_total=totals.net_card,
        cash_refunds=totals.cash_refunds,
        card_refunds=totals.card_refunds,
        expected_cash=totals.expected_cash,
        sales_total=totals.sales_total,
        discounts_total=totals.discounts_total,
        complimentary_total=totals.complimentary_total,
        service_charge_total=totals.service_charge_total,
        receipt_count=totals.receipt_count,
        open_shift_count=open_count,
    )


@router.get("/day/preview", response_model=BusinessDayPreviewOut)
async def day_preview(identity: DayCloser, db: DbSession) -> BusinessDayPreviewOut:
    return await _preview(db, identity, await _branch(db, identity))


@router.post(
    "/business-day-close",
    response_model=BusinessDayCloseOut,
    status_code=status.HTTP_201_CREATED,
)
async def close_business_day(
    payload: BusinessDayCloseCreate,
    request: Request,
    identity: DayCloser,
    db: DbSession,
    settings: Settings = Depends(get_app_settings),
) -> BusinessDayCloseOut:
    branch = await _branch(db, identity)
    manager = await _verify(
        db, settings, request, identity, payload, permission="cashier.day.close"
    )
    preview = await _preview(db, identity, branch)
    if preview.open_shift_count:
        raise DomainError(
            "open_shifts_exist",
            "Close all open shifts before closing the business day",
            status_code=409,
        )
    existing = (
        await db.execute(
            select(BusinessDayClose.id).where(
                BusinessDayClose.tenant_id == branch.tenant_id,
                BusinessDayClose.branch_id == branch.id,
                BusinessDayClose.business_date == preview.business_date,
            )
        )
    ).scalar_one_or_none()
    if existing:
        raise DomainError("already_closed", "This business day is already closed", status_code=409)
    record = BusinessDayClose(
        tenant_id=branch.tenant_id,
        branch_id=branch.id,
        business_date=preview.business_date,
        closed_by_user_id=manager.id,
        closed_at=datetime.now(UTC),
        opening_cash=preview.opening_cash,
        system_cash_total=preview.system_cash_total,
        system_card_total=preview.system_card_total,
        cash_refunds=preview.cash_refunds,
        card_refunds=preview.card_refunds,
        expected_cash=preview.expected_cash,
        counted_cash=money(payload.counted_cash),
        reported_card_total=money(payload.reported_card_total),
        cash_difference=money(payload.counted_cash - preview.expected_cash),
        card_difference=money(payload.reported_card_total - preview.system_card_total),
        sales_total=preview.sales_total,
        discounts_total=preview.discounts_total,
        complimentary_total=preview.complimentary_total,
        service_charge_total=preview.service_charge_total,
        receipt_count=preview.receipt_count,
        note=payload.note,
    )
    db.add(record)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise DomainError(
            "already_closed", "This business day is already closed", status_code=409
        ) from exc
    add_audit_log(
        db,
        identity=identity,
        action="business_day.closed",
        resource_type="business_day_close",
        resource_id=record.id,
        new_value={
            "business_date": str(record.business_date),
            "closed_by_user_id": str(manager.id),
            "cash_difference": str(record.cash_difference),
            "card_difference": str(record.card_difference),
        },
    )
    await db.commit()
    return BusinessDayCloseOut.model_validate(record).model_copy(
        update={"closed_by_display_name": manager.display_name, "open_shift_count": 0}
    )


@router.get("/day/history", response_model=list[BusinessDayCloseOut])
async def day_history(
    identity: ReportReader,
    db: DbSession,
    branch_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = Query(default=50, ge=1, le=200),
) -> list[BusinessDayCloseOut]:
    predicates = [
        BusinessDayClose.tenant_id == require_tenant(identity),
        BusinessDayClose.branch_id == require_branch(identity, branch_id),
    ]
    if date_from:
        predicates.append(BusinessDayClose.business_date >= date_from)
    if date_to:
        predicates.append(BusinessDayClose.business_date <= date_to)
    rows = (
        (
            await db.execute(
                select(BusinessDayClose)
                .where(*predicates)
                .order_by(BusinessDayClose.business_date.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    names = await _names(db, require_tenant(identity), {row.closed_by_user_id for row in rows})
    return [
        BusinessDayCloseOut.model_validate(row).model_copy(
            update={
                "closed_by_display_name": names.get(row.closed_by_user_id),
                "open_shift_count": 0,
            }
        )
        for row in rows
    ]


@router.get("/day/{close_id}", response_model=BusinessDayCloseOut)
async def day_detail(close_id: UUID, identity: ReportReader, db: DbSession) -> BusinessDayCloseOut:
    row = (
        await db.execute(
            select(BusinessDayClose).where(
                BusinessDayClose.id == close_id,
                BusinessDayClose.tenant_id == require_tenant(identity),
                BusinessDayClose.branch_id == require_branch(identity),
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise DomainError("day_close_not_found", "Business day close not found", status_code=404)
    names = await _names(db, require_tenant(identity), {row.closed_by_user_id})
    return BusinessDayCloseOut.model_validate(row).model_copy(
        update={"closed_by_display_name": names.get(row.closed_by_user_id), "open_shift_count": 0}
    )


@router.get("/{shift_id}", response_model=ShiftOut)
async def shift_detail(shift_id: UUID, identity: ShiftOperator, db: DbSession) -> ShiftOut:
    shift = (
        await db.execute(
            select(CashierShift).where(
                CashierShift.id == shift_id,
                CashierShift.tenant_id == require_tenant(identity),
                CashierShift.branch_id == require_branch(identity),
            )
        )
    ).scalar_one_or_none()
    if shift is None or (identity.role == "CASHIER" and shift.user_id != identity.user_id):
        raise DomainError("shift_not_found", "Shift not found", status_code=404)
    ids = {shift.user_id} | ({shift.closed_by_user_id} if shift.closed_by_user_id else set())
    return _out(shift, await _names(db, require_tenant(identity), ids))
