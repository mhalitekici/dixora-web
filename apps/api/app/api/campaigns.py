from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy import select

from app.campaign_schemas import (
    CampaignApplyOut,
    CampaignGrantOut,
    CampaignOut,
    CampaignUpsert,
)
from app.dependencies import (
    DbSession,
    Identity,
    require_permissions,
    require_tenant,
)
from app.errors import DomainError
from app.models import Branch, Campaign, CampaignBranch, Category, Product
from app.models.enums import CampaignAudience, CampaignRewardKind
from app.services.audit import add_audit_log
from app.services.campaigns import apply_campaigns_to_order, validate_definition
from app.services.orders import load_order

router = APIRouter(prefix="/campaigns", tags=["campaigns"])

CampaignManager = Annotated[Identity, Depends(require_permissions("loyalty.manage"))]
CampaignApplier = Annotated[Identity, Depends(require_permissions("loyalty.redeem"))]


async def _label(
    db: DbSession,
    *,
    tenant_id: UUID,
    product_id: UUID | None,
    category_id: UUID | None,
) -> str:
    if product_id is not None:
        name = (
            await db.execute(
                select(Product.name).where(
                    Product.id == product_id, Product.tenant_id == tenant_id
                )
            )
        ).scalar_one_or_none()
        return name or "ürün"
    if category_id is not None:
        name = (
            await db.execute(
                select(Category.name).where(
                    Category.id == category_id, Category.tenant_id == tenant_id
                )
            )
        ).scalar_one_or_none()
        return f"{name} kategorisi" if name else "kategori"
    return "ürün"


async def _summary(db: DbSession, *, tenant_id: UUID, campaign: Campaign) -> str:
    """One sentence describing the offer, phrased the same everywhere."""
    buy = await _label(
        db,
        tenant_id=tenant_id,
        product_id=campaign.buy_product_id,
        category_id=campaign.buy_category_id,
    )
    target = await _label(
        db,
        tenant_id=tenant_id,
        product_id=campaign.reward_product_id,
        category_id=campaign.reward_category_id,
    )
    condition = (
        f"{campaign.buy_quantity} {buy}" if campaign.buy_quantity > 1 else f"{buy}"
    )
    if campaign.reward_kind == CampaignRewardKind.FREE_ITEM:
        return f"{condition} alana {target} ikram"
    if campaign.reward_kind == CampaignRewardKind.PERCENT:
        return f"{condition} alana {target} %{campaign.reward_value:g} indirim"
    return f"{condition} alana {target} {campaign.reward_value:g} TL indirim"


async def _output(db: DbSession, *, tenant_id: UUID, campaign: Campaign) -> CampaignOut:
    return CampaignOut(
        id=campaign.id,
        name=campaign.name,
        description=campaign.description,
        is_active=campaign.is_active,
        branch_ids=[link.branch_id for link in campaign.campaign_branches],
        buy_product_id=campaign.buy_product_id,
        buy_category_id=campaign.buy_category_id,
        buy_quantity=campaign.buy_quantity,
        minimum_order_amount=campaign.minimum_order_amount,
        reward_kind=CampaignRewardKind(campaign.reward_kind).value,
        reward_product_id=campaign.reward_product_id,
        reward_category_id=campaign.reward_category_id,
        reward_quantity=campaign.reward_quantity,
        reward_value=campaign.reward_value,
        audience=CampaignAudience(campaign.audience).value,
        max_uses_per_order=campaign.max_uses_per_order,
        starts_at=campaign.starts_at,
        ends_at=campaign.ends_at,
        version=campaign.version,
        summary=await _summary(db, tenant_id=tenant_id, campaign=campaign),
    )


async def _validate_references(
    db: DbSession, *, tenant_id: UUID, payload: CampaignUpsert
) -> None:
    """Every id must belong to this business — never trust the browser's ids."""
    for product_id in (payload.buy_product_id, payload.reward_product_id):
        if product_id is None:
            continue
        found = (
            await db.execute(
                select(Product.id).where(
                    Product.id == product_id, Product.tenant_id == tenant_id
                )
            )
        ).scalar_one_or_none()
        if found is None:
            raise DomainError("product_not_found", "Ürün bulunamadı.", status_code=404)
    for category_id in (payload.buy_category_id, payload.reward_category_id):
        if category_id is None:
            continue
        found = (
            await db.execute(
                select(Category.id).where(
                    Category.id == category_id, Category.tenant_id == tenant_id
                )
            )
        ).scalar_one_or_none()
        if found is None:
            raise DomainError(
                "category_not_found", "Kategori bulunamadı.", status_code=404
            )
    branches = (
        (
            await db.execute(
                select(Branch.id).where(
                    Branch.tenant_id == tenant_id, Branch.id.in_(payload.branch_ids)
                )
            )
        )
        .scalars()
        .all()
    )
    if len(set(branches)) != len(set(payload.branch_ids)):
        raise DomainError("branch_not_found", "Şube bulunamadı.", status_code=404)
    if payload.ends_at is not None and payload.starts_at is not None:
        if payload.ends_at <= payload.starts_at:
            raise DomainError(
                "campaign_dates_invalid",
                "Bitiş tarihi başlangıçtan sonra olmalı.",
                status_code=422,
            )


def _assign(campaign: Campaign, payload: CampaignUpsert) -> None:
    campaign.name = payload.name
    campaign.description = payload.description
    campaign.is_active = payload.is_active
    campaign.buy_product_id = payload.buy_product_id
    campaign.buy_category_id = payload.buy_category_id
    campaign.buy_quantity = payload.buy_quantity
    campaign.minimum_order_amount = payload.minimum_order_amount
    campaign.reward_kind = CampaignRewardKind(payload.reward_kind)
    campaign.reward_product_id = payload.reward_product_id
    campaign.reward_category_id = payload.reward_category_id
    campaign.reward_quantity = payload.reward_quantity
    campaign.reward_value = payload.reward_value
    campaign.audience = CampaignAudience(payload.audience)
    campaign.max_uses_per_order = payload.max_uses_per_order
    campaign.starts_at = payload.starts_at
    campaign.ends_at = payload.ends_at


@router.get("", response_model=list[CampaignOut])
async def list_campaigns(identity: CampaignManager, db: DbSession) -> list[CampaignOut]:
    tenant_id = require_tenant(identity)
    campaigns = (
        (
            await db.execute(
                select(Campaign)
                .where(Campaign.tenant_id == tenant_id)
                .order_by(Campaign.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return [
        await _output(db, tenant_id=tenant_id, campaign=campaign)
        for campaign in campaigns
    ]


@router.post("", response_model=CampaignOut, status_code=status.HTTP_201_CREATED)
async def create_campaign(
    payload: CampaignUpsert, identity: CampaignManager, db: DbSession
) -> CampaignOut:
    tenant_id = require_tenant(identity)
    validate_definition(
        buy_product_id=payload.buy_product_id,
        buy_category_id=payload.buy_category_id,
        reward_kind=CampaignRewardKind(payload.reward_kind),
        reward_product_id=payload.reward_product_id,
        reward_category_id=payload.reward_category_id,
        reward_value=payload.reward_value,
    )
    await _validate_references(db, tenant_id=tenant_id, payload=payload)

    campaign = Campaign(tenant_id=tenant_id, reward_kind=CampaignRewardKind.FREE_ITEM)
    _assign(campaign, payload)
    db.add(campaign)
    await db.flush()
    for branch_id in set(payload.branch_ids):
        db.add(
            CampaignBranch(
                tenant_id=tenant_id, campaign_id=campaign.id, branch_id=branch_id
            )
        )
    await db.flush()
    add_audit_log(
        db,
        identity=identity,
        action="campaign.created",
        resource_type="campaign",
        resource_id=campaign.id,
        new_value={"name": campaign.name},
    )
    await db.commit()
    await db.refresh(campaign)
    return await _output(db, tenant_id=tenant_id, campaign=campaign)


@router.put("/{campaign_id}", response_model=CampaignOut)
async def update_campaign(
    campaign_id: UUID,
    payload: CampaignUpsert,
    identity: CampaignManager,
    db: DbSession,
) -> CampaignOut:
    tenant_id = require_tenant(identity)
    campaign = (
        await db.execute(
            select(Campaign)
            .where(Campaign.id == campaign_id, Campaign.tenant_id == tenant_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if campaign is None:
        raise DomainError("campaign_not_found", "Kampanya bulunamadı.", status_code=404)
    if (
        payload.expected_version is not None
        and payload.expected_version != campaign.version
    ):
        raise DomainError(
            "campaign_version_conflict",
            "Kampanya başka bir kullanıcı tarafından güncellendi; sayfayı yenileyin.",
            status_code=409,
        )
    validate_definition(
        buy_product_id=payload.buy_product_id,
        buy_category_id=payload.buy_category_id,
        reward_kind=CampaignRewardKind(payload.reward_kind),
        reward_product_id=payload.reward_product_id,
        reward_category_id=payload.reward_category_id,
        reward_value=payload.reward_value,
    )
    await _validate_references(db, tenant_id=tenant_id, payload=payload)

    _assign(campaign, payload)
    campaign.version += 1

    existing = {link.branch_id for link in campaign.campaign_branches}
    wanted = set(payload.branch_ids)
    for link in list(campaign.campaign_branches):
        if link.branch_id not in wanted:
            campaign.campaign_branches.remove(link)
    for branch_id in wanted - existing:
        db.add(
            CampaignBranch(
                tenant_id=tenant_id, campaign_id=campaign.id, branch_id=branch_id
            )
        )
    await db.flush()
    add_audit_log(
        db,
        identity=identity,
        action="campaign.updated",
        resource_type="campaign",
        resource_id=campaign.id,
        new_value={"name": campaign.name, "is_active": campaign.is_active},
    )
    await db.commit()
    await db.refresh(campaign)
    return await _output(db, tenant_id=tenant_id, campaign=campaign)


@router.delete("/{campaign_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_campaign(
    campaign_id: UUID, identity: CampaignManager, db: DbSession
) -> None:
    """Deactivate rather than delete: past applications must stay auditable."""
    tenant_id = require_tenant(identity)
    campaign = (
        await db.execute(
            select(Campaign).where(
                Campaign.id == campaign_id, Campaign.tenant_id == tenant_id
            )
        )
    ).scalar_one_or_none()
    if campaign is None:
        raise DomainError("campaign_not_found", "Kampanya bulunamadı.", status_code=404)
    campaign.is_active = False
    campaign.version += 1
    add_audit_log(
        db,
        identity=identity,
        action="campaign.deactivated",
        resource_type="campaign",
        resource_id=campaign.id,
    )
    await db.commit()


@router.post(
    "/orders/{order_id}/apply",
    response_model=CampaignApplyOut,
    status_code=status.HTTP_201_CREATED,
)
async def apply_to_order(
    order_id: UUID, identity: CampaignApplier, db: DbSession
) -> CampaignApplyOut:
    """Evaluate the basket and grant whatever it qualifies for."""
    tenant_id = require_tenant(identity)
    order = await load_order(db, tenant_id, order_id, lock=True)
    if not identity.can_access_branch(order.branch_id):
        raise DomainError(
            "branch_forbidden", "Bu şubeye erişiminiz yok.", status_code=403
        )
    outcome = await apply_campaigns_to_order(
        db,
        tenant_id=tenant_id,
        order=order,
        identity=identity,
        has_membership=order.loyalty_membership_id is not None,
    )
    if outcome.granted:
        add_audit_log(
            db,
            identity=identity,
            action="campaign.applied",
            resource_type="order",
            resource_id=order.id,
            branch_id=order.branch_id,
            new_value={
                "campaigns": [grant.campaign_name for grant in outcome.granted],
                "total": str(outcome.total_discount),
            },
        )
    await db.commit()
    await db.refresh(order)
    return CampaignApplyOut(
        order_id=order.id,
        granted=[
            CampaignGrantOut(
                campaign_id=grant.campaign_id,
                campaign_name=grant.campaign_name,
                order_item_id=grant.order_item_id,
                product_name=grant.product_name,
                amount=grant.amount,
            )
            for grant in outcome.granted
        ],
        total_discount=outcome.total_discount,
        order_total=order.total,
        skipped_members_only=outcome.skipped_members_only,
    )
