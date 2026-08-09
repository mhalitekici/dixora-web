from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Subscription, Tenant
from app.models.enums import TenantState
from app.security import utcnow

BLOCKING_TENANT_STATES = {
    TenantState.PAST_DUE,
    TenantState.SUSPENDED,
    TenantState.CANCELLED,
    TenantState.ARCHIVED,
}


async def enforce_trial_expiry(db: AsyncSession, tenant: Tenant) -> None:
    """Flip an expired trial to PAST_DUE so login/session checks start blocking it.

    There is no background job here: access control already loads the tenant
    on every login and every authenticated request, so checking the trial's
    subscription end date there — and persisting the transition the first
    time it's noticed — is enough to enforce it without extra infrastructure.
    Reactivation (state -> ACTIVE) is a deliberate, separate action a super
    admin takes once payment is received, so this never reverses itself.
    """
    if tenant.state != TenantState.TRIAL:
        return
    subscription = (
        await db.execute(select(Subscription).where(Subscription.tenant_id == tenant.id))
    ).scalar_one_or_none()
    if subscription is None or subscription.ends_at is None:
        return
    if subscription.ends_at <= utcnow():
        tenant.state = TenantState.PAST_DUE
        subscription.status = TenantState.PAST_DUE
        await db.commit()


def tenant_access_blocked(tenant: Tenant | None) -> bool:
    return tenant is None or not tenant.is_active or tenant.state in BLOCKING_TENANT_STATES
