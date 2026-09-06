from __future__ import annotations

import logging
import re
import unicodedata
from datetime import timedelta
from secrets import compare_digest
from typing import Annotated

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy import func, or_, select

from app.config import Settings
from app.dependencies import (
    DbSession,
    Identity,
    get_app_settings,
    require_branch,
    require_permissions,
    require_tenant,
)
from app.errors import DomainError
from app.models import (
    AuditLog,
    Branch,
    BusinessRegistrationVerification,
    Subscription,
    SubscriptionPlan,
    Tenant,
    TenantOnboarding,
    User,
)
from app.models.enums import TenantState
from app.rbac import ensure_role, ensure_tenant_role_presets
from app.schemas import (
    BusinessRegistrationConfirm,
    BusinessRegistrationOut,
    BusinessRegistrationRequest,
    BusinessRegistrationStartOut,
    OnboardingOut,
    OnboardingUpdate,
)
from app.security import as_utc, hash_password, utcnow
from app.services.audit import add_audit_log
from app.services.email import OutgoingEmail, get_email_sender
from app.services.email_templates import registration_code_email
from app.services.loyalty_enrollment import generate_verification_code, hash_code
from app.services.onboarding_setup import apply_onboarding
from app.services.rate_limit import get_rate_limiter, limiter_key

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/registrations", tags=["registrations"])

REGISTRATION_CODE_TTL_MINUTES = 20
VERIFICATION_LIMIT_PER_IP = 5
VERIFICATION_IP_WINDOW_SECONDS = 3600
VERIFICATION_LIMIT_PER_EMAIL = 3
VERIFICATION_EMAIL_WINDOW_SECONDS = 1800
MAX_REGISTRATION_CODE_ATTEMPTS = 5
OnboardingManager = Annotated[Identity, Depends(require_permissions("settings.manage"))]

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
    """Cap completed registrations per IP.

    Kept as a backstop on the provisioning step; the expensive part (sending
    verification email) is throttled separately in `_enforce_verification_limits`.
    """
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


async def _enforce_verification_limits(
    settings: Settings, *, ip_address: str | None, email: str
) -> None:
    """Throttle verification-email requests, not just completed signups.

    The previous limiter only counted `registration.created`, which `/start`
    never writes — so an attacker could trigger unlimited verification emails at
    any address, burning the mail quota and the sending domain's reputation.

    The email window is deliberately checked without revealing whether the
    address belongs to an existing account: the same 429 is returned either way.
    """
    limiter = get_rate_limiter(settings)
    checks = (
        (
            limiter_key("registration:ip", ip_address or "unknown"),
            VERIFICATION_LIMIT_PER_IP,
            VERIFICATION_IP_WINDOW_SECONDS,
        ),
        (
            limiter_key("registration:email", email),
            VERIFICATION_LIMIT_PER_EMAIL,
            VERIFICATION_EMAIL_WINDOW_SECONDS,
        ),
    )
    for key, limit, window in checks:
        result = await limiter.hit(key, limit=limit, window_seconds=window)
        if not result.allowed:
            raise DomainError(
                "registration_rate_limited",
                "Çok fazla doğrulama isteği gönderildi. "
                "Lütfen bir süre sonra tekrar deneyin.",
                status_code=429,
                details={"retry_after_seconds": result.retry_after_seconds},
            )


async def _provision_business(
    db: DbSession,
    request: Request,
    payload: BusinessRegistrationVerification,
) -> BusinessRegistrationOut:
    """Create the tenant, branch, owner and trial subscription."""
    ip_address = request.client.host if request.client else None

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
        phone=payload.phone,
        password_hash=payload.password_hash,
        marketing_consent=payload.marketing_consent,
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
            "terms_accepted": True,
            "contract_version": payload.contract_version,
            "privacy_notice_acknowledged": True,
            "privacy_notice_version": payload.privacy_notice_version,
            "marketing_consent": payload.marketing_consent,
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


@router.post(
    "/start",
    response_model=BusinessRegistrationStartOut,
    status_code=status.HTTP_201_CREATED,
)
async def start_registration(
    payload: BusinessRegistrationRequest,
    request: Request,
    db: DbSession,
    settings: Settings = Depends(get_app_settings),
) -> BusinessRegistrationStartOut:
    """Step 1: verify the owner's email before provisioning anything."""
    ip_address = request.client.host if request.client else None
    email = payload.email.lower()
    await _enforce_verification_limits(settings, ip_address=ip_address, email=email)
    # Usernames are unique per tenant, not globally, so one address can legitimately
    # exist on several businesses. scalar_one_or_none() raised MultipleResultsFound
    # on those and turned signup into a 500 — take the first match instead.
    taken = (
        await db.execute(
            select(User.id).where(func.lower(User.email) == email).limit(1)
        )
    ).scalars().first()
    if taken is not None:
        raise DomainError(
            "email_already_registered",
            "Bu e-posta ile zaten bir hesap var. Giriş yapmayı deneyin.",
            status_code=409,
        )

    code = generate_verification_code()
    verification = BusinessRegistrationVerification(
        business_name=payload.business_name,
        business_type=payload.business_type,
        owner_name=payload.owner_name,
        email=email,
        phone=payload.phone,
        # Hashed now so a pending signup never holds a plaintext password.
        password_hash=hash_password(payload.password),
        contract_version=payload.contract_version,
        privacy_notice_version=payload.privacy_notice_version,
        marketing_consent=payload.marketing_consent,
        code_hash=hash_code(code),
        ip_address=ip_address,
        expires_at=utcnow() + timedelta(minutes=REGISTRATION_CODE_TTL_MINUTES),
    )
    db.add(verification)
    await db.flush()

    sender = get_email_sender(settings)
    try:
        await sender.send(
            OutgoingEmail(
                to=email,
                subject="Dixora · E-posta doğrulama kodunuz",
                text_body=(
                    f"Merhaba {payload.owner_name},\n\n"
                    f"{payload.business_name} işletmenizi Dixora'da oluşturmak için "
                    f"doğrulama kodunuz:\n\n    {code}\n\n"
                    f"Kod {REGISTRATION_CODE_TTL_MINUTES} dakika geçerlidir.\n"
                    "Bu isteği siz yapmadıysanız bu e-postayı yok sayabilirsiniz."
                ),
                html_body=registration_code_email(
                    owner_name=payload.owner_name,
                    business_name=payload.business_name,
                    code=code,
                    ttl_minutes=REGISTRATION_CODE_TTL_MINUTES,
                ),
            )
        )
    except Exception:
        # A provider rejection or outage used to surface as a bare 500 reading
        # "beklenmedik bir hata". The signup is abandoned rather than committed:
        # a verification row whose code was never delivered is unusable, and the
        # applicant needs to know it was the address/mail step that failed.
        await db.rollback()
        logger.warning("registration.verification_email_failed", exc_info=True)
        raise DomainError(
            "verification_email_failed",
            "Doğrulama e-postası gönderilemedi. Lütfen e-posta adresinizi "
            "kontrol edip tekrar deneyin.",
            status_code=502,
        ) from None
    await db.commit()

    return BusinessRegistrationStartOut(
        verification_id=verification.id,
        email=email,
        expires_in_seconds=REGISTRATION_CODE_TTL_MINUTES * 60,
        development_code=code if sender.mode == "DEVELOPMENT" else None,
    )


@router.post(
    "/confirm",
    response_model=BusinessRegistrationOut,
    status_code=status.HTTP_201_CREATED,
)
async def confirm_registration(
    payload: BusinessRegistrationConfirm,
    request: Request,
    db: DbSession,
) -> BusinessRegistrationOut:
    """Step 2: check the emailed code, then create the business."""
    verification = (
        await db.execute(
            select(BusinessRegistrationVerification)
            .where(BusinessRegistrationVerification.id == payload.verification_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if verification is None:
        raise DomainError("verification_not_found", "Doğrulama bulunamadı.", status_code=404)
    if verification.consumed_at is not None:
        raise DomainError(
            "verification_used", "Bu doğrulama zaten kullanıldı.", status_code=409
        )
    if as_utc(verification.expires_at) <= utcnow():
        raise DomainError(
            "verification_expired", "Kodun süresi doldu; yeni kod isteyin.", status_code=409
        )
    if verification.attempts >= MAX_REGISTRATION_CODE_ATTEMPTS:
        raise DomainError(
            "verification_locked",
            "Çok fazla hatalı deneme; yeni kod isteyin.",
            status_code=429,
        )
    if not compare_digest(verification.code_hash, hash_code(payload.code.strip())):
        verification.attempts += 1
        await db.commit()
        raise DomainError(
            "verification_invalid_code",
            "Kod doğru değil.",
            status_code=400,
            details={
                "remaining_attempts": MAX_REGISTRATION_CODE_ATTEMPTS - verification.attempts
            },
        )

    verification.consumed_at = utcnow()
    return await _provision_business(db, request, verification)


@router.get("/onboarding", response_model=OnboardingOut)
async def get_onboarding(identity: OnboardingManager, db: DbSession) -> OnboardingOut:
    tenant_id = require_tenant(identity)
    record = (
        await db.execute(
            select(TenantOnboarding).where(TenantOnboarding.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if record is None:
        return OnboardingOut(
            offers_delivery=None,
            delivery_platforms=[],
            payment_methods=[],
            accepts_meal_cards=None,
            meal_card_providers=[],
            monthly_order_volume=None,
            table_count=None,
            heard_from=None,
            completed=False,
        )
    return OnboardingOut(
        offers_delivery=record.offers_delivery,
        delivery_platforms=list(record.delivery_platforms),
        payment_methods=list(record.payment_methods),
        accepts_meal_cards=record.accepts_meal_cards,
        meal_card_providers=list(record.meal_card_providers),
        monthly_order_volume=record.monthly_order_volume,
        table_count=record.table_count,
        heard_from=record.heard_from,
        completed=record.completed_at is not None,
    )


@router.put("/onboarding", response_model=OnboardingOut)
async def save_onboarding(
    payload: OnboardingUpdate,
    identity: OnboardingManager,
    db: DbSession,
) -> OnboardingOut:
    """Store the post-signup questionnaire answers.

    Answers are saved as the owner goes, so a half-finished questionnaire is not
    lost; `completed` is what marks the flow as done.
    """
    tenant_id = require_tenant(identity)
    record = (
        await db.execute(
            select(TenantOnboarding).where(TenantOnboarding.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if record is None:
        record = TenantOnboarding(tenant_id=tenant_id)
        db.add(record)

    record.offers_delivery = payload.offers_delivery
    record.delivery_platforms = payload.delivery_platforms
    record.payment_methods = payload.payment_methods
    record.accepts_meal_cards = payload.accepts_meal_cards
    record.meal_card_providers = (
        payload.meal_card_providers if payload.accepts_meal_cards else []
    )
    record.monthly_order_volume = payload.monthly_order_volume
    record.table_count = payload.table_count
    record.heard_from = payload.heard_from
    outcome = None
    if payload.completed and record.completed_at is None:
        record.completed_at = utcnow()
        # Answers only mean something if they change the product: turn the
        # table count into an actual floor plan on first completion.
        outcome = await apply_onboarding(
            db,
            tenant_id=tenant_id,
            branch_id=require_branch(identity),
            record=record,
        )

    add_audit_log(
        db,
        identity=identity,
        action="onboarding.saved",
        resource_type="tenant",
        resource_id=tenant_id,
        new_value={
            "offers_delivery": payload.offers_delivery,
            "delivery_platforms": payload.delivery_platforms,
            "completed": payload.completed,
            **({"applied": outcome.as_dict()} if outcome else {}),
        },
    )
    await db.commit()
    return OnboardingOut(
        offers_delivery=record.offers_delivery,
        delivery_platforms=list(record.delivery_platforms),
        payment_methods=list(record.payment_methods),
        accepts_meal_cards=record.accepts_meal_cards,
        meal_card_providers=list(record.meal_card_providers),
        monthly_order_volume=record.monthly_order_volume,
        table_count=record.table_count,
        heard_from=record.heard_from,
        completed=record.completed_at is not None,
        applied=outcome.as_dict() if outcome else None,
    )
