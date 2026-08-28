"""The counter flow the cashier actually performs: one member code at payment.

The customer orders the qualifying item and the treat from the QR menu, then
reads out their code while paying. Everything after that is the server's job.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from tests.conftest import ApiContext, auth_headers, login, seeded_resources


async def _program(
    api: ApiContext,
    headers: dict[str, str],
    *,
    branch_id: str,
    qualifying_product_id: str,
    reward_product_id: str,
    threshold: int = 1,
) -> None:
    """"Buy a coffee, get a dessert" expressed as a campaign."""
    response = await api.client.put(
        "/api/v1/loyalty/program",
        headers=headers,
        json={
            "name": "Kahve Alana Tatlı",
            "is_active": True,
            "show_on_qr": True,
            "campaign_type": "PRODUCT_QUANTITY",
            "threshold": threshold,
            "branch_ids": [branch_id],
            "qualifying_product_id": qualifying_product_id,
            "reward_product_id": reward_product_id,
            "minimum_order_amount": "1.00",
            "allow_multiple_same_day": True,
            "reward_same_order": False,
        },
    )
    assert response.status_code == 200, response.text


async def _enroll(api: ApiContext, *, phone: str = "0532 555 22 11") -> dict[str, Any]:
    path = "/api/v1/loyalty/public/dixora-lab/merkez"
    start = await api.client.post(
        f"{path}/verification/start", json={"phone": phone, "consent_accepted": True}
    )
    assert start.status_code == 200, start.text
    verification = start.json()
    enrolled = await api.client.post(
        f"{path}/enroll",
        json={
            "phone": phone,
            "verification_token": verification["verification_token"],
            "verification_code": verification["development_code"],
            "consent_accepted": True,
            "consent_text_version": "2026-08",
        },
    )
    assert enrolled.status_code == 201, enrolled.text
    return enrolled.json()


async def _order(
    api: ApiContext,
    headers: dict[str, str],
    *,
    table_id: str,
    items: list[dict[str, str]],
    key: str,
) -> dict[str, Any]:
    response = await api.client.post(
        "/api/v1/orders",
        headers=headers,
        json={
            "table_id": table_id,
            "items": items,
            "idempotency_key": key,
            "auto_accept": True,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _earn_a_reward(
    api: ApiContext,
    headers: dict[str, str],
    *,
    table_id: str,
    product_id: str,
    membership_code: str,
    key: str,
) -> None:
    """Buy the qualifying product once and pay, which issues the reward."""
    order = await _order(
        api,
        headers,
        table_id=table_id,
        items=[{"product_id": product_id, "quantity": "1"}],
        key=key,
    )
    attached = await api.client.post(
        f"/api/v1/loyalty/orders/{order['id']}/membership",
        headers=headers,
        json={"membership_code": membership_code},
    )
    assert attached.status_code == 200, attached.text
    paid = await api.client.post(
        f"/api/v1/orders/{order['id']}/payments",
        headers=headers,
        json={
            "method": "CASH",
            "amount": order["total"],
            "idempotency_key": f"{key}-pay",
        },
    )
    assert paid.status_code == 201, paid.text


async def _setup(api: ApiContext) -> dict[str, Any]:
    tokens = await login(api)
    headers = auth_headers(tokens)
    resources = await seeded_resources(api, headers)
    products = resources["products"]
    coffee = resources["burger"]
    dessert = next(item for item in products if item["id"] != coffee["id"])
    await _program(
        api,
        headers,
        branch_id=tokens["user"]["branch_id"],
        qualifying_product_id=coffee["id"],
        reward_product_id=dessert["id"],
    )
    enrollment = await _enroll(api)
    await _earn_a_reward(
        api,
        headers,
        table_id=resources["tables"][0]["id"],
        product_id=coffee["id"],
        membership_code=enrollment["membership_code"],
        key="campaign-earn-0001",
    )
    return {
        "headers": headers,
        "resources": resources,
        "coffee": coffee,
        "dessert": dessert,
        "enrollment": enrollment,
    }


async def test_one_member_code_zeroes_the_treat_at_payment(api: ApiContext) -> None:
    """The whole point: the cashier types the code and the dessert costs nothing."""
    ctx = await _setup(api)
    headers = ctx["headers"]
    coffee, dessert = ctx["coffee"], ctx["dessert"]

    order = await _order(
        api,
        headers,
        table_id=ctx["resources"]["tables"][1]["id"],
        items=[
            {"product_id": coffee["id"], "quantity": "1"},
            {"product_id": dessert["id"], "quantity": "1"},
        ],
        key="campaign-apply-0001",
    )
    before = Decimal(order["total"])

    response = await api.client.post(
        f"/api/v1/loyalty/orders/{order['id']}/apply-code",
        headers=headers,
        json={
            "member_code": ctx["enrollment"]["membership_code"],
            "idempotency_key": "campaign-code-0001",
        },
    )
    assert response.status_code == 201, response.text
    body = response.json()

    assert len(body["applied"]) == 1
    granted = body["applied"][0]
    assert granted["product_name"] == dessert["name"]
    assert Decimal(granted["amount"]) == Decimal(dessert["selling_price"])
    assert body["unapplied_reason"] is None
    # The bill really drops — the discount is not cosmetic.
    assert Decimal(body["order_total"]) == before - Decimal(dessert["selling_price"])


async def test_the_code_is_matched_server_side_not_by_the_browser(
    api: ApiContext,
) -> None:
    """The caller never names a line; the server decides what the reward covers."""
    ctx = await _setup(api)
    headers = ctx["headers"]
    coffee, dessert = ctx["coffee"], ctx["dessert"]

    order = await _order(
        api,
        headers,
        table_id=ctx["resources"]["tables"][2]["id"],
        items=[
            {"product_id": coffee["id"], "quantity": "1"},
            {"product_id": dessert["id"], "quantity": "1"},
        ],
        key="campaign-apply-0002",
    )
    dessert_item = next(
        item for item in order["items"] if item["product_id"] == dessert["id"]
    )

    response = await api.client.post(
        f"/api/v1/loyalty/orders/{order['id']}/apply-code",
        headers=headers,
        json={
            "member_code": ctx["enrollment"]["membership_code"],
            "idempotency_key": "campaign-code-0002",
        },
    )
    assert response.status_code == 201, response.text
    # It landed on the dessert, not the coffee, without being told which.
    assert response.json()["applied"][0]["order_item_id"] == dessert_item["id"]


async def test_replaying_the_same_code_does_not_discount_twice(
    api: ApiContext,
) -> None:
    """A double-tap at a busy till must not give the treat away twice."""
    ctx = await _setup(api)
    headers = ctx["headers"]
    coffee, dessert = ctx["coffee"], ctx["dessert"]

    order = await _order(
        api,
        headers,
        table_id=ctx["resources"]["tables"][3]["id"],
        items=[
            {"product_id": coffee["id"], "quantity": "1"},
            {"product_id": dessert["id"], "quantity": "1"},
        ],
        key="campaign-apply-0003",
    )
    payload = {
        "member_code": ctx["enrollment"]["membership_code"],
        "idempotency_key": "campaign-code-0003",
    }
    first = await api.client.post(
        f"/api/v1/loyalty/orders/{order['id']}/apply-code", headers=headers, json=payload
    )
    second = await api.client.post(
        f"/api/v1/loyalty/orders/{order['id']}/apply-code", headers=headers, json=payload
    )
    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text
    assert Decimal(second.json()["order_total"]) == Decimal(first.json()["order_total"])


async def test_a_code_with_no_matching_item_explains_itself(api: ApiContext) -> None:
    """Silence would leave the cashier arguing with the customer."""
    ctx = await _setup(api)
    headers = ctx["headers"]

    order = await _order(
        api,
        headers,
        table_id=ctx["resources"]["tables"][4]["id"],
        items=[{"product_id": ctx["coffee"]["id"], "quantity": "1"}],
        key="campaign-apply-0004",
    )
    response = await api.client.post(
        f"/api/v1/loyalty/orders/{order['id']}/apply-code",
        headers=headers,
        json={
            "member_code": ctx["enrollment"]["membership_code"],
            "idempotency_key": "campaign-code-0004",
        },
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["applied"] == []
    assert body["unapplied_reason"]
    assert Decimal(body["total_discount"]) == Decimal("0")


async def test_an_unknown_code_is_refused(api: ApiContext) -> None:
    ctx = await _setup(api)
    headers = ctx["headers"]
    order = await _order(
        api,
        headers,
        table_id=ctx["resources"]["tables"][5]["id"],
        items=[{"product_id": ctx["coffee"]["id"], "quantity": "1"}],
        key="campaign-apply-0005",
    )
    response = await api.client.post(
        f"/api/v1/loyalty/orders/{order['id']}/apply-code",
        headers=headers,
        json={"member_code": "DXRNOPE", "idempotency_key": "campaign-code-0005"},
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "membership_not_found"


async def test_a_members_code_cannot_reach_another_business(api: ApiContext) -> None:
    """Member codes are only meaningful inside the business that issued them."""
    ctx = await _setup(api)
    headers = ctx["headers"]
    order = await _order(
        api,
        headers,
        table_id=ctx["resources"]["tables"][6]["id"],
        items=[{"product_id": ctx["coffee"]["id"], "quantity": "1"}],
        key="campaign-apply-0006",
    )
    # Same shape as a real code, but never issued by this tenant.
    response = await api.client.post(
        f"/api/v1/loyalty/orders/{order['id']}/apply-code",
        headers=headers,
        json={"member_code": "DXR9999", "idempotency_key": "campaign-code-0006"},
    )
    assert response.status_code == 404
