from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import (
    MONEY,
    QUANTITY,
    ZERO_MONEY,
    ZERO_QUANTITY,
    Base,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
)
from app.models.enums import StockMovementType, enum_column

if TYPE_CHECKING:
    from app.models.catalog import Product


class InventoryItem(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "inventory_items"
    __table_args__ = (
        UniqueConstraint("tenant_id", "branch_id", "sku", name="uq_inventory_scope_sku"),
        CheckConstraint("minimum_stock >= 0", name="minimum_stock_nonnegative"),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    sku: Mapped[str | None] = mapped_column(String(80), nullable=True)
    unit: Mapped[str] = mapped_column(String(20), nullable=False)
    minimum_stock: Mapped[Decimal] = mapped_column(QUANTITY, default=ZERO_QUANTITY, nullable=False)
    average_cost: Mapped[Decimal] = mapped_column(MONEY, default=ZERO_MONEY, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class InventoryLocation(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "inventory_locations"
    __table_args__ = (
        UniqueConstraint("tenant_id", "branch_id", "name", name="uq_inventory_location_scope"),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class StockBalance(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "stock_balances"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "branch_id",
            "inventory_item_id",
            "location_id",
            name="uq_stock_balance_scope",
        ),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    inventory_item_id: Mapped[UUID] = mapped_column(
        ForeignKey("inventory_items.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    location_id: Mapped[UUID] = mapped_column(
        ForeignKey("inventory_locations.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    quantity: Mapped[Decimal] = mapped_column(QUANTITY, default=ZERO_QUANTITY, nullable=False)
    version: Mapped[int] = mapped_column(default=1, nullable=False)

    item: Mapped[InventoryItem] = relationship()
    location: Mapped[InventoryLocation] = relationship()


class ProductRecipe(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "product_recipes"
    __table_args__ = (
        UniqueConstraint("tenant_id", "branch_id", "product_id", name="uq_recipe_scope_product"),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    product_id: Mapped[UUID] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    yield_quantity: Mapped[Decimal] = mapped_column(
        QUANTITY, default=Decimal("1.000000"), nullable=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    product: Mapped[Product] = relationship(back_populates="recipes")
    items: Mapped[list[ProductRecipeItem]] = relationship(
        back_populates="recipe", lazy="selectin", cascade="all, delete-orphan"
    )


class ProductRecipeItem(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "product_recipe_items"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "recipe_id", "inventory_item_id", name="uq_recipe_inventory_item"
        ),
        CheckConstraint("quantity > 0", name="recipe_item_quantity_positive"),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    recipe_id: Mapped[UUID] = mapped_column(
        ForeignKey("product_recipes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    inventory_item_id: Mapped[UUID] = mapped_column(
        ForeignKey("inventory_items.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    quantity: Mapped[Decimal] = mapped_column(QUANTITY, nullable=False)

    recipe: Mapped[ProductRecipe] = relationship(back_populates="items")
    inventory_item: Mapped[InventoryItem] = relationship()


class StockMovement(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "stock_movements"
    __table_args__ = (
        UniqueConstraint("tenant_id", "idempotency_key", name="uq_stock_movement_idempotency"),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    inventory_item_id: Mapped[UUID] = mapped_column(
        ForeignKey("inventory_items.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    location_id: Mapped[UUID] = mapped_column(
        ForeignKey("inventory_locations.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    order_item_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("order_items.id", ondelete="SET NULL"), nullable=True, index=True
    )
    actor_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    movement_type: Mapped[StockMovementType] = mapped_column(
        enum_column(StockMovementType, "stock_movement_type"), nullable=False, index=True
    )
    quantity_delta: Mapped[Decimal] = mapped_column(QUANTITY, nullable=False)
    balance_after: Mapped[Decimal] = mapped_column(QUANTITY, nullable=False)
    unit_cost: Mapped[Decimal] = mapped_column(MONEY, default=ZERO_MONEY, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    idempotency_key: Mapped[str] = mapped_column(String(160), nullable=False)


class StockCount(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "stock_counts"

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    location_id: Mapped[UUID] = mapped_column(
        ForeignKey("inventory_locations.id", ondelete="RESTRICT"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(30), default="DRAFT", nullable=False)
    counted_by_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(nullable=True)


class StockAdjustment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "stock_adjustments"

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    branch_id: Mapped[UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    inventory_item_id: Mapped[UUID] = mapped_column(
        ForeignKey("inventory_items.id", ondelete="RESTRICT"), nullable=False
    )
    quantity_delta: Mapped[Decimal] = mapped_column(QUANTITY, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    actor_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class Supplier(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "suppliers"
    __table_args__ = (UniqueConstraint("tenant_id", "name", name="uq_supplier_tenant_name"),)

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    contact: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
