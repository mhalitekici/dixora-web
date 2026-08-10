from __future__ import annotations

import hashlib
import logging
import secrets
from dataclasses import dataclass
from datetime import date, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.errors import DomainError
from app.models import (
    LoyaltyCustomer,
    LoyaltyEmailVerification,
    LoyaltyMembership,
    LoyaltyProgram,
    Tenant,
)
from app.security import utcnow
from app.services.email import EmailAttachment, OutgoingEmail, get_email_sender
from app.services.email_templates import (
    membership_card_email,
    verification_code_email,
)
from app.services.membership_card import safe_render_membership_card

logger = logging.getLogger(__name__)

# Codes the customer reads aloud to a cashier: digits only, so there is no
# "was that an O or a zero" over a noisy counter.
CODE_LENGTH = 6
CODE_TTL_MINUTES = 15
MAX_CODE_ATTEMPTS = 5

# Member card codes are shown on a phone screen and typed by staff, so the
# alphabet excludes characters that look alike (0/O, 1/I/L).
CARD_ALPHABET = "ACDEFGHJKMNPQRTUVWXY2346789"
CARD_DIGITS = 4


def normalize_email(value: str) -> str:
    return value.strip().lower()


def hash_code(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def generate_verification_code() -> str:
    return "".join(secrets.choice("0123456789") for _ in range(CODE_LENGTH))


def business_code_prefix(tenant_name: str) -> str:
    """Three letters derived from the business name, e.g. "Dixora" -> "DXR"."""
    letters = [ch for ch in tenant_name.upper() if ch.isalpha() and ch.isascii()]
    if len(letters) >= 3:
        # First letter plus the next two consonants reads better than the first
        # three letters ("DXR" rather than "DIX").
        consonants = [ch for ch in letters[1:] if ch not in "AEIOU"]
        picked = [letters[0], *consonants[:2]]
        if len(picked) < 3:
            picked = letters[:3]
        return "".join(picked[:3])
    return (("".join(letters) or "DXR") + "DXR")[:3]


def generate_card_code(prefix: str) -> str:
    body = "".join(secrets.choice(CARD_ALPHABET) for _ in range(CARD_DIGITS))
    return f"{prefix}{body}"


@dataclass(frozen=True, slots=True)
class StartedEnrollment:
    verification_id: UUID
    email: str
    expires_in_seconds: int
    # Only populated by the development email sender, so a local operator can
    # complete the flow without a mailbox. Never set in production.
    development_code: str | None


async def _unique_card_code(db: AsyncSession, tenant_id: UUID, prefix: str) -> str:
    for _ in range(12):
        candidate = generate_card_code(prefix)
        clash = (
            await db.execute(
                select(LoyaltyMembership.id).where(
                    LoyaltyMembership.tenant_id == tenant_id,
                    LoyaltyMembership.lookup_code == candidate,
                )
            )
        ).scalar_one_or_none()
        if clash is None:
            return candidate
    raise DomainError(
        "loyalty_card_code_unavailable",
        "Could not allocate a membership code; please try again",
        status_code=503,
    )


async def start_email_enrollment(
    db: AsyncSession,
    settings: Settings,
    *,
    tenant: Tenant,
    branch_id: UUID,
    program: LoyaltyProgram,
    email: str,
    first_name: str,
    last_name: str,
    birth_date: date | None,
    started_by_user_id: UUID | None,
) -> StartedEnrollment:
    """Email a verification code to the customer standing at the till."""
    normalized = normalize_email(email)

    existing = (
        await db.execute(
            select(LoyaltyCustomer).where(
                LoyaltyCustomer.tenant_id == tenant.id,
                LoyaltyCustomer.email_normalized == normalized,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        membership = (
            await db.execute(
                select(LoyaltyMembership).where(
                    LoyaltyMembership.tenant_id == tenant.id,
                    LoyaltyMembership.program_id == program.id,
                    LoyaltyMembership.customer_id == existing.id,
                    LoyaltyMembership.is_active.is_(True),
                )
            )
        ).scalar_one_or_none()
        if membership is not None:
            raise DomainError(
                "loyalty_already_enrolled",
                "Bu e-posta ile zaten bir üyelik var",
                status_code=409,
                details={"member_code": membership.lookup_code},
            )

    code = generate_verification_code()
    expires_at = utcnow() + timedelta(minutes=CODE_TTL_MINUTES)
    verification = LoyaltyEmailVerification(
        tenant_id=tenant.id,
        branch_id=branch_id,
        program_id=program.id,
        started_by_user_id=started_by_user_id,
        email_normalized=normalized,
        first_name=first_name.strip(),
        last_name=last_name.strip(),
        birth_date=birth_date,
        code_hash=hash_code(code),
        expires_at=expires_at,
    )
    db.add(verification)
    await db.flush()

    sender = get_email_sender(settings)
    try:
        await sender.send(
            OutgoingEmail(
                to=normalized,
                subject=f"{tenant.name} · Üyelik doğrulama kodunuz",
                text_body=(
                    f"Merhaba {first_name},\n\n"
                    f"{tenant.name} sadakat programına kaydınızı tamamlamak için "
                    f"aşağıdaki kodu kasiyere okuyun:\n\n"
                    f"    {code}\n\n"
                    f"Kod {CODE_TTL_MINUTES} dakika geçerlidir."
                ),
                html_body=verification_code_email(
                    greeting_name=first_name,
                    business_name=tenant.name,
                    code=code,
                    ttl_minutes=CODE_TTL_MINUTES,
                ),
            )
        )
    except Exception as exc:
        # Without the code the customer cannot finish, so this has to fail — but
        # with something the cashier can act on rather than an opaque 500.
        logger.warning("loyalty.verification_email_failed", exc_info=True)
        raise DomainError(
            "loyalty_email_send_failed",
            "Doğrulama e-postası gönderilemedi. E-posta adresini kontrol edin "
            "veya yöneticinize bildirin.",
            status_code=502,
        ) from exc

    return StartedEnrollment(
        verification_id=verification.id,
        email=normalized,
        expires_in_seconds=CODE_TTL_MINUTES * 60,
        development_code=code if sender.mode == "DEVELOPMENT" else None,
    )


async def confirm_email_enrollment(
    db: AsyncSession,
    settings: Settings,
    *,
    tenant: Tenant,
    verification_id: UUID,
    code: str,
) -> tuple[LoyaltyCustomer, LoyaltyEmailVerification]:
    """Check the code the customer read out, and materialise the customer."""
    verification = (
        await db.execute(
            select(LoyaltyEmailVerification)
            .where(
                LoyaltyEmailVerification.id == verification_id,
                LoyaltyEmailVerification.tenant_id == tenant.id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if verification is None:
        raise DomainError(
            "loyalty_verification_not_found", "Doğrulama bulunamadı", status_code=404
        )
    if verification.consumed_at is not None:
        raise DomainError(
            "loyalty_verification_used", "Bu doğrulama zaten kullanıldı", status_code=409
        )
    if verification.expires_at.replace(tzinfo=verification.expires_at.tzinfo) <= utcnow():
        raise DomainError(
            "loyalty_verification_expired",
            "Kodun süresi doldu; yeni kod gönderin",
            status_code=409,
        )
    if verification.attempts >= MAX_CODE_ATTEMPTS:
        raise DomainError(
            "loyalty_verification_locked",
            "Çok fazla hatalı deneme; yeni kod gönderin",
            status_code=429,
        )

    if not secrets.compare_digest(verification.code_hash, hash_code(code.strip())):
        verification.attempts += 1
        await db.flush()
        raise DomainError(
            "loyalty_verification_invalid_code",
            "Kod doğru değil",
            status_code=400,
            details={"remaining_attempts": MAX_CODE_ATTEMPTS - verification.attempts},
        )

    verification.consumed_at = utcnow()

    customer = (
        await db.execute(
            select(LoyaltyCustomer).where(
                LoyaltyCustomer.tenant_id == tenant.id,
                LoyaltyCustomer.email_normalized == verification.email_normalized,
            )
        )
    ).scalar_one_or_none()
    if customer is None:
        customer = LoyaltyCustomer(
            tenant_id=tenant.id,
            email_normalized=verification.email_normalized,
            first_name=verification.first_name,
            last_name=verification.last_name,
            birth_date=verification.birth_date,
            is_active=True,
        )
        db.add(customer)
        await db.flush()
    else:
        customer.first_name = verification.first_name
        customer.last_name = verification.last_name
        customer.birth_date = verification.birth_date
        customer.is_active = True

    return customer, verification


async def allocate_member_code(db: AsyncSession, tenant: Tenant) -> str:
    return await _unique_card_code(db, tenant.id, business_code_prefix(tenant.name))


async def send_membership_card(
    settings: Settings,
    *,
    tenant: Tenant,
    program: LoyaltyProgram,
    customer: LoyaltyCustomer,
    member_code: str,
    progress_target: int,
) -> None:
    """Email the customer the card they will show on their next visit."""
    if not customer.email_normalized:
        return
    sender = get_email_sender(settings)
    card_png = safe_render_membership_card(
        business_name=tenant.name,
        program_name=program.name,
        member_name=customer.display_name,
        member_code=member_code,
        progress_target=progress_target,
    )
    attachments: tuple[EmailAttachment, ...] = ()
    card_cid: str | None = None
    if card_png is not None:
        card_cid = "dixora-membership-card"
        attachments = (
            EmailAttachment(
                filename=f"{member_code}-uyelik-karti.png",
                content=card_png,
                content_type="image/png",
                content_id=card_cid,
            ),
        )

    await sender.send(
        OutgoingEmail(
            to=customer.email_normalized,
            subject=f"{tenant.name} · {program.name} üyelik kartınız",
            text_body=(
                f"Merhaba {customer.first_name or ''},\n\n"
                f"{tenant.name} · {program.name} programına hoş geldiniz.\n\n"
                f"Üyelik kodunuz: {member_code}\n\n"
                "Bir sonraki ziyaretinizde bu kodu kasiyere gösterin; "
                f"her uygun ziyarette ilerlemeniz artar ve {progress_target} "
                "ziyarette ödülünüzü kazanırsınız."
            ),
            html_body=membership_card_email(
                greeting_name=customer.first_name or "",
                business_name=tenant.name,
                program_name=program.name,
                member_code=member_code,
                progress_target=progress_target,
                card_cid=card_cid,
            ),
            attachments=attachments,
        )
    )
