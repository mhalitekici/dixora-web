from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.dependencies import (
    DbSession,
    Identity,
    require_branch,
    require_permissions,
    require_tenant,
)
from app.errors import DomainError
from app.models import HotelRoom, HotelRoomCheckout, Order, OrderItem, Payment, TableSession
from app.models.enums import HotelRoomStatus, PaymentStatus
from app.schemas import (
    HotelRoomCheckIn,
    HotelRoomCheckOut,
    HotelRoomCheckoutOut,
    HotelRoomCreate,
    HotelRoomOut,
    HotelRoomUpdate,
    OrderItemOut,
    RoomFolioOrderOut,
    RoomFolioOut,
)
from app.security import utcnow
from app.services.audit import add_audit_log

router = APIRouter(prefix="/hotel-rooms", tags=["hotel-rooms"])
HotelRoomReader = Annotated[Identity, Depends(require_permissions("hotel_rooms.read"))]
HotelRoomManager = Annotated[Identity, Depends(require_permissions("hotel_rooms.manage"))]


async def _get_room(
    db: DbSession,
    *,
    tenant_id: UUID,
    branch_id: UUID,
    room_id: UUID,
    lock: bool = True,
) -> HotelRoom:
    query = select(HotelRoom).where(
        HotelRoom.id == room_id,
        HotelRoom.tenant_id == tenant_id,
        HotelRoom.branch_id == branch_id,
    )
    if lock:
        query = query.with_for_update()
    room = (await db.execute(query)).scalar_one_or_none()
    if room is None:
        raise DomainError("hotel_room_not_found", "Hotel room not found", status_code=404)
    return room


async def _room_folio(
    db: DbSession,
    *,
    tenant_id: UUID,
    branch_id: UUID,
    room_number: str,
    since: datetime | None,
) -> RoomFolioOut:
    """Every ROOM_CHARGE payment for this room's *current* stay only.

    A room cannot become OCCUPIED again until it has been checked out, so the
    stay's `checked_in_at` is a hard lower bound: charges from a previous,
    already-settled guest can never leak into this folio or the checkout
    total that is computed from it. Used by both the checkout-preview
    endpoint and the checkout charge itself, so the two can never disagree.
    """
    room_number_token = room_number.strip().lower()
    if not room_number_token or since is None:
        return RoomFolioOut(reference=room_number, orders=[], total=Decimal("0"))

    rows = (
        (
            await db.execute(
                select(Order)
                .join(Payment, Payment.order_id == Order.id)
                .where(
                    Order.tenant_id == tenant_id,
                    Order.branch_id == branch_id,
                    Payment.method == "ROOM_CHARGE",
                    Payment.status == PaymentStatus.COMPLETED,
                    Payment.reference.isnot(None),
                    Payment.created_at >= since,
                )
                .options(
                    selectinload(Order.table_session).selectinload(TableSession.table),
                    selectinload(Order.items).selectinload(OrderItem.modifiers),
                    selectinload(Order.payments),
                )
                .order_by(Order.created_at.desc())
                .distinct()
            )
        )
        .scalars()
        .all()
    )

    orders_out: list[RoomFolioOrderOut] = []
    grand_total = Decimal("0")
    for order in rows:
        matching_payments = [
            payment
            for payment in order.payments
            if payment.method == "ROOM_CHARGE"
            and payment.status == PaymentStatus.COMPLETED
            and payment.created_at >= since
            and room_number_token in (payment.reference or "").strip().lower().split()
        ]
        if not matching_payments:
            continue
        room_amount = sum((payment.amount for payment in matching_payments), Decimal("0"))
        grand_total += room_amount
        orders_out.append(
            RoomFolioOrderOut(
                order_id=order.id,
                reference=matching_payments[0].reference or room_number,
                table_name=order.table_name,
                created_at=order.created_at,
                items=[OrderItemOut.model_validate(item) for item in order.items],
                order_total=order.total,
                room_charge_amount=room_amount,
            )
        )

    return RoomFolioOut(reference=room_number, orders=orders_out, total=grand_total)


@router.get("", response_model=list[HotelRoomOut])
async def list_hotel_rooms(
    identity: HotelRoomReader,
    db: DbSession,
) -> list[HotelRoomOut]:
    rooms = (
        (
            await db.execute(
                select(HotelRoom)
                .where(
                    HotelRoom.tenant_id == require_tenant(identity),
                    HotelRoom.branch_id == require_branch(identity),
                    HotelRoom.is_active.is_(True),
                )
                .order_by(HotelRoom.sort_order, HotelRoom.room_number)
            )
        )
        .scalars()
        .all()
    )
    return [HotelRoomOut.model_validate(room) for room in rooms]


@router.post("", response_model=HotelRoomOut, status_code=status.HTTP_201_CREATED)
async def create_hotel_room(
    payload: HotelRoomCreate,
    identity: HotelRoomManager,
    db: DbSession,
) -> HotelRoomOut:
    tenant_id = require_tenant(identity)
    branch_id = require_branch(identity)
    existing = (
        await db.execute(
            select(HotelRoom.id).where(
                HotelRoom.tenant_id == tenant_id,
                HotelRoom.branch_id == branch_id,
                HotelRoom.room_number == payload.room_number,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise DomainError(
            "hotel_room_number_taken",
            "A room with this number already exists",
            status_code=409,
        )
    room = HotelRoom(
        tenant_id=tenant_id,
        branch_id=branch_id,
        room_number=payload.room_number,
        notes=payload.notes,
        sort_order=payload.sort_order,
        status=HotelRoomStatus.VACANT,
    )
    db.add(room)
    await db.flush()
    add_audit_log(
        db,
        identity=identity,
        action="hotel_room.created",
        resource_type="hotel_room",
        resource_id=room.id,
        new_value={"room_number": room.room_number},
    )
    await db.commit()
    return HotelRoomOut.model_validate(room)


@router.patch("/{room_id}", response_model=HotelRoomOut)
async def update_hotel_room(
    room_id: UUID,
    payload: HotelRoomUpdate,
    identity: HotelRoomManager,
    db: DbSession,
) -> HotelRoomOut:
    tenant_id = require_tenant(identity)
    branch_id = require_branch(identity)
    room = await _get_room(db, tenant_id=tenant_id, branch_id=branch_id, room_id=room_id)
    data = payload.model_dump(exclude_unset=True)
    if "room_number" in data and data["room_number"] != room.room_number:
        clash = (
            await db.execute(
                select(HotelRoom.id).where(
                    HotelRoom.tenant_id == tenant_id,
                    HotelRoom.branch_id == branch_id,
                    HotelRoom.room_number == data["room_number"],
                    HotelRoom.id != room.id,
                )
            )
        ).scalar_one_or_none()
        if clash is not None:
            raise DomainError(
                "hotel_room_number_taken",
                "A room with this number already exists",
                status_code=409,
            )
    for key, value in data.items():
        setattr(room, key, value)
    room.version += 1
    add_audit_log(
        db,
        identity=identity,
        action="hotel_room.updated",
        resource_type="hotel_room",
        resource_id=room.id,
        new_value=data,
    )
    await db.commit()
    return HotelRoomOut.model_validate(room)


@router.post("/{room_id}/check-in", response_model=HotelRoomOut)
async def check_in_hotel_room(
    room_id: UUID,
    payload: HotelRoomCheckIn,
    identity: HotelRoomManager,
    db: DbSession,
) -> HotelRoomOut:
    tenant_id = require_tenant(identity)
    branch_id = require_branch(identity)
    room = await _get_room(db, tenant_id=tenant_id, branch_id=branch_id, room_id=room_id)
    if not room.is_active:
        raise DomainError("hotel_room_inactive", "This room is not active", status_code=409)
    if room.status == HotelRoomStatus.OCCUPIED:
        raise DomainError(
            "hotel_room_occupied",
            "This room already has a guest checked in",
            status_code=409,
        )
    if room.version != payload.expected_version:
        raise DomainError(
            "hotel_room_version_conflict",
            "Room data changed; refresh before checking in",
            status_code=409,
            details={"current_version": room.version},
        )
    room.status = HotelRoomStatus.OCCUPIED
    room.guest_name = payload.guest_name.strip()
    room.checked_in_at = utcnow()
    room.version += 1
    add_audit_log(
        db,
        identity=identity,
        action="hotel_room.checked_in",
        resource_type="hotel_room",
        resource_id=room.id,
        new_value={"room_number": room.room_number, "guest_name": room.guest_name},
    )
    await db.commit()
    return HotelRoomOut.model_validate(room)


@router.get("/{room_id}/folio", response_model=RoomFolioOut)
async def get_hotel_room_folio(
    room_id: UUID,
    identity: HotelRoomReader,
    db: DbSession,
) -> RoomFolioOut:
    """Preview of what check-out will charge — scoped to the current stay only."""
    tenant_id = require_tenant(identity)
    branch_id = require_branch(identity)
    room = await _get_room(
        db, tenant_id=tenant_id, branch_id=branch_id, room_id=room_id, lock=False
    )
    return await _room_folio(
        db,
        tenant_id=tenant_id,
        branch_id=branch_id,
        room_number=room.room_number,
        since=room.checked_in_at,
    )


@router.post("/{room_id}/check-out", response_model=HotelRoomCheckoutOut)
async def check_out_hotel_room(
    room_id: UUID,
    payload: HotelRoomCheckOut,
    identity: HotelRoomManager,
    db: DbSession,
) -> HotelRoomCheckoutOut:
    tenant_id = require_tenant(identity)
    branch_id = require_branch(identity)
    room = await _get_room(db, tenant_id=tenant_id, branch_id=branch_id, room_id=room_id)
    if room.status != HotelRoomStatus.OCCUPIED or not room.guest_name:
        raise DomainError(
            "hotel_room_not_occupied",
            "This room has no guest to check out",
            status_code=409,
        )
    if room.version != payload.expected_version:
        raise DomainError(
            "hotel_room_version_conflict",
            "Room data changed; refresh before checking out",
            status_code=409,
            details={"current_version": room.version},
        )

    folio = await _room_folio(
        db,
        tenant_id=tenant_id,
        branch_id=branch_id,
        room_number=room.room_number,
        since=room.checked_in_at,
    )
    total = folio.total

    checkout = HotelRoomCheckout(
        tenant_id=tenant_id,
        branch_id=branch_id,
        room_id=room.id,
        room_number=room.room_number,
        guest_name=room.guest_name,
        total_amount=total,
        payment_method=payload.payment_method,
        checked_in_at=room.checked_in_at,
        checked_out_at=utcnow(),
        checked_out_by_user_id=identity.user_id,
    )
    db.add(checkout)

    previous_guest = room.guest_name
    room.status = HotelRoomStatus.VACANT
    room.guest_name = None
    room.checked_in_at = None
    room.version += 1

    await db.flush()
    add_audit_log(
        db,
        identity=identity,
        action="hotel_room.checked_out",
        resource_type="hotel_room",
        resource_id=room.id,
        new_value={
            "room_number": room.room_number,
            "guest_name": previous_guest,
            "total_amount": str(total),
            "payment_method": payload.payment_method,
        },
    )
    await db.commit()
    return HotelRoomCheckoutOut.model_validate(checkout)


@router.get("/checkouts", response_model=list[HotelRoomCheckoutOut])
async def list_hotel_room_checkouts(
    identity: HotelRoomReader,
    db: DbSession,
    limit: int = 50,
) -> list[HotelRoomCheckoutOut]:
    rows = (
        (
            await db.execute(
                select(HotelRoomCheckout)
                .where(
                    HotelRoomCheckout.tenant_id == require_tenant(identity),
                    HotelRoomCheckout.branch_id == require_branch(identity),
                )
                .order_by(HotelRoomCheckout.checked_out_at.desc())
                .limit(min(limit, 200))
            )
        )
        .scalars()
        .all()
    )
    return [HotelRoomCheckoutOut.model_validate(row) for row in rows]
