"""Collecting an invoice from a stored card.

Runs against a stub provider on purpose: these tests are about what the system
decides — what may be charged, what may be retried, what must never be charged
twice — not about whether iyzico's servers are up. The adapter's own request and
response shapes were confirmed separately against their sandbox.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.errors import DomainError
from app.models import (
    Invoice,
    PaymentAttempt,
    SavedCard,
    Subscription,
    SubscriptionPlan,
    User,
)
from app.models.enums import TenantState
from app.services.billing import FAILED, ISSUED, PAID, generate_invoices
from app.services.payments.base import Buyer, ChargeResult, PaymentProviderError
from app.services.payments.collect import MAX_ATTEMPTS, charge_invoice
from tests.conftest import ApiContext


class StubProvider:
    """Answers however the test needs, and records what it was asked."""

    name = "STUB"

    def __init__(self, *, outcome: str = "success") -> None:
        self.outcome = outcome
        self.calls: list[dict] = []

    async def store_card(self, **kwargs):  # pragma: no cover - unused here
        raise NotImplementedError

    async def charge_saved_card(self, **kwargs) -> ChargeResult:
        self.calls.append(kwargs)
        if self.outcome == "unavailable":
            raise PaymentProviderError("connection reset")
        if self.outcome == "declined":
            return ChargeResult(
                succeeded=False,
                provider_payment_id=None,
                error_code="10051",
                error_message="Yetersiz bakiye",
            )
        return ChargeResult(succeeded=True, provider_payment_id="pay-1")


async def _billable_invoice(api: ApiContext, *, email: str | None = None) -> Invoice:
    async with api.database.session_factory() as db:
        subscription = (await db.execute(select(Subscription))).scalars().first()
        assert subscription is not None

        # Seeded users sit on a reserved .test domain, which collection refuses
        # before it ever reaches the provider. Must be the tenant's own first
        # user — that is the one the buyer is built from, not the superadmin.
        owner = (
            await db.execute(
                select(User)
                .where(
                    User.tenant_id == subscription.tenant_id,
                    User.is_active.is_(True),
                )
                .order_by(User.created_at)
                .limit(1)
            )
        ).scalar_one()
        owner.email = email or "muhasebe@dixoratech.com"
        standard = (
            await db.execute(
                select(SubscriptionPlan).where(SubscriptionPlan.code == "STANDARD")
            )
        ).scalar_one()
        subscription.plan_id = standard.id
        subscription.status = TenantState.ACTIVE
        await db.commit()

        invoice = (await generate_invoices(db, on=date(2026, 8, 13)))[0]
        db.add(
            SavedCard(
                tenant_id=invoice.tenant_id,
                provider="STUB",
                card_token="tok_1",
                card_user_key="usr_1",
                masked_number="**** **** **** 0008",
                card_association="MASTER_CARD",
            )
        )
        await db.commit()
        return invoice


async def test_a_successful_charge_settles_the_invoice(api: ApiContext) -> None:
    invoice = await _billable_invoice(api)
    provider = StubProvider()

    async with api.database.session_factory() as db:
        stored = await db.get(Invoice, invoice.id)
        assert stored is not None
        attempt = await charge_invoice(
            db, settings=api.settings, invoice=stored, provider=provider
        )
        await db.commit()

        assert attempt.status == "SUCCEEDED"
        assert attempt.provider_payment_id == "pay-1"
        assert stored.status == PAID
        assert stored.paid_at is not None

    # The provider was asked for the invoice's own amount and reference.
    assert provider.calls[0]["amount"] == invoice.amount
    assert provider.calls[0]["reference"] == invoice.number


async def test_a_decline_leaves_the_invoice_collectable_and_says_why(
    api: ApiContext,
) -> None:
    invoice = await _billable_invoice(api)

    async with api.database.session_factory() as db:
        stored = await db.get(Invoice, invoice.id)
        assert stored is not None
        attempt = await charge_invoice(
            db,
            settings=api.settings,
            invoice=stored,
            provider=StubProvider(outcome="declined"),
        )
        await db.commit()

        assert attempt.status == "DECLINED"
        assert attempt.error_code == "10051"
        # Still owed, and the reason is on the invoice for the dunning email.
        assert stored.status == FAILED
        assert stored.failure_reason == "Yetersiz bakiye"
        assert stored.attempt_count == 1


async def test_a_provider_outage_is_not_treated_as_a_failed_card(
    api: ApiContext,
) -> None:
    """An outage must not consume the customer's retry budget."""
    invoice = await _billable_invoice(api)

    async with api.database.session_factory() as db:
        stored = await db.get(Invoice, invoice.id)
        assert stored is not None
        attempt = await charge_invoice(
            db,
            settings=api.settings,
            invoice=stored,
            provider=StubProvider(outcome="unavailable"),
        )
        await db.commit()

        assert attempt.status == "ERROR"
        # Untouched: still issued, and no decline counted against it.
        assert stored.status == ISSUED
        assert stored.attempt_count == 0


async def test_a_paid_invoice_is_never_charged_again(api: ApiContext) -> None:
    invoice = await _billable_invoice(api)
    provider = StubProvider()

    async with api.database.session_factory() as db:
        stored = await db.get(Invoice, invoice.id)
        assert stored is not None
        await charge_invoice(
            db, settings=api.settings, invoice=stored, provider=provider
        )
        await db.commit()

        with pytest.raises(DomainError) as excinfo:
            await charge_invoice(
                db, settings=api.settings, invoice=stored, provider=provider
            )
        assert excinfo.value.code == "invoice_already_paid"

    # The card was touched exactly once.
    assert len(provider.calls) == 1


async def test_retrying_the_same_attempt_is_refused(api: ApiContext) -> None:
    """Two workers picking up the same invoice must not both charge it."""
    invoice = await _billable_invoice(api)

    async with api.database.session_factory() as db:
        stored = await db.get(Invoice, invoice.id)
        assert stored is not None
        await charge_invoice(
            db,
            settings=api.settings,
            invoice=stored,
            provider=StubProvider(outcome="unavailable"),
        )
        await db.commit()

        # The outage left attempt_count at zero, so the next call reuses the
        # same attempt number — and the unique constraint stops it.
        with pytest.raises(DomainError) as excinfo:
            await charge_invoice(
                db,
                settings=api.settings,
                invoice=stored,
                provider=StubProvider(outcome="unavailable"),
            )
        assert excinfo.value.code == "payment_attempt_replayed"


async def test_collection_stops_after_repeated_declines(api: ApiContext) -> None:
    """Endless retries annoy the bank and never recover the money."""
    invoice = await _billable_invoice(api)

    async with api.database.session_factory() as db:
        stored = await db.get(Invoice, invoice.id)
        assert stored is not None
        for _ in range(MAX_ATTEMPTS):
            await charge_invoice(
                db,
                settings=api.settings,
                invoice=stored,
                provider=StubProvider(outcome="declined"),
            )
        await db.commit()

        with pytest.raises(DomainError) as excinfo:
            await charge_invoice(
                db,
                settings=api.settings,
                invoice=stored,
                provider=StubProvider(outcome="declined"),
            )
        assert excinfo.value.code == "invoice_attempts_exhausted"


async def test_a_business_without_a_card_is_reported_not_charged(
    api: ApiContext,
) -> None:
    invoice = await _billable_invoice(api)

    async with api.database.session_factory() as db:
        card = (await db.execute(select(SavedCard))).scalars().one()
        card.is_active = False
        await db.commit()

        stored = await db.get(Invoice, invoice.id)
        assert stored is not None
        with pytest.raises(DomainError) as excinfo:
            await charge_invoice(
                db, settings=api.settings, invoice=stored, provider=StubProvider()
            )
        assert excinfo.value.code == "no_saved_card"


async def test_no_provider_configured_is_a_clear_refusal(api: ApiContext) -> None:
    """The default build has no provider; that must not look like a decline."""
    invoice = await _billable_invoice(api)

    async with api.database.session_factory() as db:
        stored = await db.get(Invoice, invoice.id)
        assert stored is not None
        with pytest.raises(DomainError) as excinfo:
            await charge_invoice(db, settings=api.settings, invoice=stored)
        assert excinfo.value.code == "payment_provider_not_configured"


async def test_every_attempt_is_recorded_for_audit(api: ApiContext) -> None:
    invoice = await _billable_invoice(api)

    async with api.database.session_factory() as db:
        stored = await db.get(Invoice, invoice.id)
        assert stored is not None
        await charge_invoice(
            db,
            settings=api.settings,
            invoice=stored,
            provider=StubProvider(outcome="declined"),
        )
        await charge_invoice(
            db, settings=api.settings, invoice=stored, provider=StubProvider()
        )
        await db.commit()

        attempts = (
            (await db.execute(select(PaymentAttempt).order_by(PaymentAttempt.created_at)))
            .scalars()
            .all()
        )
        assert [a.status for a in attempts] == ["DECLINED", "SUCCEEDED"]
        assert stored.amount > Decimal("0")


def test_the_buyer_shape_carries_what_the_provider_demands() -> None:
    buyer = Buyer(
        id="t1",
        name="Halit",
        surname="Ekici",
        email="t@dixoratech.com",
        address="Kadıköy",
        city="İstanbul",
        ip="127.0.0.1",
    )
    assert buyer.email and buyer.ip and buyer.city


async def test_an_unusable_billing_email_is_not_charged_as_a_decline(
    api: ApiContext,
) -> None:
    """A provider rejects an unroutable address with a decline-shaped error.

    Retrying can never fix it, so it must not burn the retry budget or be
    reported to the business as a payment problem. RFC 2606 reserves `.test`,
    and no mail can ever reach it.
    """
    invoice = await _billable_invoice(api, email="sahibi@dixora.test")
    provider = StubProvider()

    async with api.database.session_factory() as db:
        stored = await db.get(Invoice, invoice.id)
        assert stored is not None
        with pytest.raises(DomainError) as excinfo:
            await charge_invoice(
                db, settings=api.settings, invoice=stored, provider=provider
            )
        assert excinfo.value.code == "billing_email_invalid"
        # The card was never touched and nothing was counted against it.
        assert provider.calls == []
        assert stored.attempt_count == 0
        assert stored.status == ISSUED


async def test_a_routable_billing_email_is_charged(api: ApiContext) -> None:
    invoice = await _billable_invoice(api, email="muhasebe@dixoratech.com")
    provider = StubProvider()

    async with api.database.session_factory() as db:
        stored = await db.get(Invoice, invoice.id)
        assert stored is not None
        attempt = await charge_invoice(
            db, settings=api.settings, invoice=stored, provider=provider
        )
        await db.commit()

        assert attempt.status == "SUCCEEDED"
        assert provider.calls[0]["buyer"].email == "muhasebe@dixoratech.com"
