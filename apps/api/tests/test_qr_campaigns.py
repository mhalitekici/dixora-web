"""Campaigns a guest unlocks from the QR menu, and the offers shown there.

The scenario these cover is the one that failed in production: a guest orders,
then identifies themselves when asking for the bill. The offer was withheld
while they were anonymous, and nothing re-evaluated it once they were not.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any
from uuid import uuid4

from sqlalchemy import select

from app.models import Subscription, SubscriptionPlan, Tenant
from tests.conftest import ApiContext, auth_headers, login, seeded_resources

MENU = "/api/v1/qr/public/dixora-lab/merkez"
LOYALTY = "/api/v1/loyalty/public/dixora-lab/merkez"


async def _context(api: ApiContext) -> dict[str, Any]:
    tokens = await login(api)
    headers = auth_headers(tokens)
    resources = await seeded_resources(api, headers)
    products = resources["products"]
    latte = resources["burger"]
    tiramisu = next(item for item in products if item["id"] != latte["id"])
    branch_id = tokens["user"]["branch_id"]

    program = await api.client.put(
        "/api/v1/loyalty/program",
        headers=headers,
        json={
            "name": "Dixora Müdavim",
            "is_active": True,
            "show_on_qr": True,
            "campaign_type": "VISIT_COUNT",
            "threshold": 5,
            "branch_ids": [branch_id],
            "reward_product_id": latte["id"],
            "minimum_order_amount": "1.00",
            "allow_multiple_same_day": True,
            "reward_same_order": False,
        },
    )
    assert program.status_code == 200, program.text

    started = await api.client.post(
        f"{LOYALTY}/verification/start",
        json={"phone": "0532 111 22 33", "consent_accepted": True},
    )
    assert started.status_code == 200, started.text
    enrolled = await api.client.post(
        f"{LOYALTY}/enroll",
        json={
            "phone": "0532 111 22 33",
            "verification_token": started.json()["verification_token"],
            "verification_code": started.json()["development_code"],
            "consent_accepted": True,
            "consent_text_version": "2026-08",
        },
    )
    assert enrolled.status_code == 201, enrolled.text

    return {
        "headers": headers,
        "branch_id": branch_id,
        "tables": resources["tables"],
        "latte": latte,
        "tiramisu": tiramisu,
        "member_code": enrolled.json()["membership_code"],
    }


async def _campaign(
    api: ApiContext, ctx: dict[str, Any], **overrides: Any
) -> dict[str, Any]:
    payload = {
        "name": "Latte Alana Tiramisu",
        "branch_ids": [ctx["branch_id"]],
        "buy_product_id": ctx["latte"]["id"],
        "buy_quantity": 1,
        "reward_kind": "FREE_ITEM",
        "reward_product_id": ctx["tiramisu"]["id"],
        "is_active": True,
    }
    payload.update(overrides)
    response = await api.client.post(
        "/api/v1/campaigns", headers=ctx["headers"], json=payload
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _order(
    api: ApiContext, ctx: dict[str, Any], *, table_index: int
) -> dict[str, Any]:
    """A Latte and a Tiramisu, exactly as the guest ordered them."""
    response = await api.client.post(
        "/api/v1/orders",
        headers=ctx["headers"],
        json={
            "table_id": ctx["tables"][table_index]["id"],
            "items": [
                {"product_id": ctx["latte"]["id"], "quantity": "1"},
                {"product_id": ctx["tiramisu"]["id"], "quantity": "1"},
            ],
            "idempotency_key": f"qr-campaign-{uuid4().hex}",
            "auto_accept": True,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _session_token(api: ApiContext, ctx: dict[str, Any], table_index: int) -> str:
    menu = await api.client.get(
        MENU, params={"table_token": ctx["tables"][table_index]["qr_token"]}
    )
    assert menu.status_code == 200, menu.text
    token = menu.json()["session_token"]
    assert token
    return token


async def _request_bill(
    api: ApiContext,
    ctx: dict[str, Any],
    table_index: int,
    *,
    membership_code: str | None,
):
    return await api.client.post(
        f"{MENU}/bill-request",
        json={
            "table_token": ctx["tables"][table_index]["qr_token"],
            "session_token": await _session_token(api, ctx, table_index),
            "payment_preference": "CASH",
            "membership_code": membership_code,
        },
    )


async def _order_state(
    api: ApiContext, ctx: dict[str, Any], order_id: str
) -> dict[str, Any]:
    response = await api.client.get(
        f"/api/v1/orders/{order_id}", headers=ctx["headers"]
    )
    assert response.status_code == 200, response.text
    return response.json()


async def test_the_guest_unlocks_the_treat_by_entering_their_code(
    api: ApiContext,
) -> None:
    """The production scenario end to end: order, then identify, then the bill.

    The guest was anonymous when the lines were added, so the members-only
    offer was withheld. Entering the code with the bill request is the only
    moment it can be honoured — the till is never asked for anything.
    """
    ctx = await _context(api)
    await _campaign(api, ctx)
    order = await _order(api, ctx, table_index=0)
    before = Decimal(order["total"])
    tiramisu_price = Decimal(ctx["tiramisu"]["selling_price"])

    # Anonymous: the offer is correctly withheld.
    assert Decimal(order["discount_total"]) == Decimal("0")

    response = await _request_bill(api, ctx, 0, membership_code=ctx["member_code"])
    assert response.status_code == 201, response.text

    state = await _order_state(api, ctx, order["id"])
    assert state["status"] == "BILL_REQUESTED"
    # The Tiramisu is now free, and the bill the cashier opens says so.
    assert Decimal(state["discount_total"]) == tiramisu_price
    assert Decimal(state["total"]) == before - tiramisu_price


async def test_a_bill_request_without_a_code_grants_nothing(api: ApiContext) -> None:
    ctx = await _context(api)
    await _campaign(api, ctx)
    order = await _order(api, ctx, table_index=1)
    before = Decimal(order["total"])

    response = await _request_bill(api, ctx, 1, membership_code=None)
    assert response.status_code == 201, response.text

    state = await _order_state(api, ctx, order["id"])
    assert Decimal(state["discount_total"]) == Decimal("0")
    assert Decimal(state["total"]) == before


async def test_asking_twice_does_not_discount_twice(api: ApiContext) -> None:
    """A retried request — a flaky phone connection — must not stack."""
    ctx = await _context(api)
    await _campaign(api, ctx)
    order = await _order(api, ctx, table_index=2)
    tiramisu_price = Decimal(ctx["tiramisu"]["selling_price"])

    first = await _request_bill(api, ctx, 2, membership_code=ctx["member_code"])
    assert first.status_code == 201, first.text
    after_first = await _order_state(api, ctx, order["id"])

    second = await _request_bill(api, ctx, 2, membership_code=ctx["member_code"])
    assert second.status_code == 201, second.text
    after_second = await _order_state(api, ctx, order["id"])

    assert Decimal(after_first["discount_total"]) == tiramisu_price
    assert Decimal(after_second["discount_total"]) == tiramisu_price
    assert after_second["total"] == after_first["total"]


async def test_a_paid_bill_is_not_reopened_by_a_late_code(api: ApiContext) -> None:
    """The campaign_after_payment_started guard still holds on this path.

    The bill request itself must still succeed: refusing it outright would
    leave the guest unable to call for the bill at all.
    """
    ctx = await _context(api)
    await _campaign(api, ctx)
    order = await _order(api, ctx, table_index=3)
    # A part payment: enough to start settling, not enough to close the bill,
    # so the guest can still call for it.
    paid = await api.client.post(
        f"/api/v1/orders/{order['id']}/payments",
        headers=ctx["headers"],
        json={
            "method": "CASH",
            "amount": "1.00",
            "idempotency_key": f"pay-{uuid4().hex}",
        },
    )
    assert paid.status_code in {200, 201}, paid.text

    response = await _request_bill(api, ctx, 3, membership_code=ctx["member_code"])
    assert response.status_code == 201, response.text

    state = await _order_state(api, ctx, order["id"])
    assert Decimal(state["discount_total"]) == Decimal("0")


async def test_an_unknown_code_grants_nothing(api: ApiContext) -> None:
    ctx = await _context(api)
    await _campaign(api, ctx)
    order = await _order(api, ctx, table_index=4)

    response = await _request_bill(api, ctx, 4, membership_code="ZZZZZZZZ")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "membership_not_found"

    state = await _order_state(api, ctx, order["id"])
    assert Decimal(state["discount_total"]) == Decimal("0")


async def test_the_menu_lists_only_live_offers_for_this_branch(
    api: ApiContext,
) -> None:
    ctx = await _context(api)
    live = await _campaign(api, ctx, name="Latte Alana Tiramisu")
    await _campaign(api, ctx, name="Kapalı Kampanya", is_active=False)
    await _campaign(
        api,
        ctx,
        name="Süresi Dolmuş",
        starts_at="2020-01-01T00:00:00",
        ends_at="2020-02-01T00:00:00",
    )
    await _campaign(
        api,
        ctx,
        name="Gelecek Kampanya",
        starts_at="2090-01-01T00:00:00",
        ends_at="2090-02-01T00:00:00",
    )

    response = await api.client.get(f"{MENU}/campaigns")
    assert response.status_code == 200, response.text
    body = response.json()
    assert [item["name"] for item in body] == ["Latte Alana Tiramisu"]
    assert body[0]["id"] == live["id"]
    assert body[0]["audience"] == "MEMBERS_ONLY"
    assert ctx["latte"]["name"] in body[0]["summary"]
    assert ctx["tiramisu"]["name"] in body[0]["summary"]
    assert "ikram" in body[0]["summary"]


async def test_the_public_offer_hides_the_configuration_behind_it(
    api: ApiContext,
) -> None:
    """A customer sees the sentence, never the ids or the rules behind it."""
    ctx = await _context(api)
    await _campaign(api, ctx)

    response = await api.client.get(f"{MENU}/campaigns")
    assert response.status_code == 200, response.text
    offer = response.json()[0]
    assert set(offer) == {
        "id",
        "name",
        "description",
        "summary",
        "audience",
        "starts_at",
        "ends_at",
    }
    serialized = str(offer)
    assert ctx["latte"]["id"] not in serialized
    assert ctx["tiramisu"]["id"] not in serialized
    assert ctx["branch_id"] not in serialized


async def _use_paid_plan(api: ApiContext) -> None:
    """Trials are capped at one branch; opening a second one needs the paid plan."""
    async with api.database.session_factory() as db:
        tenant = (
            await db.execute(select(Tenant).where(Tenant.slug == "dixora-lab"))
        ).scalar_one()
        standard = (
            await db.execute(
                select(SubscriptionPlan).where(SubscriptionPlan.code == "STANDARD")
            )
        ).scalar_one()
        subscription = (
            await db.execute(
                select(Subscription).where(Subscription.tenant_id == tenant.id)
            )
        ).scalar_one()
        subscription.plan_id = standard.id
        await db.commit()


async def test_another_branch_offer_never_reaches_this_menu(
    api: ApiContext,
) -> None:
    ctx = await _context(api)
    await _use_paid_plan(api)
    other = await api.client.post(
        "/api/v1/branches",
        headers=ctx["headers"],
        json={"name": "İkinci Şube", "slug": "ikinci", "timezone": "Europe/Istanbul"},
    )
    assert other.status_code == 201, other.text
    await _campaign(
        api, ctx, name="Diğer Şube Kampanyası", branch_ids=[other.json()["id"]]
    )

    response = await api.client.get(f"{MENU}/campaigns")
    assert response.status_code == 200, response.text
    assert [item["name"] for item in response.json()] == []


async def test_the_offer_list_is_scoped_to_the_business_in_the_url(
    api: ApiContext,
) -> None:
    ctx = await _context(api)
    await _campaign(api, ctx)
    missing = await api.client.get("/api/v1/qr/public/baska-isletme/merkez/campaigns")
    assert missing.status_code == 404


async def test_the_admin_listing_stays_behind_authentication(
    api: ApiContext,
) -> None:
    ctx = await _context(api)
    await _campaign(api, ctx)

    public = await api.client.get(f"{MENU}/campaigns")
    assert public.status_code == 200, public.text
    assert len(public.json()) == 1

    # Opening the customer-facing list did not open the owner's.
    admin = await api.client.get("/api/v1/campaigns")
    assert admin.status_code == 401
