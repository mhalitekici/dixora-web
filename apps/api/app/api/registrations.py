from __future__ import annotations

import re
import unicodedata
from datetime import timedelta

from fastapi import APIRouter, Request, status
from sqlalchemy import func, or_, select

from app.dependencies import DbSession
from app.errors import DomainError
from app.models import AuditLog, Branch, Subscription, SubscriptionPlan, Tenant, User
from app.models.enums import TenantState
from app.rbac import ensure_role, ensure_tenant_role_presets
from app.schemas import BusinessRegistrationOut, BusinessRegistrationRequest
from app.security import hash_password, utcnow
from app.services.audit import add_audit_log

router = APIRouter(prefix="/registrations", tags=["registrations"])

STANDARD_PLAN_CODE = "STANDARD"
TRIAL_DAYS = 30
REGISTRATION_LIMIT_PER_HOUR = 3

_TURKISH_CHARACTERS = str.maketrans(
    {
        "ç": "c",
        "Ç": "c",
        "ğ": "g",
        "Ğ": "g",
        "ı": "i",
        "İ": "i",
        "ö": "o",
        "Ö": "o",
        "ş": "s",
        "Ş": "s",
        "ü": "u",
        "Ü": "u",
    }
)


def _slugify(value: str) -> str:
    translated = value.translate(_TURKISH_CHARACTERS)
    ascii_value = unicodedata.normalize("NFKD", translated).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_value.lower()).strip("-")
    return (slug or "isletme")[:80].rstrip("-")


async def _available_business_slug(db: DbSession, business_name: str) -> str:
    base = _slugify(business_name)
    existing = set(
        (
            await db.execute(
                select(Tenant.slug).where(
                    or_(Tenant.slug == base, Tenant.slug.like(f"{base}-%"))
                )
            )
        )
        .scalars()
        .all()
    )
    if base not in existing:
        return base
    for suffix in range(2, 10_000):
        candidate = f"{base[: 79 - len(str(suffix))]}-{suffix}"
        if candidate not in existing:
            return candidate
    raise DomainError(
        "business_slug_unavailable",
        "Bu işletme adıyla yeni bir kayıt oluşturulamıyor.",
        status_code=409,
    )


async def _enforce_registration_rate_limit(db: DbSession, ip_address: str | None) -> None:
    window_started = utcnow() - timedelta(hours=1)
    count = (
        await db.execute(
            select(func.count(AuditLog.id)).where(
                AuditLog.action == "registration.created",
                AuditLog.ip_address == ip_address,
                AuditLog.created_at >= window_started,
            )
        )
    ).scalar_one()
    if count >= REGISTRATION_LIMIT_PER_HOUR:
        raise DomainError(
            "registration_rate_limited",
            "Çok fazla kayıt oluşturuldu. Lütfen daha sonra tekrar deneyin.",
            status_code=429,
            details={"retry_after_seconds": 3600},
        )


@router.post("", response_model=BusinessRegistrationOut, status_code=status.HTTP_201_CREATED)
async def register_business(
    payload: BusinessRegistrationRequest,
    request: Request,
    db: DbSession,
) -> BusinessRegistrationOut:
    ip_address = request.client.host if request.client else None
    await _enforce_registration_rate_limit(db, ip_address)

    plan = (
        await db.execute(
            select(SubscriptionPlan).where(
                SubscriptionPlan.code == STANDARD_PLAN_CODE,
                SubscriptionPlan.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if plan is None:
        raise DomainError(
            "registration_unavailable",
            "İşletme kaydı şu anda kullanılamıyor.",
            status_code=503,
        )

    business_slug = await _available_business_slug(db, payload.business_name)
    owner_email = payload.email.lower()
    trial_started_at = utcnow()
    trial_ends_at = trial_started_at + timedelta(days=TRIAL_DAYS)

    tenant = Tenant(
        name=payload.business_name,
        slug=business_slug,
        business_type=payload.business_type,
        state=TenantState.TRIAL,
        is_active=True,
    )
    db.add(tenant)
    await db.flush()

    branch = Branch(
        tenant_id=tenant.id,
        name="Merkez Şube",
        slug="merkez",
        timezone="Europe/Istanbul",
        is_active=True,
    )
    db.add(branch)
    owner_role = await ensure_role(db, tenant_id=tenant.id, code="BUSINESS_OWNER")
    await ensure_tenant_role_presets(db, tenant.id)
    owner = User(
        tenant_id=tenant.id,
        branch_id=None,
        role_id=owner_role.id,
        username=owner_email,
        email=owner_email,
        display_name=payload.owner_name,
        password_hash=hash_password(payload.password),
    )
    db.add(owner)
    db.add(
        Subscription(
            tenant_id=tenant.id,
            plan_id=plan.id,
            status=TenantState.TRIAL,
            starts_at=trial_started_at,
            ends_at=trial_ends_at,
        )
    )
    add_audit_log(
        db,
        identity=None,
        tenant_id=tenant.id,
        branch_id=branch.id,
        action="registration.created",
        resource_type="tenant",
        resource_id=tenant.id,
        new_value={
            "name": tenant.name,
            "slug": tenant.slug,
            "business_type": tenant.business_type,
            "plan": STANDARD_PLAN_CODE,
            "trial_days": TRIAL_DAYS,
            "terms_accepted": payload.terms_accepted,
            "contract_version": payload.contract_version,
        },
        reason="public_self_service",
        ip_address=ip_address,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()

    return BusinessRegistrationOut(
        tenant_id=tenant.id,
        business_name=tenant.name,
        business_slug=tenant.slug,
        branch_slug=branch.slug,
        owner_username=owner.username,
        trial_ends_at=trial_ends_at,
    )
