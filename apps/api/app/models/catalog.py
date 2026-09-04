from __future__ import annotations

from datetime import time
from decimal import Decimal
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import MONEY, ZERO_MONEY, Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.inventory import ProductRecipe


class Category(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "categories"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "branch_id", "parent_id", "name", name="uq_category_scope_name"
        ),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    branch_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("branches.id", ondelete="CASCADE"), nullable=True, index=True
    )
    source_category_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), nullable=True, index=True
    )
    parent_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    color: Mapped[str] = mapped_column(String(16), default="#EC5A20", nullable=False)
    image_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    translations: Mapped[dict[str, object]] = mapped_column(JSON, default=dict, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class PreparationStation(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "preparation_stations"
    __table_args__ = (
        UniqueConstraint("tenant_id", "branch_id", "name", name="uq_station_scope_name"),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    code: Mapped[str] = mapped_column(String(50), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class Product(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "products"
    __table_args__ = (
        UniqueConstraint("tenant_id", "branch_id", "sku", name="uq_product_branch_sku"),
        CheckConstraint("selling_price >= 0", name="selling_price_nonnegative"),
        CheckConstraint("cost_price >= 0", name="cost_price_nonnegative"),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    branch_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("branches.id", ondelete="CASCADE"), nullable=True, index=True
    )
    source_product_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("products.id", ondelete="SET NULL"), nullable=True, index=True
    )
    category_id: Mapped[UUID] = mapped_column(
        ForeignKey("categories.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    preparation_station_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("preparation_stations.id", ondelete="SET NULL"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    internal_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    sku: Mapped[str | None] = mapped_column(String(80), nullable=True)
    barcode: Mapped[str | None] = mapped_column(String(100), nullable=True)
    selling_price: Mapped[Decimal] = mapped_column(MONEY, default=ZERO_MONEY, nullable=False)
    cost_price: Mapped[Decimal] = mapped_column(MONEY, default=ZERO_MONEY, nullable=False)
    tax_rate: Mapped[Decimal] = mapped_column(MONEY, default=ZERO_MONEY, nullable=False)
    image_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_available: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    qr_visible: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    waiter_visible: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    preparation_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    track_inventory: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    out_of_stock_behavior: Mapped[str] = mapped_column(String(30), default="BLOCK", nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    allergens: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    calories: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    translations: Mapped[dict[str, object]] = mapped_column(JSON, default=dict, nullable=False)

    category: Mapped[Category] = relationship()
    station: Mapped[PreparationStation | None] = relationship()
    recipes: Mapped[list[ProductRecipe]] = relationship(back_populates="product")


class ProductVariant(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "product_variants"
    __table_args__ = (
        UniqueConstraint("tenant_id", "product_id", "name", name="uq_variant_product_name"),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    product_id: Mapped[UUID] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    price_delta: Mapped[Decimal] = mapped_column(MONEY, default=ZERO_MONEY, nullable=False)
    sku: Mapped[str | None] = mapped_column(String(80), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class ModifierGroup(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "modifier_groups"
    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_modifier_group_tenant_name"),
        CheckConstraint("minimum_selection >= 0", name="minimum_selection_nonnegative"),
        CheckConstraint(
            "maximum_selection IS NULL OR maximum_selection >= minimum_selection",
            name="maximum_selection_valid",
        ),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    is_required: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    minimum_selection: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    maximum_selection: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    modifiers: Mapped[list[Modifier]] = relationship(back_populates="group")


class Modifier(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "modifiers"
    __table_args__ = (
        UniqueConstraint("tenant_id", "group_id", "name", name="uq_modifier_group_name"),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    group_id: Mapped[UUID] = mapped_column(
        ForeignKey("modifier_groups.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    price_delta: Mapped[Decimal] = mapped_column(MONEY, default=ZERO_MONEY, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    group: Mapped[ModifierGroup] = relationship(back_populates="modifiers")


class ProductModifierGroup(Base):
    __tablename__ = "product_modifier_groups"

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), primary_key=True
    )
    product_id: Mapped[UUID] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), primary_key=True
    )
    modifier_group_id: Mapped[UUID] = mapped_column(
        ForeignKey("modifier_groups.id", ondelete="CASCADE"), primary_key=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class ProductBranchAvailability(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "product_branch_availability"
    __table_args__ = (
        UniqueConstraint("product_id", "branch_id", name="uq_product_branch_availability"),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    product_id: Mapped[UUID] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="CASCADE"), nullable=False, index=True
    )
    is_available: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    temporarily_sold_out: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    days_of_week: Mapped[list[int]] = mapped_column(JSON, default=list, nullable=False)
    available_from: Mapped[time | None] = mapped_column(nullable=True)
    available_until: Mapped[time | None] = mapped_column(nullable=True)
