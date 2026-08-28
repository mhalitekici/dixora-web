"""Card and invoice endpoints.

The callback deserves the most attention: it is the one route a payment
provider's servers call directly, with no session behind it.
"""

from __future__ import annotations

from datetime import date
from uuid import uuid4

from sqlalchemy import select

from app.api.billing import _tenant_from_conversation
from app.models import SavedCard, Subscription, SubscriptionPlan, Tenant
from app.models.enums import TenantState
from app.services.billing import generate_invoices
from tests.conftest import ApiContext, auth_headers, login


async def _headers(api: ApiContext) -> dict[str, str]:
    return auth_headers(await login(api))


async def _other_tenant(api: ApiContext) -> "Tenant":
    """A real second business — a bare uuid would fail the foreign key."""
    async with api.database.session_factory() as db:
        tenant = Tenant(
            name="Rakip Kafe",
            slug=f"rakip-{uuid4().hex[:8]}",
            business_type="CAFE",
            state="ACTIVE",
            is_active=True,
        )
        db.add(tenant)
        await db.commit()
        await db.refresh(tenant)
        return tenant


def test_the_tenant_is_recoverable_from_the_checkout_reference() -> None:
    tenant_id = uuid4()
    assert _tenant_from_conversation(f"card-{tenant_id}-1786600000") == tenant_id


def test_a_forged_or_foreign_reference_names_no_tenant() -> None:
    """The callback has no session, so this parse is a trust boundary."""
    assert _tenant_from_conversation("") is None
    assert _tenant_from_conversation("card-not-a-uuid-123") is None
    assert _tenant_from_conversation("order-11111111-1111-1111-1111-111111111111-1") is None
    # A well-formed uuid under the wrong prefix must not be accepted either.
    assert _tenant_from_conversation(f"refund-{uuid4()}-1") is None


async def test_cards_are_listed_per_business_only(api: ApiContext) -> None:
    headers = await _headers(api)
    async with api.database.session_factory() as db:
        subscription = (await db.execute(select(Subscription))).scalars().first()
        assert subscription is not None
        db.add(
            SavedCard(
                tenant_id=subscription.tenant_id,
                provider="STUB",
                card_token="tok_mine",
                card_user_key="usr_1",
                masked_number="**** **** **** 0008",
            )
        )
        await db.commit()

    other = await _other_tenant(api)
    async with api.database.session_factory() as db:
        # Another business's card, which must never appear below.
        db.add(
            SavedCard(
                tenant_id=other.id,
                provider="STUB",
                card_token="tok_theirs",
                card_user_key="usr_2",
                masked_number="**** **** **** 9999",
            )
        )
        await db.commit()

    response = await api.client.get("/api/v1/billing/cards", headers=headers)
    assert response.status_code == 200, response.text
    numbers = {card["masked_number"] for card in response.json()}
    assert numbers == {"**** **** **** 0008"}


async def test_removing_a_card_deactivates_rather_than_deletes(
    api: ApiContext,
) -> None:
    headers = await _headers(api)
    async with api.database.session_factory() as db:
        subscription = (await db.execute(select(Subscription))).scalars().first()
        assert subscription is not None
        card = SavedCard(
            tenant_id=subscription.tenant_id,
            provider="STUB",
            card_token="tok_1",
            card_user_key="usr_1",
            masked_number="**** **** **** 0008",
        )
        db.add(card)
        await db.commit()
        card_id = card.id

    removed = await api.client.delete(
        f"/api/v1/billing/cards/{card_id}", headers=headers
    )
    assert removed.status_code == 204

    listed = await api.client.get("/api/v1/billing/cards", headers=headers)
    assert listed.json() == []

    async with api.database.session_factory() as db:
        # The row survives, so past charges stay traceable.
        stored = await db.get(SavedCard, card_id)
        assert stored is not None
        assert stored.is_active is False


async def test_another_businesss_card_cannot_be_removed(api: ApiContext) -> None:
    headers = await _headers(api)
    other = await _other_tenant(api)
    async with api.database.session_factory() as db:
        card = SavedCard(
            tenant_id=other.id,
            provider="STUB",
            card_token="tok_theirs",
            card_user_key="usr_2",
            masked_number="**** **** **** 9999",
        )
        db.add(card)
        await db.commit()
        card_id = card.id

    response = await api.client.delete(
        f"/api/v1/billing/cards/{card_id}", headers=headers
    )
    assert response.status_code == 404


async def test_invoices_are_listed_with_their_breakdown(api: ApiContext) -> None:
    headers = await _headers(api)
    async with api.database.session_factory() as db:
        subscription = (await db.execute(select(Subscription))).scalars().first()
        assert subscription is not None
        standard = (
            await db.execute(
                select(SubscriptionPlan).where(SubscriptionPlan.code == "STANDARD")
            )
        ).scalar_one()
        subscription.plan_id = standard.id
        subscription.status = TenantState.ACTIVE
        await db.commit()
        await generate_invoices(db, on=date(2026, 8, 13))
        await db.commit()

    response = await api.client.get("/api/v1/billing/invoices", headers=headers)
    assert response.status_code == 200, response.text
    invoice = response.json()[0]
    assert invoice["period_start"] == "2026-08-01"
    assert invoice["status"] == "ISSUED"
    # The owner can see what they are paying for, not just a total.
    assert invoice["branch_count"] >= 1
    assert invoice["base_amount"]
    assert invoice["extra_branch_amount"] is not None


async def test_opening_a_card_form_without_a_provider_is_a_clear_refusal(
    api: ApiContext,
) -> None:
    """The default build has no provider configured."""
    headers = await _headers(api)
    response = await api.client.post("/api/v1/billing/cards/checkout", headers=headers)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "payment_provider_not_configured"


async def test_billing_endpoints_require_authentication(api: ApiContext) -> None:
    for path in ("/api/v1/billing/cards", "/api/v1/billing/invoices"):
        response = await api.client.get(path)
        assert response.status_code == 401, path
