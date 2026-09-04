"""Charging an invoice against a stored card.

Sits between the billing ledger and whichever provider is configured. All the
decisions that matter — what counts as paid, what may be retried, what must
never be attempted twice — live here rather than in the adapter.
"""

from __future__ import annotations

import logging
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.errors import DomainError
from app.models import Invoice, PaymentAttempt, SavedCard, Tenant, User
from app.security import utcnow
from app.services.billing import FAILED, ISSUED, PAID, mark_failed, mark_paid
from app.services.payments.base import (
    Buyer,
    ChargeResult,
    PaymentProvider,
    PaymentProviderError,
)

logger = logging.getLogger(__name__)

# Reserved by RFC 2606 and RFC 6761: these can never receive mail, so a
# provider will always reject them. Seeded and demo data uses them freely.
UNROUTABLE_TLDS = (".test", ".example", ".invalid", ".localhost")


def _billing_email_is_usable(email: str) -> bool:
    candidate = email.strip().lower()
    local, _, domain = candidate.partition("@")
    if not local or "." not in domain:
        return False
    return not domain.endswith(UNROUTABLE_TLDS)

# Past this many declines the card is almost certainly not going to work, and
# retrying only annoys the bank's fraud systems. A human takes over.
MAX_ATTEMPTS = 4


def build_provider(settings: Settings) -> PaymentProvider | None:
    if settings.payment_provider == "iyzico":
        from app.services.payments.iyzico import IyzicoProvider

        return IyzicoProvider(settings)
    return None


async def default_card(db: AsyncSession, *, tenant_id: UUID) -> SavedCard | None:
    return (
        await db.execute(
            select(SavedCard)
            .where(
                SavedCard.tenant_id == tenant_id,
                SavedCard.is_active.is_(True),
            )
            .order_by(SavedCard.is_default.desc(), SavedCard.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def _buyer_for(db: AsyncSession, *, tenant: Tenant) -> Buyer:
    owner = (
        await db.execute(
            select(User)
            .where(User.tenant_id == tenant.id, User.is_active.is_(True))
            .order_by(User.created_at)
            .limit(1)
        )
    ).scalar_one_or_none()
    name = (owner.display_name if owner else tenant.name) or tenant.name
    first, _, last = name.partition(" ")
    return Buyer(
        id=str(tenant.id),
        name=first or tenant.name,
        surname=last or "-",
        email=(owner.email if owner and owner.email else f"{tenant.slug}@dixoratech.com"),
        address=tenant.name,
        city="Istanbul",
        # No request context in a scheduled run; the provider only needs a
        # syntactically valid address for its fraud checks.
        ip="127.0.0.1",
    )


async def charge_invoice(
    db: AsyncSession,
    *,
    settings: Settings,
    invoice: Invoice,
    provider: PaymentProvider | None = None,
) -> PaymentAttempt:
    """Attempt one collection for one invoice.

    Re-running for the same invoice and attempt number is refused by a unique
    constraint, so a retried job cannot charge the same bill twice.
    """
    if invoice.status == PAID:
        raise DomainError(
            "invoice_already_paid", "Fatura zaten ödendi.", status_code=409
        )
    if invoice.status not in {ISSUED, FAILED}:
        raise DomainError(
            "invoice_not_collectable",
            "Yalnızca kesilmiş veya başarısız faturalar tahsil edilebilir.",
            status_code=409,
        )
    if invoice.attempt_count >= MAX_ATTEMPTS:
        raise DomainError(
            "invoice_attempts_exhausted",
            "Bu fatura için deneme hakkı doldu; elle müdahale gerekiyor.",
            status_code=409,
        )

    engine = provider or build_provider(settings)
    if engine is None:
        raise DomainError(
            "payment_provider_not_configured",
            "Ödeme sağlayıcısı yapılandırılmamış.",
            status_code=503,
        )

    card = await default_card(db, tenant_id=invoice.tenant_id)
    if card is None:
        raise DomainError(
            "no_saved_card", "İşletmenin kayıtlı kartı yok.", status_code=409
        )

    tenant = await db.get(Tenant, invoice.tenant_id)
    if tenant is None:
        raise DomainError("tenant_not_found", "İşletme bulunamadı.", status_code=404)

    buyer = await _buyer_for(db, tenant=tenant)
    if not _billing_email_is_usable(buyer.email):
        # Providers reject an unusable address, which arrives looking exactly
        # like a declined card. Retrying will never fix it, so it must not
        # consume the retry budget or be reported to the business as a
        # payment failure.
        raise DomainError(
            "billing_email_invalid",
            "İşletmenin fatura e-posta adresi geçersiz; ödeme denenemedi.",
            status_code=409,
            details={"email": buyer.email},
        )

    # One key per invoice per attempt: a repeat of the same attempt is blocked,
    # while a deliberate retry after a decline is allowed through.
    key = f"invoice:{invoice.id}:attempt:{invoice.attempt_count + 1}"
    attempt = PaymentAttempt(
        tenant_id=invoice.tenant_id,
        invoice_id=invoice.id,
        saved_card_id=card.id,
        provider=engine.name,
        idempotency_key=key,
        status="PENDING",
    )
    db.add(attempt)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise DomainError(
            "payment_attempt_replayed",
            "Bu tahsilat denemesi zaten kaydedildi.",
            status_code=409,
        ) from None

    try:
        result: ChargeResult = await engine.charge_saved_card(
            card_token=card.card_token,
            card_user_key=card.card_user_key,
            amount=invoice.amount,
            currency=invoice.currency,
            reference=invoice.number,
            description=f"Dixora abonelik {invoice.period_start:%Y-%m}",
            buyer=buyer,
        )
    except PaymentProviderError as exc:
        # The provider was unreachable. The invoice is untouched and stays
        # collectable — an outage must not look like a customer's card failing.
        attempt.status = "ERROR"
        attempt.error_message = str(exc)[:400]
        await db.flush()
        logger.warning("payments.provider_unavailable invoice=%s", invoice.number)
        return attempt

    if result.succeeded:
        attempt.status = "SUCCEEDED"
        attempt.provider_payment_id = result.provider_payment_id
        card.last_used_at = utcnow()
        await mark_paid(db, invoice=invoice)
    else:
        attempt.status = "DECLINED"
        attempt.error_code = result.error_code
        attempt.error_message = (result.error_message or "")[:400]
        await mark_failed(db, invoice=invoice, reason=attempt.error_message or "declined")

    await db.flush()
    return attempt
