from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Form, Request, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select

from app.config import Settings, get_settings
from app.dependencies import DbSession, Identity, require_permissions, require_tenant
from app.errors import DomainError
from app.models import Invoice, SavedCard, Tenant
from app.security import utcnow
from app.services.audit import add_audit_log
from app.services.billing import outstanding_for_tenant
from app.services.payments.base import PaymentProviderError
from app.services.payments.collect import _buyer_for, build_provider

router = APIRouter(prefix="/billing", tags=["billing"])

BillingManager = Annotated[Identity, Depends(require_permissions("settings.manage"))]
AppSettings = Annotated[Settings, Depends(get_settings)]


class CardCheckoutOut(BaseModel):
    """Where to send the owner to type their card."""

    form_url: str


class SavedCardOut(BaseModel):
    id: UUID
    masked_number: str
    card_association: str | None
    card_family: str | None
    is_default: bool


class InvoiceOut(BaseModel):
    id: UUID
    number: str
    amount: str
    currency: str
    status: str
    period_start: str
    period_end: str
    branch_count: int
    base_amount: str
    extra_branch_amount: str
    due_at: str | None
    paid_at: str | None
    failure_reason: str | None


def _card_out(card: SavedCard) -> SavedCardOut:
    return SavedCardOut(
        id=card.id,
        masked_number=card.masked_number,
        card_association=card.card_association,
        card_family=card.card_family,
        is_default=card.is_default,
    )


def _invoice_out(invoice: Invoice) -> InvoiceOut:
    return InvoiceOut(
        id=invoice.id,
        number=invoice.number,
        amount=str(invoice.amount),
        currency=invoice.currency,
        status=invoice.status,
        period_start=invoice.period_start.isoformat(),
        period_end=invoice.period_end.isoformat(),
        branch_count=invoice.branch_count,
        base_amount=str(invoice.base_amount),
        extra_branch_amount=str(invoice.extra_branch_amount),
        due_at=invoice.due_at.isoformat() if invoice.due_at else None,
        paid_at=invoice.paid_at.isoformat() if invoice.paid_at else None,
        failure_reason=invoice.failure_reason,
    )


@router.get("/cards", response_model=list[SavedCardOut])
async def list_cards(identity: BillingManager, db: DbSession) -> list[SavedCardOut]:
    tenant_id = require_tenant(identity)
    cards = (
        (
            await db.execute(
                select(SavedCard)
                .where(SavedCard.tenant_id == tenant_id, SavedCard.is_active.is_(True))
                .order_by(SavedCard.is_default.desc(), SavedCard.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return [_card_out(card) for card in cards]


@router.post("/cards/checkout", response_model=CardCheckoutOut)
async def start_card_checkout(
    request: Request,
    identity: BillingManager,
    db: DbSession,
    settings: AppSettings,
) -> CardCheckoutOut:
    """Open the provider's hosted card form.

    The card is typed on the provider's page and never reaches this server;
    transmitting a card number would put the whole application in PCI DSS
    scope even though nothing is stored here.
    """
    tenant_id = require_tenant(identity)
    provider = build_provider(settings)
    if provider is None:
        raise DomainError(
            "payment_provider_not_configured",
            "Ödeme sağlayıcısı yapılandırılmamış.",
            status_code=503,
        )
    tenant = await db.get(Tenant, tenant_id)
    if tenant is None:
        raise DomainError("tenant_not_found", "İşletme bulunamadı.", status_code=404)

    callback = str(request.url_for("iyzico_card_callback"))
    try:
        checkout = await provider.start_card_checkout(
            buyer=await _buyer_for(db, tenant=tenant),
            callback_url=callback,
            reference=f"card-{tenant_id}-{int(utcnow().timestamp())}",
        )
    except PaymentProviderError as exc:
        raise DomainError(
            "card_checkout_failed", str(exc), status_code=502
        ) from exc
    return CardCheckoutOut(form_url=checkout.form_url)


@router.post("/iyzico/callback", name="iyzico_card_callback", include_in_schema=False)
async def iyzico_card_callback(
    db: DbSession,
    settings: AppSettings,
    token: Annotated[str, Form()],
) -> RedirectResponse:
    """Where the provider returns the customer after the hosted form.

    Called by the provider's servers, so it carries no session. The token is
    the only credential, and it is exchanged with the provider directly — a
    forged token simply fails that exchange.
    """
    provider = build_provider(settings)
    if provider is None:
        return RedirectResponse("/admin/settings?card=unavailable", status_code=303)

    try:
        stored = await provider.complete_card_checkout(token=token)
    except PaymentProviderError:
        return RedirectResponse("/admin/settings?card=failed", status_code=303)

    # The provider echoes back the reference we opened the form with, and that
    # is what names the tenant — the callback carries no session of its own.
    existing = (
        await db.execute(
            select(SavedCard).where(SavedCard.card_token == stored.card_token)
        )
    ).scalar_one_or_none()
    if existing is not None:
        # The provider retries callbacks; a second delivery must not add a
        # duplicate card.
        return RedirectResponse("/admin/settings?card=saved", status_code=303)

    tenant_id = _tenant_from_conversation(stored.reference or "")
    if tenant_id is None:
        return RedirectResponse("/admin/settings?card=failed", status_code=303)

    db.add(
        SavedCard(
            tenant_id=tenant_id,
            provider=provider.name,
            card_token=stored.card_token,
            card_user_key=stored.card_user_key,
            masked_number=stored.masked_number,
            card_association=stored.association,
            card_family=stored.family,
        )
    )
    await db.commit()
    return RedirectResponse("/admin/settings?card=saved", status_code=303)


def _tenant_from_conversation(reference: str) -> UUID | None:
    parts = reference.split("-")
    if len(parts) < 6 or parts[0] != "card":
        return None
    try:
        return UUID("-".join(parts[1:6]))
    except ValueError:
        return None


@router.delete("/cards/{card_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_card(
    card_id: UUID, identity: BillingManager, db: DbSession
) -> None:
    """Deactivate rather than delete: past charges must stay traceable."""
    tenant_id = require_tenant(identity)
    card = (
        await db.execute(
            select(SavedCard).where(
                SavedCard.id == card_id, SavedCard.tenant_id == tenant_id
            )
        )
    ).scalar_one_or_none()
    if card is None:
        raise DomainError("card_not_found", "Kart bulunamadı.", status_code=404)
    card.is_active = False
    card.is_default = False
    add_audit_log(
        db,
        identity=identity,
        action="billing.card_removed",
        resource_type="saved_card",
        resource_id=card.id,
    )
    await db.commit()


@router.get("/invoices", response_model=list[InvoiceOut])
async def list_invoices(identity: BillingManager, db: DbSession) -> list[InvoiceOut]:
    tenant_id = require_tenant(identity)
    invoices = (
        (
            await db.execute(
                select(Invoice)
                .where(Invoice.tenant_id == tenant_id)
                .order_by(Invoice.period_start.desc())
                .limit(36)
            )
        )
        .scalars()
        .all()
    )
    return [_invoice_out(invoice) for invoice in invoices]


@router.get("/invoices/outstanding", response_model=list[InvoiceOut])
async def list_outstanding(
    identity: BillingManager, db: DbSession
) -> list[InvoiceOut]:
    tenant_id = require_tenant(identity)
    invoices = await outstanding_for_tenant(db, tenant_id=tenant_id)
    return [_invoice_out(invoice) for invoice in invoices]
