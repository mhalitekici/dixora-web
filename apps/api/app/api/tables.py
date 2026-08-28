from __future__ import annotations

from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.dependencies import (
    DbSession,
    Identity,
    require_branch,
    require_permissions,
    require_record_branch,
    require_tenant,
)
from app.errors import DomainError
from app.models import Area, Branch, DiningTable, Order, OrderItem, TableSession
from app.models.base import utcnow
from app.models.enums import OrderStatus, PaymentStatus, TableSessionStatus, TableState
from app.schemas import (
    AreaCreate,
    AreaOut,
    AreaUpdate,
    OrderOut,
    TableCreate,
    TableGuestLabelUpdate,
    TableOut,
    TableSessionCloseOut,
    TableSessionCloseRequest,
    TableUpdate,
)
from app.services.audit import add_audit_log

router = APIRouter(prefix="/tables", tags=["tables"])
TableReader = Annotated[Identity, Depends(require_permissions("tables.read"))]
TableManager = Annotated[Identity, Depends(require_permissions("tables.manage"))]
TableOperator = Annotated[Identity, Depends(require_permissions("tables.operate"))]
TableCloser = Annotated[
    Identity,
    Depends(require_permissions("tables.operate", "payments.manage")),
]


async def _branch_exists(db: DbSession, tenant_id: UUID, branch_id: UUID) -> None:
    exists = (
        await db.execute(
            select(Branch.id).where(Branch.id == branch_id, Branch.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if exists is None:
        raise DomainError("branch_not_found", "Branch not found", status_code=404)


async def _ensure_area_name_available(
    db: DbSession,
    *,
    tenant_id: UUID,
    branch_id: UUID,
    name: str,
    exclude_id: UUID | None = None,
) -> None:
    query = select(Area.id).where(
        Area.tenant_id == tenant_id,
        Area.branch_id == branch_id,
        Area.name == name,
    )
    if exclude_id is not None:
        query = query.where(Area.id != exclude_id)
    if (await db.execute(query.limit(1))).scalar_one_or_none() is not None:
        raise DomainError(
            "area_name_exists",
            "An area with this name already exists in the branch",
            status_code=409,
        )


async def _ensure_table_name_available(
    db: DbSession,
    *,
    tenant_id: UUID,
    branch_id: UUID,
    area_id: UUID,
    name: str,
    exclude_id: UUID | None = None,
) -> None:
    query = select(DiningTable.id).where(
        DiningTable.tenant_id == tenant_id,
        DiningTable.branch_id == branch_id,
        DiningTable.area_id == area_id,
        DiningTable.name == name,
    )
    if exclude_id is not None:
        query = query.where(DiningTable.id != exclude_id)
    if (await db.execute(query.limit(1))).scalar_one_or_none() is not None:
        raise DomainError(
            "table_name_exists",
            "A table with this name already exists in the area",
            status_code=409,
        )


@router.get("/areas", response_model=list[AreaOut])
async def list_areas(
    identity: TableReader,
    db: DbSession,
    branch_id: UUID | None = None,
) -> list[AreaOut]:
    selected_branch = require_branch(identity, branch_id)
    rows = (
        (
            await db.execute(
                select(Area)
                .where(
                    Area.tenant_id == require_tenant(identity),
                    Area.branch_id == selected_branch,
                    Area.is_active.is_(True),
                )
                .order_by(Area.sort_order, Area.name)
            )
        )
        .scalars()
        .all()
    )
    return [AreaOut.model_validate(item) for item in rows]


@router.post("/areas", response_model=AreaOut, status_code=status.HTTP_201_CREATED)
async def create_area(
    payload: AreaCreate,
    identity: TableManager,
    db: DbSession,
) -> AreaOut:
    tenant_id = require_tenant(identity)
    branch_id = require_branch(identity, payload.branch_id)
    await _branch_exists(db, tenant_id, branch_id)
    await _ensure_area_name_available(
        db,
        tenant_id=tenant_id,
        branch_id=branch_id,
        name=payload.name,
    )
    area = Area(
        tenant_id=tenant_id,
        branch_id=branch_id,
        name=payload.name,
        sort_order=payload.sort_order,
    )
    db.add(area)
    await db.flush()
    add_audit_log(
        db,
        identity=identity,
        action="area.created",
        resource_type="area",
        resource_id=area.id,
        new_value={"name": area.name, "sort_order": area.sort_order},
    )
    await db.commit()
    await db.refresh(area)
    return AreaOut.model_validate(area)


@router.patch("/areas/{area_id}", response_model=AreaOut)
async def update_area(
    area_id: UUID,
    payload: AreaUpdate,
    identity: TableManager,
    db: DbSession,
) -> AreaOut:
    tenant_id = require_tenant(identity)
    branch_id = require_branch(identity)
    area = (
        await db.execute(
            select(Area).where(
                Area.id == area_id,
                Area.tenant_id == tenant_id,
                Area.branch_id == branch_id,
            )
        )
    ).scalar_one_or_none()
    if area is None:
        raise DomainError("area_not_found", "Area not found", status_code=404)
    if payload.name is not None:
        await _ensure_area_name_available(
            db,
            tenant_id=tenant_id,
            branch_id=branch_id,
            name=payload.name,
            exclude_id=area.id,
        )
    previous = {
        "name": area.name,
        "sort_order": area.sort_order,
        "is_active": area.is_active,
    }
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(area, key, value)
    add_audit_log(
        db,
        identity=identity,
        action="area.updated",
        resource_type="area",
        resource_id=area.id,
        previous_value=previous,
        new_value={
            "name": area.name,
            "sort_order": area.sort_order,
            "is_active": area.is_active,
        },
    )
    await db.commit()
    return AreaOut.model_validate(area)


@router.delete("/areas/{area_id}", status_code=status.HTTP_204_NO_CONTENT)
async def archive_area(
    area_id: UUID,
    identity: TableManager,
    db: DbSession,
) -> None:
    tenant_id = require_tenant(identity)
    branch_id = require_branch(identity)
    area = (
        await db.execute(
            select(Area).where(
                Area.id == area_id,
                Area.tenant_id == tenant_id,
                Area.branch_id == branch_id,
            )
        )
    ).scalar_one_or_none()
    if area is None:
        raise DomainError("area_not_found", "Area not found", status_code=404)
    active_tables = (
        await db.execute(
            select(DiningTable.id)
            .where(
                DiningTable.tenant_id == tenant_id,
                DiningTable.branch_id == branch_id,
                DiningTable.area_id == area.id,
                DiningTable.is_active.is_(True),
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if active_tables is not None:
        raise DomainError(
            "area_not_empty",
            "Move or archive active tables before archiving the area",
            status_code=409,
        )
    if not area.is_active:
        return
    area.is_active = False
    add_audit_log(
        db,
        identity=identity,
        action="area.archived",
        resource_type="area",
        resource_id=area.id,
        previous_value={"is_active": True},
        new_value={"is_active": False},
    )
    await db.commit()


@router.get("", response_model=list[TableOut])
async def list_tables(
    identity: TableReader,
    db: DbSession,
    branch_id: UUID | None = None,
    area_id: UUID | None = None,
    include_inactive: bool = False,
) -> list[TableOut]:
    predicates = [
        DiningTable.tenant_id == require_tenant(identity),
        DiningTable.branch_id == require_branch(identity, branch_id),
    ]
    if area_id:
        predicates.append(DiningTable.area_id == area_id)
    if not include_inactive:
        predicates.append(DiningTable.is_active.is_(True))
    rows = (
        (
            await db.execute(
                select(DiningTable)
                .where(*predicates)
                .order_by(DiningTable.sort_order, DiningTable.name)
            )
        )
        .scalars()
        .all()
    )
    return [TableOut.model_validate(item) for item in rows]


@router.get("/{table_id}", response_model=TableOut)
async def get_table(
    table_id: UUID,
    identity: TableReader,
    db: DbSession,
) -> TableOut:
    table = (
        await db.execute(
            select(DiningTable).where(
                DiningTable.id == table_id,
                DiningTable.tenant_id == require_tenant(identity),
            )
        )
    ).scalar_one_or_none()
    if table is None:
        raise DomainError("table_not_found", "Table not found", status_code=404)
    require_record_branch(identity, table.branch_id)
    return TableOut.model_validate(table)


@router.get("/{table_id}/active-order", response_model=OrderOut)
async def get_active_table_order(
    table_id: UUID,
    identity: TableReader,
    db: DbSession,
) -> OrderOut:
    tenant_id = require_tenant(identity)
    table = (
        await db.execute(
            select(DiningTable).where(
                DiningTable.id == table_id,
                DiningTable.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if table is None:
        raise DomainError("table_not_found", "Table not found", status_code=404)
    require_record_branch(identity, table.branch_id)
    order = (
        await db.execute(
            select(Order)
            .join(TableSession, TableSession.id == Order.table_session_id)
            .where(
                Order.tenant_id == tenant_id,
                TableSession.tenant_id == tenant_id,
                TableSession.table_id == table_id,
                TableSession.status == TableSessionStatus.OPEN,
                Order.status.notin_([OrderStatus.PAID, OrderStatus.CANCELLED, OrderStatus.VOIDED]),
            )
            .options(
                selectinload(Order.table_session).selectinload(TableSession.table),
                selectinload(Order.items).selectinload(OrderItem.modifiers),
                selectinload(Order.payments),
            )
            .order_by(Order.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if order is None:
        raise DomainError(
            "active_order_not_found", "No active order for this table", status_code=404
        )
    return OrderOut.model_validate(order)


@router.post(
    "/{table_id}/sessions/{session_id}/close",
    response_model=TableSessionCloseOut,
)
async def close_table_session(
    table_id: UUID,
    session_id: UUID,
    payload: TableSessionCloseRequest,
    request: Request,
    identity: TableCloser,
    db: DbSession,
) -> TableSessionCloseOut:
    """Close one exact, fully settled table session.

    The session identifier makes a retry idempotent without risking closure of
    a newer session that may have opened on the same physical table.
    """

    tenant_id = require_tenant(identity)
    branch_id = require_branch(identity)
    table = (
        await db.execute(
            select(DiningTable)
            .where(
                DiningTable.id == table_id,
                DiningTable.tenant_id == tenant_id,
                DiningTable.branch_id == branch_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if table is None:
        raise DomainError("table_not_found", "Table not found", status_code=404)

    table_session = (
        await db.execute(
            select(TableSession)
            .where(
                TableSession.id == session_id,
                TableSession.tenant_id == tenant_id,
                TableSession.branch_id == branch_id,
                TableSession.table_id == table.id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if table_session is None:
        raise DomainError("table_session_not_found", "Table session not found", status_code=404)

    if table_session.status == TableSessionStatus.CLOSED:
        if table.state == TableState.CLEANING:
            # This exact session was already closed (e.g. by a concurrent
            # retry), but nothing ever moved the table itself out of
            # CLEANING - most likely because the check was settled after
            # the session had already closed. Self-heal instead of leaving
            # the table stuck forever, since no newer session has claimed
            # it (that would have moved it past CLEANING already).
            previous_table_state = table.state.value
            previous_version = table.version
            table.state = TableState.AVAILABLE
            table.version += 1
            add_audit_log(
                db,
                identity=identity,
                action="table.cleaning_auto_released",
                resource_type="table_session",
                resource_id=table_session.id,
                previous_value={
                    "table_state": previous_table_state,
                    "table_version": previous_version,
                },
                new_value={"table_state": table.state.value, "table_version": table.version},
            )
            await db.commit()
        return TableSessionCloseOut(
            table=TableOut.model_validate(table),
            session_id=table_session.id,
            already_closed=True,
            closed_at=table_session.closed_at,
        )
    if table_session.status != TableSessionStatus.OPEN:
        raise DomainError(
            "table_session_not_open",
            "Only an open table session can be closed",
            status_code=409,
        )
    if not table.is_active or table.state == TableState.DISABLED:
        raise DomainError("table_disabled", "Disabled tables cannot be closed", status_code=409)
    if table.version != payload.expected_table_version:
        raise DomainError(
            "table_version_conflict",
            "Table data changed; refresh before closing it",
            status_code=409,
            details={"current_version": table.version},
        )

    open_session_ids = (
        (
            await db.execute(
                select(TableSession.id).where(
                    TableSession.tenant_id == tenant_id,
                    TableSession.branch_id == branch_id,
                    TableSession.table_id == table.id,
                    TableSession.status == TableSessionStatus.OPEN,
                )
            )
        )
        .scalars()
        .all()
    )
    if len(open_session_ids) != 1 or open_session_ids[0] != table_session.id:
        raise DomainError(
            "table_session_conflict",
            "The table has conflicting open sessions",
            status_code=409,
        )

    orders = (
        (
            await db.execute(
                select(Order)
                .where(
                    Order.tenant_id == tenant_id,
                    Order.branch_id == branch_id,
                    Order.table_session_id == table_session.id,
                )
                .options(selectinload(Order.payments))
            )
        )
        .scalars()
        .all()
    )
    open_orders = [
        order
        for order in orders
        if order.status not in {OrderStatus.PAID, OrderStatus.CANCELLED, OrderStatus.VOIDED}
    ]
    if open_orders:
        raise DomainError(
            "table_has_open_orders",
            "Settle or cancel every open order before closing the table",
            status_code=409,
            details={"order_ids": [str(order.id) for order in open_orders]},
        )

    unsettled_orders: list[dict[str, str]] = []
    for order in orders:
        completed_amount = sum(
            (
                payment.amount
                for payment in order.payments
                if payment.status == PaymentStatus.COMPLETED
            ),
            Decimal("0"),
        )
        if order.status == OrderStatus.PAID and completed_amount < order.total:
            unsettled_orders.append(
                {
                    "order_id": str(order.id),
                    "remaining": str(order.total - completed_amount),
                }
            )
        elif order.status in {OrderStatus.CANCELLED, OrderStatus.VOIDED} and completed_amount > 0:
            unsettled_orders.append(
                {
                    "order_id": str(order.id),
                    "remaining": "payment_reversal_required",
                }
            )
    if unsettled_orders:
        raise DomainError(
            "table_has_unsettled_balance",
            "The table has an unsettled payment balance",
            status_code=409,
            details={"orders": unsettled_orders},
        )

    previous_table_state = table.state.value
    previous_version = table.version
    closed_at = utcnow()
    table_session.status = TableSessionStatus.CLOSED
    table_session.closed_at = closed_at
    table.state = TableState.AVAILABLE
    table.version += 1
    add_audit_log(
        db,
        identity=identity,
        action="table_session.closed",
        resource_type="table_session",
        resource_id=table_session.id,
        previous_value={
            "status": TableSessionStatus.OPEN.value,
            "table_state": previous_table_state,
            "table_version": previous_version,
        },
        new_value={
            "status": TableSessionStatus.CLOSED.value,
            "table_state": table.state.value,
            "table_version": table.version,
            "order_count": len(orders),
        },
    )
    await db.commit()
    await request.app.state.realtime.broadcast(
        tenant_id,
        branch_id,
        {
            "type": "table.closed",
            "table_id": str(table.id),
            "session_id": str(table_session.id),
            "version": table.version,
        },
    )
    return TableSessionCloseOut(
        table=TableOut.model_validate(table),
        session_id=table_session.id,
        already_closed=False,
        closed_at=closed_at,
    )


@router.post("", response_model=TableOut, status_code=status.HTTP_201_CREATED)
async def create_table(
    payload: TableCreate,
    identity: TableManager,
    db: DbSession,
) -> TableOut:
    tenant_id = require_tenant(identity)
    area = (
        await db.execute(
            select(Area).where(Area.id == payload.area_id, Area.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if area is None:
        raise DomainError("area_not_found", "Area not found", status_code=404)
    if identity.branch_id is not None and area.branch_id != identity.branch_id:
        raise DomainError("area_not_found", "Area not found", status_code=404)
    await _ensure_table_name_available(
        db,
        tenant_id=tenant_id,
        branch_id=area.branch_id,
        area_id=area.id,
        name=payload.name,
    )
    table = DiningTable(
        tenant_id=tenant_id,
        branch_id=area.branch_id,
        **payload.model_dump(),
    )
    db.add(table)
    await db.commit()
    await db.refresh(table)
    return TableOut.model_validate(table)


@router.patch("/{table_id}", response_model=TableOut)
async def update_table(
    table_id: UUID,
    payload: TableUpdate,
    identity: TableManager,
    db: DbSession,
) -> TableOut:
    tenant_id = require_tenant(identity)
    table = (
        await db.execute(
            select(DiningTable).where(
                DiningTable.id == table_id, DiningTable.tenant_id == tenant_id
            )
        )
    ).scalar_one_or_none()
    if table is None:
        raise DomainError("table_not_found", "Table not found", status_code=404)
    require_record_branch(identity, table.branch_id)
    data = payload.model_dump(exclude_unset=True)
    if "area_id" in data:
        area = (
            await db.execute(
                select(Area).where(Area.id == data["area_id"], Area.tenant_id == tenant_id)
            )
        ).scalar_one_or_none()
        if area is None or area.branch_id != table.branch_id:
            raise DomainError("area_not_found", "Area not found", status_code=404)
    target_area_id = data.get("area_id", table.area_id)
    target_name = data.get("name", table.name)
    if target_area_id != table.area_id or target_name != table.name:
        await _ensure_table_name_available(
            db,
            tenant_id=tenant_id,
            branch_id=table.branch_id,
            area_id=target_area_id,
            name=target_name,
            exclude_id=table.id,
        )
    previous = {"name": table.name, "state": table.state.value, "is_active": table.is_active}
    for key, value in data.items():
        setattr(table, key, value)
    table.version += 1
    add_audit_log(
        db,
        identity=identity,
        action="table.updated",
        resource_type="table",
        resource_id=table.id,
        previous_value=previous,
        new_value={"name": table.name, "state": table.state.value, "is_active": table.is_active},
    )
    await db.commit()
    return TableOut.model_validate(table)


@router.delete("/{table_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_table(
    table_id: UUID,
    identity: TableManager,
    db: DbSession,
) -> None:
    table = (
        await db.execute(
            select(DiningTable).where(
                DiningTable.id == table_id,
                DiningTable.tenant_id == require_tenant(identity),
            )
        )
    ).scalar_one_or_none()
    if table is None:
        raise DomainError("table_not_found", "Table not found", status_code=404)
    require_record_branch(identity, table.branch_id)
    table.is_active = False
    table.state = TableState.DISABLED
    table.version += 1
    add_audit_log(
        db,
        identity=identity,
        action="table.archived",
        resource_type="table",
        resource_id=table.id,
    )
    await db.commit()


@router.patch("/{table_id}/guest-label", response_model=TableOut)
async def set_table_guest_label(
    table_id: UUID,
    payload: TableGuestLabelUpdate,
    identity: TableOperator,
    db: DbSession,
) -> TableOut:
    """Attach or clear the short guest note shown next to the table name.

    Scoped to `tables.operate` rather than `tables.manage`: whoever is allowed to
    serve a table is allowed to label it, which is the point of the feature.
    """
    tenant_id = require_tenant(identity)
    table = (
        await db.execute(
            select(DiningTable).where(
                DiningTable.id == table_id, DiningTable.tenant_id == tenant_id
            )
        )
    ).scalar_one_or_none()
    if table is None:
        raise DomainError("table_not_found", "Table not found", status_code=404)
    require_record_branch(identity, table.branch_id)

    label = (payload.guest_label or "").strip()
    previous = table.guest_label
    table.guest_label = label or None
    add_audit_log(
        db,
        identity=identity,
        action="table.guest_label_set" if label else "table.guest_label_cleared",
        resource_type="dining_table",
        resource_id=table.id,
        branch_id=table.branch_id,
        previous_value={"guest_label": previous},
        new_value={"guest_label": table.guest_label},
    )
    await db.commit()
    return TableOut.model_validate(table)
