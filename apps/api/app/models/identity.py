from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import JSON, Boolean, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.enums import TenantState, enum_column

if TYPE_CHECKING:
    from app.models.catalog import PreparationStation


class Tenant(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "tenants"

    name: Mapped[str] = mapped_column(String(160), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), nullable=False, unique=True, index=True)
    business_type: Mapped[str] = mapped_column(String(50), default="RESTAURANT", nullable=False)
    state: Mapped[TenantState] = mapped_column(
        enum_column(TenantState, "tenant_state"),
        default=TenantState.TRIAL,
        nullable=False,
        index=True,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    prevent_negative_stock: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    default_currency: Mapped[str] = mapped_column(String(3), default="TRY", nullable=False)

    branches: Mapped[list[Branch]] = relationship(back_populates="tenant")
    users: Mapped[list[User]] = relationship(back_populates="tenant")


class Branch(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "branches"
    __table_args__ = (UniqueConstraint("tenant_id", "slug", name="uq_branch_tenant_slug"),)

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), nullable=False)
    timezone: Mapped[str] = mapped_column(String(80), default="Europe/Istanbul", nullable=False)
    address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    working_hours: Mapped[dict[str, object]] = mapped_column(JSON, default=dict, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Archived branches keep every historical order, payment and audit row; they
    # are simply retired from day-to-day operation. Kept alongside `is_active`
    # so existing queries that filter on it keep working unchanged.
    archived_at: Mapped[datetime | None] = mapped_column(nullable=True)

    tenant: Mapped[Tenant] = relationship(back_populates="branches")


class UserBranchMembership(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Extra branches a user may operate in, beyond their primary `User.branch_id`.

    A user pinned to a branch (`User.branch_id`) is scoped to it; membership rows
    widen that scope so one regional manager can cover, say, Erenköy and Kadıköy
    without being granted business-wide access. Users with no primary branch
    (owners/administrators) already span the whole business and need no rows here.
    """

    __tablename__ = "user_branch_memberships"
    __table_args__ = (
        UniqueConstraint("user_id", "branch_id", name="uq_user_branch_membership"),
        Index("ix_user_branch_memberships_user_active", "user_id", "is_active"),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="CASCADE"), nullable=False, index=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class Permission(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "permissions"

    code: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    description: Mapped[str] = mapped_column(String(255), default="", nullable=False)


class Role(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "roles"
    __table_args__ = (UniqueConstraint("tenant_id", "code", name="uq_role_tenant_code"),)

    tenant_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True, index=True
    )
    code: Mapped[str] = mapped_column(String(50), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    permissions: Mapped[list[Permission]] = relationship(
        secondary="role_permissions",
        lazy="selectin",
    )


class RolePermission(Base):
    __tablename__ = "role_permissions"

    role_id: Mapped[UUID] = mapped_column(
        ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True
    )
    permission_id: Mapped[UUID] = mapped_column(
        ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True
    )


class User(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("tenant_id", "username", name="uq_user_tenant_username"),
        Index("ix_users_tenant_email", "tenant_id", "email"),
    )

    tenant_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    branch_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("branches.id", ondelete="SET NULL"), nullable=True, index=True
    )
    preparation_station_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("preparation_stations.id", ondelete="SET NULL"), nullable=True, index=True
    )
    role_id: Mapped[UUID] = mapped_column(
        ForeignKey("roles.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    username: Mapped[str] = mapped_column(String(100), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    display_name: Mapped[str] = mapped_column(String(160), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(512), nullable=False)
    pin_hash: Mapped[str | None] = mapped_column(String(512), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_super_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(nullable=True)

    tenant: Mapped[Tenant | None] = relationship(back_populates="users")
    branch: Mapped[Branch | None] = relationship()
    preparation_station: Mapped[PreparationStation | None] = relationship()
    role: Mapped[Role] = relationship(lazy="selectin")


class AuthSession(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "auth_sessions"

    tenant_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True, index=True
    )
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_family: Mapped[UUID] = mapped_column(nullable=False, index=True)
    refresh_jti_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(nullable=False, index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(nullable=True)
    device_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)

    user: Mapped[User] = relationship(lazy="selectin")


class TrustedDevice(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "trusted_devices"
    __table_args__ = (
        UniqueConstraint(
            "credential_hash",
            name="uq_trusted_devices_credential_hash",
        ),
        Index(
            "ix_trusted_devices_tenant_branch_expires",
            "tenant_id",
            "branch_id",
            "expires_at",
        ),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_by_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    credential_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(nullable=False, index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)
    last_ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)


class RealtimeTicket(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "realtime_tickets"

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    branch_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("branches.id", ondelete="CASCADE"), nullable=True, index=True
    )
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    auth_session_id: Mapped[UUID] = mapped_column(
        ForeignKey("auth_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    nonce_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(nullable=False, index=True)
    used_at: Mapped[datetime | None] = mapped_column(nullable=True)


class BusinessRegistrationVerification(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A signup awaiting the owner's email confirmation.

    Nothing is provisioned until the code is confirmed, so an abandoned or
    mistyped signup never leaves a half-created business behind. The password is
    stored already hashed.
    """

    __tablename__ = "business_registration_verifications"
    __table_args__ = (
        Index("ix_business_registration_email", "email", "consumed_at"),
    )

    business_name: Mapped[str] = mapped_column(String(140), nullable=False)
    business_type: Mapped[str] = mapped_column(String(50), nullable=False)
    owner_name: Mapped[str] = mapped_column(String(160), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    phone: Mapped[str] = mapped_column(String(32), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(512), nullable=False)
    contract_version: Mapped[str] = mapped_column(String(40), nullable=False)
    code_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    attempts: Mapped[int] = mapped_column(default=0, nullable=False)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(nullable=False, index=True)
    consumed_at: Mapped[datetime | None] = mapped_column(nullable=True)


class TenantOnboarding(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """What the owner told us about their business right after signing up.

    Delivery-marketplace answers drive which integrations we build next, so they
    are kept as first-class columns rather than buried in an analytics event.
    """

    __tablename__ = "tenant_onboarding"
    __table_args__ = (UniqueConstraint("tenant_id", name="uq_tenant_onboarding_tenant"),)

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    offers_delivery: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    delivery_platforms: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    payment_methods: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    accepts_meal_cards: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    meal_card_providers: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    monthly_order_volume: Mapped[str | None] = mapped_column(String(40), nullable=True)
    table_count: Mapped[int | None] = mapped_column(nullable=True)
    heard_from: Mapped[str | None] = mapped_column(String(60), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(nullable=True)
