"""Evaluating owner-defined campaigns against an open order.

Every decision here is made server-side. The till sends an order id, never a
list of what should be free — otherwise a modified client could give itself any
discount it liked.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import Identity
from app.errors import DomainError
from app.models import (
    Campaign,
    CampaignApplication,
    CampaignBranch,
    Discount,
    Order,
    OrderItem,
    Product,
)
from app.models.enums import (
    CampaignAudience,
    CampaignRewardKind,
    DiscountKind,
    OrderItemStatus,
    OrderStatus,
    PaymentStatus,
)
from app.security import utcnow

logger = logging.getLogger(__name__)

ZERO = Decimal("0.00")

# States where a bill is still open enough to change.
DISCOUNTABLE_STATUSES = frozenset(
    {
        OrderStatus.ACCEPTED,
        OrderStatus.PREPARING,
        OrderStatus.PARTIALLY_READY,
        OrderStatus.READY,
        OrderStatus.SERVED,
        OrderStatus.BILL_REQUESTED,
    }
)


def money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class CampaignGrant:
    campaign_id: UUID
    campaign_name: str
    order_item_id: UUID
    product_name: str
    amount: Decimal


@dataclass(frozen=True)
class CampaignOutcome:
    granted: list[CampaignGrant]
    total_discount: Decimal
    order_total: Decimal
    skipped_members_only: bool


def validate_definition(
    *,
    buy_product_id: UUID | None,
    buy_category_id: UUID | None,
    reward_kind: CampaignRewardKind,
    reward_product_id: UUID | None,
    reward_category_id: UUID | None,
    reward_value: Decimal,
) -> None:
    """Reject campaigns that could never fire, at the point they are written.

    A campaign the owner cannot see failing is worse than a rejected form: they
    would advertise an offer that silently never applies.
    """
    if (buy_product_id is None) == (buy_category_id is None):
        raise DomainError(
            "campaign_condition_invalid",
            "Koşul için ya bir ürün ya da bir kategori seçin.",
            status_code=422,
        )
    if reward_kind == CampaignRewardKind.FREE_ITEM:
        if (reward_product_id is None) == (reward_category_id is None):
            raise DomainError(
                "campaign_reward_invalid",
                "İkram için ya bir ürün ya da bir kategori seçin.",
                status_code=422,
            )
        return
    if reward_value <= 0:
        raise DomainError(
            "campaign_reward_invalid",
            "İndirim değeri sıfırdan büyük olmalı.",
            status_code=422,
        )
    if reward_kind == CampaignRewardKind.PERCENT and reward_value > 100:
        raise DomainError(
            "campaign_reward_invalid",
            "Yüzde indirim 100'den büyük olamaz.",
            status_code=422,
        )
    if reward_product_id is None and reward_category_id is None:
        raise DomainError(
            "campaign_reward_invalid",
            "İndirimin uygulanacağı ürünü veya kategoriyi seçin.",
            status_code=422,
        )


def is_live(campaign: Campaign) -> bool:
    if not campaign.is_active:
        return False
    now = utcnow().replace(tzinfo=None)
    if campaign.starts_at is not None and campaign.starts_at > now:
        return False
    if campaign.ends_at is not None and campaign.ends_at <= now:
        return False
    return True


async def _product_categories(
    db: AsyncSession, *, tenant_id: UUID, product_ids: set[UUID]
) -> dict[UUID, UUID | None]:
    if not product_ids:
        return {}
    rows = (
        await db.execute(
            select(Product.id, Product.category_id).where(
                Product.tenant_id == tenant_id,
                Product.id.in_(product_ids),
            )
        )
    ).all()
    return {row[0]: row[1] for row in rows}


async def _product_names(
    db: AsyncSession, *, tenant_id: UUID, product_ids: set[UUID]
) -> dict[UUID, str]:
    if not product_ids:
        return {}
    rows = (
        await db.execute(
            select(Product.id, Product.name).where(
                Product.tenant_id == tenant_id,
                Product.id.in_(product_ids),
            )
        )
    ).all()
    return {row[0]: row[1] for row in rows}


def _matches(
    item: OrderItem,
    *,
    product_id: UUID | None,
    category_id: UUID | None,
    categories: dict[UUID, UUID | None],
) -> bool:
    if product_id is not None:
        return item.product_id == product_id
    if category_id is not None:
        return categories.get(item.product_id) == category_id
    return False


async def _remaining_value(
    db: AsyncSession, *, tenant_id: UUID, item: OrderItem
) -> Decimal:
    """What is still discountable on a line, after anything already applied."""
    prior = (
        await db.execute(
            select(func.coalesce(func.sum(Discount.amount), 0)).where(
                Discount.tenant_id == tenant_id,
                Discount.order_item_id == item.id,
            )
        )
    ).scalar_one()
    return max(ZERO, item.line_total - Decimal(prior))


async def active_campaigns_for_branch(
    db: AsyncSession, *, tenant_id: UUID, branch_id: UUID
) -> list[Campaign]:
    campaigns = (
        (
            await db.execute(
                select(Campaign)
                .join(CampaignBranch, CampaignBranch.campaign_id == Campaign.id)
                .where(
                    Campaign.tenant_id == tenant_id,
                    Campaign.is_active.is_(True),
                    CampaignBranch.branch_id == branch_id,
                )
                .order_by(Campaign.created_at)
            )
        )
        .scalars()
        .all()
    )
    return [campaign for campaign in campaigns if is_live(campaign)]


async def apply_campaigns_to_order(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    order: Order,
    identity: Identity,
    has_membership: bool,
) -> CampaignOutcome:
    """Grant every campaign this basket qualifies for.

    Re-running is safe: an offer already recorded against a line is skipped, so
    a cashier tapping twice does not stack discounts.
    """
    if order.status not in DISCOUNTABLE_STATUSES:
        raise DomainError(
            "order_not_discountable",
            "Kampanya yalnızca açık bir hesaba uygulanabilir.",
            status_code=409,
        )
    if any(payment.status == PaymentStatus.COMPLETED for payment in order.payments):
        raise DomainError(
            "campaign_after_payment_started",
            "Kampanya, ödeme alınmaya başlamadan önce uygulanmalıdır.",
            status_code=409,
        )

    campaigns = await active_campaigns_for_branch(
        db, tenant_id=tenant_id, branch_id=order.branch_id
    )
    live_items = [
        item
        for item in order.items
        if item.status not in {OrderItemStatus.CANCELLED, OrderItemStatus.VOIDED}
    ]
    categories = await _product_categories(
        db, tenant_id=tenant_id, product_ids={item.product_id for item in live_items}
    )
    names = await _product_names(
        db, tenant_id=tenant_id, product_ids={item.product_id for item in live_items}
    )

    already = {
        (row[0], row[1])
        for row in (
            await db.execute(
                select(
                    CampaignApplication.campaign_id, CampaignApplication.order_item_id
                ).where(
                    CampaignApplication.tenant_id == tenant_id,
                    CampaignApplication.order_id == order.id,
                )
            )
        ).all()
    }

    granted: list[CampaignGrant] = []
    skipped_members_only = False
    consumed: set[UUID] = set()

    for campaign in campaigns:
        if campaign.audience == CampaignAudience.MEMBERS_ONLY and not has_membership:
            skipped_members_only = True
            continue
        if order.subtotal < campaign.minimum_order_amount:
            continue

        qualifying = sum(
            item.quantity
            for item in live_items
            if _matches(
                item,
                product_id=campaign.buy_product_id,
                category_id=campaign.buy_category_id,
                categories=categories,
            )
        )
        if qualifying < campaign.buy_quantity:
            continue
        # How many times the basket earns this offer, capped by the owner.
        times = min(
            int(qualifying // campaign.buy_quantity), campaign.max_uses_per_order
        )
        if times <= 0:
            continue

        targets = [
            item
            for item in live_items
            if item.id not in consumed
            and (campaign.id, item.id) not in already
            and _matches(
                item,
                product_id=campaign.reward_product_id,
                category_id=campaign.reward_category_id,
                categories=categories,
            )
        ]
        # Best value first: the offer was advertised, so honour it generously
        # rather than quietly picking the customer's cheapest qualifying line.
        targets.sort(key=lambda item: item.unit_price, reverse=True)

        for target in targets[:times]:
            remaining = await _remaining_value(db, tenant_id=tenant_id, item=target)
            if remaining <= 0:
                continue
            if campaign.reward_kind == CampaignRewardKind.FREE_ITEM:
                amount = min(target.unit_price, remaining)
            elif campaign.reward_kind == CampaignRewardKind.PERCENT:
                amount = min(
                    money(target.line_total * campaign.reward_value / Decimal("100")),
                    remaining,
                )
            else:
                amount = min(campaign.reward_value, remaining)
            amount = money(amount)
            if amount <= 0:
                continue

            discount = Discount(
                tenant_id=tenant_id,
                branch_id=order.branch_id,
                order_id=order.id,
                order_item_id=target.id,
                requested_by_user_id=identity.user_id,
                approved_by_user_id=identity.user_id,
                kind=DiscountKind.FIXED,
                value=amount,
                amount=amount,
                reason=f"Kampanya: {campaign.name}",
            )
            db.add(discount)
            await db.flush()

            db.add(
                CampaignApplication(
                    tenant_id=tenant_id,
                    branch_id=order.branch_id,
                    campaign_id=campaign.id,
                    order_id=order.id,
                    order_item_id=target.id,
                    discount_id=discount.id,
                    amount=amount,
                    campaign_name_snapshot=campaign.name,
                )
            )
            order.discount_total = money(order.discount_total + amount)
            order.total = money(
                max(ZERO, order.subtotal - order.discount_total + order.tax_total)
            )
            order.version += 1
            consumed.add(target.id)
            granted.append(
                CampaignGrant(
                    campaign_id=campaign.id,
                    campaign_name=campaign.name,
                    order_item_id=target.id,
                    product_name=names.get(target.product_id, "Ürün"),
                    amount=amount,
                )
            )

    await db.flush()
    return CampaignOutcome(
        granted=granted,
        total_discount=money(sum((grant.amount for grant in granted), ZERO)),
        order_total=order.total,
        skipped_members_only=skipped_members_only,
    )
