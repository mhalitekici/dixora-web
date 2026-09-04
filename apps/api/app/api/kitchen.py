from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request
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
from app.models import (
    DiningTable,
    KitchenTicket,
    KitchenTicketItem,
    Order,
    OrderItem,
    PreparationStation,
    TableSession,
    User,
)
from app.models.enums import (
    KitchenTicketStatus,
    OrderItemStatus,
    OrderStatus,
    TableState,
)
from app.schemas import KitchenStatusUpdate, KitchenTicketItemOut, KitchenTicketOut
from app.services.audit import add_audit_log

router = APIRouter(prefix="/kitchen", tags=["kitchen"])
KitchenReader = Annotated[Identity, Depends(require_permissions("kitchen.read"))]
KitchenManager = Annotated[Identity, Depends(require_permissions("kitchen.manage"))]

TRANSITIONS: dict[KitchenTicketStatus, set[KitchenTicketStatus]] = {
    KitchenTicketStatus.NEW: {KitchenTicketStatus.ACCEPTED, KitchenTicketStatus.CANCELLED},
    KitchenTicketStatus.ACCEPTED: {
        KitchenTicketStatus.PREPARING,
        KitchenTicketStatus.CANCELLED,
    },
    KitchenTicketStatus.PREPARING: {
        KitchenTicketStatus.READY,
        KitchenTicketStatus.CANCELLED,
    },
    KitchenTicketStatus.READY: {KitchenTicketStatus.COMPLETED},
    KitchenTicketStatus.COMPLETED: set(),
    KitchenTicketStatus.CANCELLED: set(),
}


async def _hydrate_tickets(
    db: DbSession,
    tickets: list[KitchenTicket],
) -> list[KitchenTicketOut]:
    if not tickets:
        return []
    station_ids = {ticket.preparation_station_id for ticket in tickets}
    order_ids = {ticket.order_id for ticket in tickets}
    ticket_ids = {ticket.id for ticket in tickets}
    stations = (
        (await db.execute(select(PreparationStation).where(PreparationStation.id.in_(station_ids))))
        .scalars()
        .all()
    )
    station_names = {station.id: station.name for station in stations}
    orders = (await db.execute(select(Order).where(Order.id.in_(order_ids)))).scalars().all()
    order_map = {order.id: order for order in orders}
    session_ids = {order.table_session_id for order in orders if order.table_session_id}
    user_ids = {order.created_by_user_id for order in orders if order.created_by_user_id}
    sessions = (
        (await db.execute(select(TableSession).where(TableSession.id.in_(session_ids))))
        .scalars()
        .all()
        if session_ids
        else []
    )
    session_map = {session.id: session for session in sessions}
    table_ids = {session.table_id for session in sessions}
    tables = (
        (await db.execute(select(DiningTable).where(DiningTable.id.in_(table_ids)))).scalars().all()
        if table_ids
        else []
    )
    table_names = {table.id: table.name for table in tables}
    users = (
        (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()
        if user_ids
        else []
    )
    user_names = {user.id: user.display_name for user in users}
    ticket_rows = (
        await db.execute(
            select(KitchenTicketItem, OrderItem)
            .join(OrderItem, OrderItem.id == KitchenTicketItem.order_item_id)
            .where(KitchenTicketItem.ticket_id.in_(ticket_ids))
            .options(selectinload(OrderItem.modifiers))
        )
    ).all()
    items_by_ticket: dict[UUID, list[KitchenTicketItemOut]] = {}
    for ticket_item, order_item in ticket_rows:
        items_by_ticket.setdefault(ticket_item.ticket_id, []).append(
            KitchenTicketItemOut(
                id=ticket_item.id,
                order_item_id=order_item.id,
                name=order_item.product_name_snapshot,
                quantity=order_item.quantity,
                note=order_item.note,
                modifiers=[
                    (
                        f"{modifier.quantity}× {modifier.name_snapshot}"
                        if modifier.quantity > 1
                        else modifier.name_snapshot
                    )
                    for modifier in order_item.modifiers
                ],
                status=ticket_item.status,
            )
        )
    output: list[KitchenTicketOut] = []
    for ticket in tickets:
        order = order_map[ticket.order_id]
        session = session_map.get(order.table_session_id) if order.table_session_id else None
        output.append(
            KitchenTicketOut(
                id=ticket.id,
                tenant_id=ticket.tenant_id,
                branch_id=ticket.branch_id,
                order_id=ticket.order_id,
                preparation_station_id=ticket.preparation_station_id,
                station_name=station_names.get(ticket.preparation_station_id, "Station"),
                table_name=table_names.get(session.table_id) if session else None,
                waiter_name=(
                    user_names.get(order.created_by_user_id) if order.created_by_user_id else None
                ),
                order_source=order.source,
                batch_number=ticket.batch_number,
                status=ticket.status,
                created_at=ticket.created_at,
                items=items_by_ticket.get(ticket.id, []),
            )
        )
    return output


@router.get("/tickets", response_model=list[KitchenTicketOut])
async def list_tickets(
    identity: KitchenReader,
    db: DbSession,
    branch_id: UUID | None = None,
    station_id: UUID | None = None,
    include_completed: bool = False,
) -> list[KitchenTicketOut]:
    predicates = [
        KitchenTicket.tenant_id == require_tenant(identity),
        KitchenTicket.branch_id == require_branch(identity, branch_id),
    ]
    if station_id:
        predicates.append(KitchenTicket.preparation_station_id == station_id)
    if not include_completed:
        predicates.append(
            KitchenTicket.status.notin_(
                [KitchenTicketStatus.COMPLETED, KitchenTicketStatus.CANCELLED]
            )
        )
    rows = (
        (
            await db.execute(
                select(KitchenTicket)
                .where(*predicates)
                .order_by(KitchenTicket.created_at)
                .limit(300)
            )
        )
        .scalars()
        .all()
    )
    return await _hydrate_tickets(db, list(rows))


@router.patch("/tickets/{ticket_id}/status", response_model=KitchenTicketOut)
async def update_ticket_status(
    ticket_id: UUID,
    payload: KitchenStatusUpdate,
    request: Request,
    identity: KitchenManager,
    db: DbSession,
) -> KitchenTicketOut:
    ticket = (
        await db.execute(
            select(KitchenTicket)
            .where(
                KitchenTicket.id == ticket_id,
                KitchenTicket.tenant_id == require_tenant(identity),
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if ticket is None:
        raise DomainError("ticket_not_found", "Kitchen ticket not found", status_code=404)
    require_record_branch(identity, ticket.branch_id)
    if payload.status == ticket.status:
        return (await _hydrate_tickets(db, [ticket]))[0]
    if payload.status not in TRANSITIONS[ticket.status]:
        raise DomainError(
            "invalid_ticket_transition",
            f"Ticket cannot move from {ticket.status.value} to {payload.status.value}",
            status_code=409,
        )
    ticket.status = payload.status
    now = datetime.now(UTC)
    item_status = {
        KitchenTicketStatus.ACCEPTED: OrderItemStatus.ACCEPTED,
        KitchenTicketStatus.PREPARING: OrderItemStatus.PREPARING,
        KitchenTicketStatus.READY: OrderItemStatus.READY,
        KitchenTicketStatus.COMPLETED: OrderItemStatus.SERVED,
        KitchenTicketStatus.CANCELLED: OrderItemStatus.CANCELLED,
    }.get(payload.status)
    if payload.status == KitchenTicketStatus.ACCEPTED:
        ticket.accepted_at = now
    elif payload.status == KitchenTicketStatus.PREPARING:
        ticket.started_at = now
    elif payload.status == KitchenTicketStatus.READY:
        ticket.ready_at = now
    elif payload.status == KitchenTicketStatus.COMPLETED:
        ticket.completed_at = now
    if item_status is not None:
        ticket_items = (
            (
                await db.execute(
                    select(KitchenTicketItem).where(KitchenTicketItem.ticket_id == ticket.id)
                )
            )
            .scalars()
            .all()
        )
        for ticket_item in ticket_items:
            ticket_item.status = item_status
        order_items = (
            (
                await db.execute(
                    select(OrderItem).where(
                        OrderItem.id.in_([item.order_item_id for item in ticket_items])
                    )
                )
            )
            .scalars()
            .all()
        )
        for order_item in order_items:
            order_item.status = item_status
    all_tickets = (
        (
            await db.execute(
                select(KitchenTicket).where(
                    KitchenTicket.tenant_id == ticket.tenant_id,
                    KitchenTicket.order_id == ticket.order_id,
                )
            )
        )
        .scalars()
        .all()
    )
    order = await db.get(Order, ticket.order_id)
    # Kitchen prep progress only drives the order/table state while the
    # order is still in the kitchen's own lifecycle. Once checkout has
    # started (bill requested, payment pending/completed) or the order was
    # cancelled/voided, a late-arriving ticket update must not clobber that
    # more advanced state back to READY/PREPARING.
    order_status_follows_kitchen = order is not None and order.status in {
        OrderStatus.SUBMITTED,
        OrderStatus.AWAITING_APPROVAL,
        OrderStatus.ACCEPTED,
        OrderStatus.PREPARING,
        OrderStatus.PARTIALLY_READY,
        OrderStatus.READY,
        OrderStatus.SERVED,
    }
    if order is not None and order_status_follows_kitchen:
        statuses = {item.status for item in all_tickets}
        if statuses <= {KitchenTicketStatus.READY, KitchenTicketStatus.COMPLETED}:
            order.status = OrderStatus.READY
            table_state = TableState.READY
        elif KitchenTicketStatus.READY in statuses or KitchenTicketStatus.COMPLETED in statuses:
            order.status = OrderStatus.PARTIALLY_READY
            table_state = TableState.PREPARING
        elif KitchenTicketStatus.PREPARING in statuses:
            order.status = OrderStatus.PREPARING
            table_state = TableState.PREPARING
        else:
            table_state = TableState.PREPARING
        order.version += 1
        if order.table_session_id:
            table_session = await db.get(TableSession, order.table_session_id)
            if table_session:
                table = await db.get(DiningTable, table_session.table_id)
                if table:
                    table.state = table_state
                    table.version += 1
    add_audit_log(
        db,
        identity=identity,
        action="kitchen.ticket_status_changed",
        resource_type="kitchen_ticket",
        resource_id=ticket.id,
        new_value={"status": ticket.status.value},
    )
    await db.commit()
    await request.app.state.realtime.broadcast(
        ticket.tenant_id,
        ticket.branch_id,
        {
            "type": "kitchen.ticket.updated",
            "ticket_id": str(ticket.id),
            "order_id": str(ticket.order_id),
            "status": ticket.status.value,
        },
    )
    return (await _hydrate_tickets(db, [ticket]))[0]
