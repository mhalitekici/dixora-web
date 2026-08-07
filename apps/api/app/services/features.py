from __future__ import annotations

from datetime import UTC
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Subscription,
    SubscriptionFeature,
    TenantFeatureOverride,
)
from app.security import utcnow


async def tenant_feature_enabled(
    db: AsyncSession,
    tenant_id: UUID,
    feature_code: str,
) -> bool:
    override = (
        await db.execute(
            select(TenantFeatureOverride).where(
                TenantFeatureOverride.tenant_id == tenant_id,
                TenantFeatureOverride.feature_code == feature_code,
            )
        )
    ).scalar_one_or_none()
    if override is not None:
        expires_at = override.expires_at
        if (
            expires_at is None
            or (expires_at.replace(tzinfo=UTC) if expires_at.tzinfo is None else expires_at)
            > utcnow()
        ):
            return override.is_enabled
    feature = (
        await db.execute(
            select(SubscriptionFeature)
            .join(Subscription, Subscription.plan_id == SubscriptionFeature.plan_id)
            .where(
                Subscription.tenant_id == tenant_id,
                SubscriptionFeature.feature_code == feature_code,
                SubscriptionFeature.is_enabled.is_(True),
            )
        )
    ).scalar_one_or_none()
    return feature is not None
