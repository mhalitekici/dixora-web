"""Owner-defined campaigns: many at once, independent of the loyalty programme."""

from __future__ import annotations

from decimal import Decimal
from typing import Any
from uuid import uuid4

from tests.conftest import ApiContext, auth_headers, login, seeded_resources


async def _context(api: ApiContext) -> dict[str, Any]:
    tokens = await login(api)
    headers = auth_headers(tokens)
    resources = await seeded_resources(api, headers)
    products = resources["products"]
    coffee = resources["burger"]
    dessert = next(item for item in products if item["id"] != coffee["id"])
    branch_id = tokens["user"]["branch_id"]
    # A campaign is unlocked by a member code, so every scenario needs a
    # programme and an enrolled customer to test against.
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
            "reward_product_id": coffee["id"],
            "minimum_order_amount": "1.00",
            "allow_multiple_same_day": True,
            "reward_same_order": False,
        },
    )
    assert program.status_code == 200, program.text
    path = "/api/v1/loyalty/public/dixora-lab/merkez"
    started = await api.client.post(
        f"{path}/verification/start",
        json={"phone": "0532 555 44 33", "consent_accepted": True},
    )
    assert started.status_code == 200, started.text
    verification = started.json()
    enrolled = await api.client.post(
        f"{path}/enroll",
        json={
            "phone": "0532 555 44 33",
            "verification_token": verification["verification_token"],
            "verification_code": verification["development_code"],
            "consent_accepted": True,
            "consent_text_version": "2026-08",
        },
    )
    assert enrolled.status_code == 201, enrolled.text
    return {
        "headers": headers,
        "branch_id": branch_id,
        "tables": resources["tables"],
        "coffee": coffee,
        "dessert": dessert,
        "member_code": enrolled.json()["membership_code"],
    }


async def _campaign(
    api: ApiContext, ctx: dict[str, Any], **overrides: Any
) -> dict[str, Any]:
    payload = {
        "name": "Kahve Alana Tatlı",
        "branch_ids": [ctx["branch_id"]],
        "buy_product_id": ctx["coffee"]["id"],
        "buy_quantity": 1,
        "reward_kind": "FREE_ITEM",
        "reward_product_id": ctx["dessert"]["id"],
        "is_active": True,
    }
    payload.update(overrides)
    response = await api.client.post(
        "/api/v1/campaigns", headers=ctx["headers"], json=payload
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _order(
    api: ApiContext, ctx: dict[str, Any], *, table_index: int, items: list[dict]
) -> dict[str, Any]:
    response = await api.client.post(
        "/api/v1/orders",
        headers=ctx["headers"],
        json={
            "table_id": ctx["tables"][table_index]["id"],
            "items": items,
            "idempotency_key": f"campaign-{uuid4().hex}",
            "auto_accept": True,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _apply(api: ApiContext, ctx: dict[str, Any], order_id: str):
    return await api.client.post(
        f"/api/v1/campaigns/orders/{order_id}/apply", headers=ctx["headers"], json={}
    )


async def _attach_member(api: ApiContext, ctx: dict[str, Any], order_id: str) -> None:
    """Campaigns are members-only, so a basket needs a member to qualify."""
    attached = await api.client.post(
        f"/api/v1/loyalty/orders/{order_id}/membership",
        headers=ctx["headers"],
        json={"membership_code": ctx["member_code"]},
    )
    assert attached.status_code == 200, attached.text


async def _order_state(
    api: ApiContext, ctx: dict[str, Any], order_id: str
) -> dict[str, Any]:
    response = await api.client.get(
        f"/api/v1/orders/{order_id}", headers=ctx["headers"]
    )
    assert response.status_code == 200, response.text
    return response.json()


async def test_owner_writes_a_buy_this_get_that_offer(api: ApiContext) -> None:
    ctx = await _context(api)
    created = await _campaign(api, ctx)
    # The summary is built server-side so every screen words the offer the same.
    assert ctx["coffee"]["name"] in created["summary"]
    assert ctx["dessert"]["name"] in created["summary"]
    assert "ikram" in created["summary"]


async def test_a_qualifying_basket_gets_the_treat_for_free(api: ApiContext) -> None:
    ctx = await _context(api)
    await _campaign(api, ctx)
    order = await _order(
        api,
        ctx,
        table_index=0,
        items=[
            {"product_id": ctx["coffee"]["id"], "quantity": "1"},
            {"product_id": ctx["dessert"]["id"], "quantity": "1"},
        ],
    )
    before = Decimal(order["total"])

    # Attaching the member is what unlocks the offer, so the treat is already
    # free by the time anyone opens the bill — no second action at the till.
    await _attach_member(api, ctx, order["id"])
    state = await _order_state(api, ctx, order["id"])
    assert Decimal(state["discount_total"]) == Decimal(ctx["dessert"]["selling_price"])
    assert Decimal(state["total"]) == before - Decimal(ctx["dessert"]["selling_price"])

    # Applying again is the cashier tapping a button that is now a no-op.
    response = await _apply(api, ctx, order["id"])
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["granted"] == []
    assert Decimal(body["order_total"]) == Decimal(state["total"])


async def test_several_campaigns_run_at_once(api: ApiContext) -> None:
    """The whole point of a separate table: more than one offer can be live."""
    ctx = await _context(api)
    await _campaign(api, ctx, name="Kahve Alana Tatlı")
    await _campaign(
        api,
        ctx,
        name="Tatlı Alana %50 Kahve",
        buy_product_id=ctx["dessert"]["id"],
        reward_kind="PERCENT",
        reward_product_id=ctx["coffee"]["id"],
        reward_value="50",
    )

    listed = await api.client.get("/api/v1/campaigns", headers=ctx["headers"])
    assert listed.status_code == 200
    assert len(listed.json()) == 2

    order = await _order(
        api,
        ctx,
        table_index=1,
        items=[
            {"product_id": ctx["coffee"]["id"], "quantity": "1"},
            {"product_id": ctx["dessert"]["id"], "quantity": "1"},
        ],
    )
    before = Decimal(order["total"])
    await _attach_member(api, ctx, order["id"])
    # Both offers fire on the one attach, not one per cashier action.
    state = await _order_state(api, ctx, order["id"])
    assert Decimal(state["discount_total"]) > Decimal("0")
    assert Decimal(state["total"]) < before

    # Nothing is left for a manual apply to grant.
    response = await _apply(api, ctx, order["id"])
    assert response.status_code == 201, response.text
    assert response.json()["granted"] == []


async def test_applying_twice_does_not_stack_the_same_offer(api: ApiContext) -> None:
    ctx = await _context(api)
    await _campaign(api, ctx)
    order = await _order(
        api,
        ctx,
        table_index=2,
        items=[
            {"product_id": ctx["coffee"]["id"], "quantity": "1"},
            {"product_id": ctx["dessert"]["id"], "quantity": "1"},
        ],
    )
    await _attach_member(api, ctx, order["id"])
    first = await _apply(api, ctx, order["id"])
    second = await _apply(api, ctx, order["id"])
    assert first.status_code == 201
    assert second.status_code == 201
    assert second.json()["granted"] == []
    assert Decimal(second.json()["order_total"]) == Decimal(first.json()["order_total"])


async def test_a_basket_without_the_condition_gets_nothing(api: ApiContext) -> None:
    ctx = await _context(api)
    await _campaign(api, ctx)
    order = await _order(
        api,
        ctx,
        table_index=3,
        items=[{"product_id": ctx["dessert"]["id"], "quantity": "1"}],
    )
    response = await _apply(api, ctx, order["id"])
    assert response.status_code == 201, response.text
    assert response.json()["granted"] == []
    assert Decimal(response.json()["total_discount"]) == Decimal("0")


async def test_a_campaign_is_held_back_until_a_member_code_is_entered(
    api: ApiContext,
) -> None:
    """Campaigns are members-only, and the till must be told to ask for a code
    rather than silently granting nothing."""
    ctx = await _context(api)
    await _campaign(api, ctx)
    order = await _order(
        api,
        ctx,
        table_index=4,
        items=[
            {"product_id": ctx["coffee"]["id"], "quantity": "1"},
            {"product_id": ctx["dessert"]["id"], "quantity": "1"},
        ],
    )
    response = await _apply(api, ctx, order["id"])
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["granted"] == []
    assert body["skipped_members_only"] is True


async def test_an_inactive_campaign_never_fires(api: ApiContext) -> None:
    ctx = await _context(api)
    await _campaign(api, ctx, is_active=False)
    order = await _order(
        api,
        ctx,
        table_index=5,
        items=[
            {"product_id": ctx["coffee"]["id"], "quantity": "1"},
            {"product_id": ctx["dessert"]["id"], "quantity": "1"},
        ],
    )
    response = await _apply(api, ctx, order["id"])
    assert response.json()["granted"] == []


async def test_a_campaign_that_could_never_fire_is_rejected(api: ApiContext) -> None:
    """Better a rejected form than an advertised offer that silently never applies."""
    ctx = await _context(api)
    both = await api.client.post(
        "/api/v1/campaigns",
        headers=ctx["headers"],
        json={
            "name": "Bozuk",
            "branch_ids": [ctx["branch_id"]],
            # Neither a product nor a category to buy.
            "reward_kind": "FREE_ITEM",
            "reward_product_id": ctx["dessert"]["id"],
        },
    )
    assert both.status_code == 422
    assert both.json()["error"]["code"] == "campaign_condition_invalid"

    percent = await api.client.post(
        "/api/v1/campaigns",
        headers=ctx["headers"],
        json={
            "name": "Bozuk Yüzde",
            "branch_ids": [ctx["branch_id"]],
            "buy_product_id": ctx["coffee"]["id"],
            "reward_kind": "PERCENT",
            "reward_product_id": ctx["dessert"]["id"],
            "reward_value": "150",
        },
    )
    assert percent.status_code == 422
    assert percent.json()["error"]["code"] == "campaign_reward_invalid"


async def test_a_campaign_cannot_reference_another_business_catalog(
    api: ApiContext,
) -> None:
    ctx = await _context(api)
    response = await api.client.post(
        "/api/v1/campaigns",
        headers=ctx["headers"],
        json={
            "name": "Sızıntı",
            "branch_ids": [ctx["branch_id"]],
            "buy_product_id": str(uuid4()),
            "reward_kind": "FREE_ITEM",
            "reward_product_id": ctx["dessert"]["id"],
        },
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "product_not_found"


async def test_editing_with_a_stale_version_is_refused(api: ApiContext) -> None:
    ctx = await _context(api)
    created = await _campaign(api, ctx)
    payload = {
        "name": "Yeni Ad",
        "branch_ids": [ctx["branch_id"]],
        "buy_product_id": ctx["coffee"]["id"],
        "reward_kind": "FREE_ITEM",
        "reward_product_id": ctx["dessert"]["id"],
        "expected_version": created["version"],
    }
    first = await api.client.put(
        f"/api/v1/campaigns/{created['id']}", headers=ctx["headers"], json=payload
    )
    assert first.status_code == 200, first.text
    stale = await api.client.put(
        f"/api/v1/campaigns/{created['id']}", headers=ctx["headers"], json=payload
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "campaign_version_conflict"


async def test_deleting_deactivates_so_history_survives(api: ApiContext) -> None:
    ctx = await _context(api)
    created = await _campaign(api, ctx)
    removed = await api.client.delete(
        f"/api/v1/campaigns/{created['id']}", headers=ctx["headers"]
    )
    assert removed.status_code == 204
    listed = await api.client.get("/api/v1/campaigns", headers=ctx["headers"])
    remaining = listed.json()
    assert len(remaining) == 1
    assert remaining[0]["is_active"] is False


async def test_the_loyalty_programme_is_untouched_by_campaigns(
    api: ApiContext,
) -> None:
    """Campaigns must not disturb the separate stamp-card programme."""
    ctx = await _context(api)
    await _campaign(api, ctx)
    program = await api.client.get("/api/v1/loyalty/program", headers=ctx["headers"])
    assert program.status_code == 200
    body = program.json()
    # The stamp card is exactly as configured: campaigns neither replaced nor
    # edited it, they run alongside.
    assert body["name"] == "Dixora Müdavim"
    assert body["is_active"] is True
    assert body["rule"]["campaign_type"] == "VISIT_COUNT"
    assert body["rule"]["threshold"] == 5
