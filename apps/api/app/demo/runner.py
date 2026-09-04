"""Orchestrates the demo build and reports what was created."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from random import Random
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.demo import data as D
from app.demo.history import generate_history
from app.demo.seed import build_structure, find_demo_tenant, purge_demo_tenant
from app.models import (
    DiningTable,
    LoyaltyMembership,
    Order,
    OrderItem,
    Payment,
    Product,
    User,
)
from app.models.enums import OrderStatus, PaymentStatus


@dataclass
class DemoReport:
    branches: int
    users: int
    products: int
    tables: int
    members: int
    orders: int
    paid_orders: int
    order_items: int
    gross_sales: Decimal
    live_orders: int
    history_days: int

    def render(self) -> str:
        lines = [
            "",
            f"  {D.TENANT_NAME} demo işletmesi hazır.",
            f"  İşletme kodu (slug): {D.TENANT_SLUG}",
            "",
            f"  Şube                 : {self.branches}",
            f"  Personel             : {self.users}",
            f"  Ürün                 : {self.products}",
            f"  Masa                 : {self.tables}",
            f"  Sadakat üyesi        : {self.members}",
            f"  Sipariş ({self.history_days} gün) : {self.orders}",
            f"  Ödenmiş adisyon      : {self.paid_orders}",
            f"  Sipariş satırı       : {self.order_items}",
            f"  Toplam ciro          : {self.gross_sales:,.2f} TRY",
            f"  Şu an açık adisyon   : {self.live_orders}",
            "",
            "  Giriş bilgileri",
            f"    İşletme sahibi : kemal.meydan@{D.EMAIL_DOMAIN}",
            f"    Yönetici       : nurten.aksoy@{D.EMAIL_DOMAIN}",
            f"    Şube müdürü    : emre.tanriverdi@{D.EMAIL_DOMAIN}",
            f"    Kasiyer        : selin.korkmaz@{D.EMAIL_DOMAIN} (PIN 1204)",
            f"    Garson         : deniz.arslan@{D.EMAIL_DOMAIN} (PIN 2301)",
            f"    Mutfak         : hasan.kilic@{D.EMAIL_DOMAIN}",
            f"    Şifre (hepsi)  : {D.DEMO_PASSWORD}",
            "",
            "  Print bridge token'ları",
        ]
        for branch in D.BRANCHES:
            lines.append(
                f"    {branch.name:<22}: {D.PRINT_BRIDGE_TOKEN_PREFIX}_{branch.slug}"
            )
        lines.append("")
        return "\n".join(lines)


async def seed_demo(
    db: AsyncSession,
    *,
    history_days: int = D.DEFAULT_HISTORY_DAYS,
    seed: int = 20260828,
    reset: bool = False,
) -> DemoReport:
    """Create the demo business from scratch.

    Raises if the demo tenant already exists and `reset` was not requested, so a
    rebuild is always a deliberate act rather than a side effect.
    """
    existing = await find_demo_tenant(db)
    if existing is not None:
        if not reset:
            raise RuntimeError(
                f"'{D.TENANT_SLUG}' işletmesi zaten var. Sıfırdan kurmak için --reset kullanın."
            )
        await purge_demo_tenant(db, existing.id)

    rng = Random(seed)
    context = await build_structure(db, rng=rng, history_days=history_days)
    totals = await generate_history(db, context, rng=rng, history_days=history_days)

    tenant_id = context.tenant_id

    async def count(model: type[Any], *predicates: Any) -> int:
        return int(
            (
                await db.execute(select(func.count()).select_from(model).where(*predicates))
            ).scalar_one()
        )

    gross = (
        await db.execute(
            select(func.coalesce(func.sum(Payment.amount), 0)).where(
                Payment.tenant_id == tenant_id,
                Payment.status == PaymentStatus.COMPLETED,
            )
        )
    ).scalar_one()

    return DemoReport(
        branches=len(context.branches),
        users=await count(User, User.tenant_id == tenant_id),
        products=await count(Product, Product.tenant_id == tenant_id),
        tables=await count(DiningTable, DiningTable.tenant_id == tenant_id),
        members=await count(LoyaltyMembership, LoyaltyMembership.tenant_id == tenant_id),
        orders=await count(Order, Order.tenant_id == tenant_id),
        paid_orders=await count(
            Order, Order.tenant_id == tenant_id, Order.status == OrderStatus.PAID
        ),
        order_items=await count(OrderItem, OrderItem.tenant_id == tenant_id),
        gross_sales=Decimal(gross),
        live_orders=totals.live_orders,
        history_days=history_days,
    )
