from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy import select

from app.dependencies import DbSession, Identity, require_permissions, require_tenant
from app.errors import DomainError
from app.models import (
    Subscription,
    SubscriptionFeature,
    SubscriptionPlan,
    Tenant,
)
from app.schemas import (
    PlatformSubscriptionOut,
    SubscriptionAssign,
    SubscriptionOut,
    SubscriptionPlanCreate,
    SubscriptionPlanOut,
    TenantOut,
)
from app.services.features import tenant_feature_enabled

router = APIRouter(prefix="/subscriptions", tags=["subscriptions"])
PlatformAdmin = Annotated[Identity, Depends(require_permissions("platform.businesses.manage"))]
SettingsReader = Annotated[Identity, Depends(require_permissions("settings.manage"))]


@router.get("/plans", response_model=list[SubscriptionPlanOut])
async def list_plans(_: SettingsReader, db: DbSession) -> list[SubscriptionPlanOut]:
    rows = (
        (
            await db.execute(
                select(SubscriptionPlan)
                .where(SubscriptionPlan.is_active.is_(True))
                .order_by(SubscriptionPlan.monthly_price)
            )
        )
        .scalars()
        .all()
    )
    return [SubscriptionPlanOut.model_validate(plan) for plan in rows]


@router.get("/portfolio", response_model=list[PlatformSubscriptionOut])
async def subscription_portfolio(
    _: PlatformAdmin,
    db: DbSession,
) -> list[PlatformSubscriptionOut]:
    rows = (
        await db.execute(
            select(Subscription, Tenant, SubscriptionPlan)
            .join(Tenant, Tenant.id == Subscription.tenant_id)
            .join(SubscriptionPlan, SubscriptionPlan.id == Subscription.plan_id)
            .order_by(Tenant.name)
        )
    ).all()
    return [
        PlatformSubscriptionOut(
            business=TenantOut.model_validate(tenant),
            plan=SubscriptionPlanOut.model_validate(plan),
            status=subscription.status,
            starts_at=subscription.starts_at,
            ends_at=subscription.ends_at,
        )
        for subscription, tenant, plan in rows
    ]


@router.post(
    "/plans",
    response_model=SubscriptionPlanOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_plan(
    payload: SubscriptionPlanCreate,
    _: PlatformAdmin,
    db: DbSession,
) -> SubscriptionPlanOut:
    plan = SubscriptionPlan(
        code=payload.code,
        name=payload.name,
        monthly_price=payload.monthly_price,
        currency=payload.currency,
        max_branches=payload.max_branches,
        max_users=payload.max_users,
    )
    db.add(plan)
    await db.flush()
    for code, enabled in payload.features.items():
        db.add(
            SubscriptionFeature(
                plan_id=plan.id,
                feature_code=code,
                is_enabled=enabled,
            )
        )
    await db.commit()
    return SubscriptionPlanOut.model_validate(plan)


@router.get("/current", response_model=SubscriptionOut)
async def current_subscription(
    identity: SettingsReader,
    db: DbSession,
) -> SubscriptionOut:
    subscription = (
        await db.execute(
            select(Subscription).where(Subscription.tenant_id == require_tenant(identity))
        )
    ).scalar_one_or_none()
    if subscription is None:
        raise DomainError("subscription_not_found", "Subscription not found", status_code=404)
    return SubscriptionOut.model_validate(subscription)


@router.get("/features/{feature_code}")
async def feature_status(
    feature_code: str,
    identity: SettingsReader,
    db: DbSession,
) -> dict[str, object]:
    tenant_id = require_tenant(identity)
    return {
        "feature": feature_code,
        "enabled": await tenant_feature_enabled(db, tenant_id, feature_code),
    }


@router.put("/assign", response_model=SubscriptionOut)
async def assign_subscription(
    payload: SubscriptionAssign,
    _: PlatformAdmin,
    db: DbSession,
) -> SubscriptionOut:
    tenant = await db.get(Tenant, payload.tenant_id)
    plan = await db.get(SubscriptionPlan, payload.plan_id)
    if tenant is None or plan is None:
        raise DomainError(
            "subscription_reference_not_found", "Tenant or plan not found", status_code=404
        )
    subscription = (
        await db.execute(select(Subscription).where(Subscription.tenant_id == tenant.id))
    ).scalar_one_or_none()
    if subscription is None:
        subscription = Subscription(**payload.model_dump())
        db.add(subscription)
    else:
        for key, value in payload.model_dump().items():
            setattr(subscription, key, value)
    tenant.state = payload.status
    await db.commit()
    await db.refresh(subscription)
    return SubscriptionOut.model_validate(subscription)
