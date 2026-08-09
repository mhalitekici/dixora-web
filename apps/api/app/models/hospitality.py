from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import MONEY, Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.enums import HotelRoomStatus, enum_column


class HotelRoom(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "hotel_rooms"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "branch_id", "room_number", name="uq_hotel_room_scope_number"
        ),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    room_number: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[HotelRoomStatus] = mapped_column(
        enum_column(HotelRoomStatus, "hotel_room_status"),
        default=HotelRoomStatus.VACANT,
        nullable=False,
        index=True,
    )
    guest_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    checked_in_at: Mapped[datetime | None] = mapped_column(nullable=True)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    @property
    def folio_reference(self) -> str | None:
        """The exact text staff should key into a ROOM_CHARGE payment for this stay."""
        if self.status != HotelRoomStatus.OCCUPIED:
            return None
        return f"{self.room_number} {self.guest_name}" if self.guest_name else self.room_number


class HotelRoomCheckout(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "hotel_room_checkouts"

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    room_id: Mapped[UUID] = mapped_column(
        ForeignKey("hotel_rooms.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    room_number: Mapped[str] = mapped_column(String(20), nullable=False)
    guest_name: Mapped[str] = mapped_column(String(160), nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    payment_method: Mapped[str] = mapped_column(String(40), nullable=False)
    checked_in_at: Mapped[datetime | None] = mapped_column(nullable=True)
    checked_out_at: Mapped[datetime] = mapped_column(nullable=False)
    checked_out_by_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
