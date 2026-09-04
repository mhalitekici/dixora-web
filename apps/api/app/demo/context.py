"""Handles the structural pass hands to the history pass.

The two phases are separated because building a business and running ninety days
of trade through it are different jobs: the first writes a few hundred rows with
the ORM, the second writes a hundred thousand with bulk inserts. This module is
the only thing they share.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from uuid import UUID

from app.demo.data import BranchSpec, ProductSpec


@dataclass(frozen=True)
class ModifierGroupContext:
    id: UUID
    name: str
    is_required: bool
    minimum: int
    maximum: int | None
    # (modifier id, name, price delta)
    options: tuple[tuple[UUID, str, Decimal], ...]


@dataclass(frozen=True)
class ProductContext:
    id: UUID
    spec: ProductSpec
    category_id: UUID
    category_name: str

    @property
    def name(self) -> str:
        return self.spec.name

    @property
    def price(self) -> Decimal:
        return Decimal(self.spec.price)


@dataclass
class BranchContext:
    spec: BranchSpec
    id: UUID
    # station code -> preparation_stations.id for *this* branch
    stations: dict[str, UUID] = field(default_factory=dict)
    # (table id, table name, area id)
    tables: list[tuple[UUID, str, UUID]] = field(default_factory=list)
    manager_id: UUID | None = None
    cashiers: list[UUID] = field(default_factory=list)
    waiters: list[UUID] = field(default_factory=list)
    cashier_names: dict[UUID, str] = field(default_factory=dict)
    # inventory item name -> inventory_items.id for this branch
    inventory: dict[str, UUID] = field(default_factory=dict)
    location_id: UUID | None = None
    # station code -> printer_devices.id
    printers: dict[str, UUID] = field(default_factory=dict)

    @property
    def slug(self) -> str:
        return self.spec.slug

    @property
    def name(self) -> str:
        return self.spec.name


@dataclass
class MembershipContext:
    id: UUID
    customer_id: UUID
    branch_id: UUID
    display_name: str
    # Visits counted so far by the loyalty ledger.
    accruals: int = 0
    # How many rewards have been issued, i.e. the next ordinal to use.
    rewards_issued: int = 0
    # Reward ids that are still AVAILABLE, oldest first.
    available_rewards: list[UUID] = field(default_factory=list)


@dataclass
class DemoContext:
    tenant_id: UUID
    currency: str
    owner_id: UUID
    branches: list[BranchContext] = field(default_factory=list)
    products: list[ProductContext] = field(default_factory=list)
    products_by_name: dict[str, ProductContext] = field(default_factory=dict)
    products_by_category: dict[str, list[ProductContext]] = field(default_factory=dict)
    categories: dict[str, UUID] = field(default_factory=dict)
    modifier_groups_by_product: dict[UUID, list[ModifierGroupContext]] = field(
        default_factory=dict
    )
    # product id -> ((inventory item name, quantity per portion), ...)
    recipes: dict[UUID, tuple[tuple[str, Decimal], ...]] = field(default_factory=dict)
    program_id: UUID | None = None
    reward_category_id: UUID | None = None
    memberships: list[MembershipContext] = field(default_factory=list)
    # Campaign used by the historical generator: "3 hot drinks, 4th free".
    coffee_campaign_id: UUID | None = None
