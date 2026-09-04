"""The platform operator's view of what every business owes."""

from __future__ import annotations

from datetime import date
from uuid import uuid4

from sqlalchemy import select

from app.models import SavedCard, Subscription, SubscriptionPlan
from app.models.enums import TenantState
from app.services.billing import generate_invoices
from tests.conftest import ApiContext, auth_headers, login


async def _super_headers(api: ApiContext) -> dict[str, str]:
    return auth_headers(
        await login(
            api,
            username="superadmin@dixora.app",
            password="Dixora!2026",
            business=None,
        )
    )


async def _an_invoice(api: ApiContext) -> None:
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


async def test_the_operator_sees_invoices_with_the_business_named(
    api: ApiContext,
) -> None:
    await _an_invoice(api)
    headers = await _super_headers(api)

    response = await api.client.get("/api/v1/businesses/invoices", headers=headers)
    assert response.status_code == 200, response.text
    row = response.json()[0]
    # A bare tenant id would be useless when chasing an unpaid bill.
    assert row["business_name"]
    assert row["business_slug"]
    assert row["status"] == "ISSUED"
    assert row["branch_count"] >= 1


async def test_an_unpaid_bill_says_whether_a_card_exists_at_all(
    api: ApiContext,
) -> None:
    """No card and a declined card are different problems.

    Chasing a business for a failed payment when they never added a card wastes
    everyone's time, so the two must be distinguishable at a glance.
    """
    await _an_invoice(api)
    headers = await _super_headers(api)

    without = (
        await api.client.get("/api/v1/businesses/invoices", headers=headers)
    ).json()[0]
    assert without["has_card"] is False

    async with api.database.session_factory() as db:
        subscription = (await db.execute(select(Subscription))).scalars().first()
        assert subscription is not None
        db.add(
            SavedCard(
                tenant_id=subscription.tenant_id,
                provider="STUB",
                card_token=f"tok-{uuid4().hex}",
                card_user_key="usr",
                masked_number="**** **** **** 0008",
            )
        )
        await db.commit()

    with_card = (
        await api.client.get("/api/v1/businesses/invoices", headers=headers)
    ).json()[0]
    assert with_card["has_card"] is True


async def test_invoices_can_be_narrowed_to_the_unpaid_ones(
    api: ApiContext,
) -> None:
    await _an_invoice(api)
    headers = await _super_headers(api)

    issued = await api.client.get(
        "/api/v1/businesses/invoices?status=ISSUED", headers=headers
    )
    paid = await api.client.get(
        "/api/v1/businesses/invoices?status=PAID", headers=headers
    )
    assert len(issued.json()) == 1
    assert paid.json() == []


async def test_a_business_owner_cannot_see_the_platform_ledger(
    api: ApiContext,
) -> None:
    """This is every customer's revenue; it belongs to the operator alone."""
    await _an_invoice(api)
    headers = auth_headers(await login(api))

    response = await api.client.get("/api/v1/businesses/invoices", headers=headers)
    assert response.status_code == 403


async def test_the_platform_ledger_requires_authentication(api: ApiContext) -> None:
    response = await api.client.get("/api/v1/businesses/invoices")
    assert response.status_code == 401
