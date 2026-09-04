from __future__ import annotations

from uuid import UUID, uuid4

from sqlalchemy import select

from app.models import Branch, DeliveryOrder, Tenant
from tests.conftest import ApiContext, auth_headers, login, seeded_resources


async def _staff(api: ApiContext) -> tuple[dict[str, str], str]:
    headers = auth_headers(await login(api))
    resources = await seeded_resources(api, headers)
    return headers, resources["burger"]["id"]


def _payload(product_id: str, **overrides: object) -> dict:
    payload = {
        "channel": "PHONE",
        "items": [{"product_id": product_id, "quantity": "2"}],
        "idempotency_key": f"delivery-{uuid4().hex}",
        "customer_name": "Ahmet Yılmaz",
        "customer_phone": "0555 111 22 33",
        "payment_method": "CASH_ON_DELIVERY",
        "payment_status": "UNPAID",
        "auto_accept": False,
    }
    payload.update(overrides)
    return payload


async def test_phone_order_is_created_without_a_table(api: ApiContext) -> None:
    """A delivery order is a first-class order — it just has no table."""
    headers, product_id = await _staff(api)
    response = await api.client.post(
        "/api/v1/delivery", headers=headers, json=_payload(product_id)
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["channel"] == "PHONE"
    assert body["delivery_status"] == "NEW"
    # No marketplace involved, so there is nothing to synchronise.
    assert body["sync_status"] == "NOT_APPLICABLE"
    assert body["customer_name"] == "Ahmet Yılmaz"
    assert len(body["items"]) == 1
    assert float(body["items"][0]["quantity"]) == 2


async def test_own_delivery_requires_an_address(api: ApiContext) -> None:
    headers, product_id = await _staff(api)
    response = await api.client.post(
        "/api/v1/delivery",
        headers=headers,
        json=_payload(product_id, channel="OWN_DELIVERY"),
    )
    assert response.status_code == 422


async def test_takeaway_needs_no_address(api: ApiContext) -> None:
    headers, product_id = await _staff(api)
    response = await api.client.post(
        "/api/v1/delivery",
        headers=headers,
        json=_payload(product_id, channel="TAKEAWAY"),
    )
    assert response.status_code == 201, response.text


async def test_repeating_the_same_idempotency_key_creates_one_order(
    api: ApiContext,
) -> None:
    headers, product_id = await _staff(api)
    payload = _payload(product_id)

    first = await api.client.post("/api/v1/delivery", headers=headers, json=payload)
    second = await api.client.post("/api/v1/delivery", headers=headers, json=payload)
    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["order_id"] == second.json()["order_id"]

    async with api.database.session_factory() as db:
        rows = (await db.execute(select(DeliveryOrder))).scalars().all()
        assert len(rows) == 1


async def test_accept_then_ready_then_delivered(api: ApiContext) -> None:
    headers, product_id = await _staff(api)
    created = await api.client.post(
        "/api/v1/delivery", headers=headers, json=_payload(product_id)
    )
    delivery_id = created.json()["id"]

    accepted = await api.client.post(
        f"/api/v1/delivery/{delivery_id}/accept",
        headers=headers,
        json={"promised_minutes": 20},
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["delivery_status"] == "ACCEPTED"
    assert accepted.json()["promised_minutes"] == 20

    for target in ("READY", "DISPATCHED", "DELIVERED"):
        response = await api.client.post(
            f"/api/v1/delivery/{delivery_id}/status",
            headers=headers,
            json={"status": target},
        )
        assert response.status_code == 200, response.text
        assert response.json()["delivery_status"] == target

    final = response.json()
    assert final["accepted_at"] and final["ready_at"] and final["delivered_at"]


async def test_invalid_transition_is_refused(api: ApiContext) -> None:
    """A new order cannot jump straight to delivered."""
    headers, product_id = await _staff(api)
    created = await api.client.post(
        "/api/v1/delivery", headers=headers, json=_payload(product_id)
    )
    response = await api.client.post(
        f"/api/v1/delivery/{created.json()['id']}/status",
        headers=headers,
        json={"status": "DELIVERED"},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "delivery_invalid_transition"


async def test_rejection_records_a_reason_and_blocks_further_moves(
    api: ApiContext,
) -> None:
    headers, product_id = await _staff(api)
    created = await api.client.post(
        "/api/v1/delivery", headers=headers, json=_payload(product_id)
    )
    delivery_id = created.json()["id"]

    rejected = await api.client.post(
        f"/api/v1/delivery/{delivery_id}/reject",
        headers=headers,
        json={"reason": "Ürün tükendi"},
    )
    assert rejected.status_code == 200, rejected.text
    assert rejected.json()["rejection_reason"] == "Ürün tükendi"

    # Rejected is terminal — the order is never silently resurrected.
    again = await api.client.post(
        f"/api/v1/delivery/{delivery_id}/accept", headers=headers, json={}
    )
    assert again.status_code == 409


async def test_inbox_hides_finished_orders_by_default(api: ApiContext) -> None:
    headers, product_id = await _staff(api)
    keep = await api.client.post(
        "/api/v1/delivery", headers=headers, json=_payload(product_id)
    )
    done = await api.client.post(
        "/api/v1/delivery", headers=headers, json=_payload(product_id)
    )
    done_id = done.json()["id"]
    await api.client.post(
        f"/api/v1/delivery/{done_id}/reject",
        headers=headers,
        json={"reason": "Kapanış"},
    )

    listed = await api.client.get("/api/v1/delivery", headers=headers)
    assert listed.status_code == 200, listed.text
    ids = {item["id"] for item in listed.json()["items"]}
    assert keep.json()["id"] in ids
    assert done_id not in ids

    counts = await api.client.get("/api/v1/delivery/counts", headers=headers)
    assert counts.json()["new"] == 1
    assert counts.json()["cancelled"] == 1


async def test_delivery_orders_are_not_visible_across_tenants(api: ApiContext) -> None:
    """A leaked delivery id from another business must not resolve."""
    headers, product_id = await _staff(api)
    created = await api.client.post(
        "/api/v1/delivery", headers=headers, json=_payload(product_id)
    )
    delivery_id = created.json()["id"]

    # Move the record to a different tenant to simulate a foreign order.
    async with api.database.session_factory() as db:
        other = Tenant(
            name="Rakip", slug=f"rakip-{uuid4().hex[:6]}", business_type="CAFE",
            state="ACTIVE", is_active=True,
        )
        db.add(other)
        await db.flush()
        record = (
            await db.execute(select(DeliveryOrder).where(DeliveryOrder.id == UUID(delivery_id)))
        ).scalar_one()
        record.tenant_id = other.id
        await db.commit()

    for path in (f"/api/v1/delivery/{delivery_id}/accept",):
        response = await api.client.post(path, headers=headers, json={})
        assert response.status_code == 404, f"{path} leaked a foreign order"


async def test_staff_cannot_act_on_another_branch_order(api: ApiContext) -> None:
    """Branch-scoped staff must not accept an order from a branch they lack."""
    headers, product_id = await _staff(api)
    created = await api.client.post(
        "/api/v1/delivery", headers=headers, json=_payload(product_id)
    )
    delivery_id = created.json()["id"]

    async with api.database.session_factory() as db:
        tenant = (
            await db.execute(select(Tenant).where(Tenant.slug == "dixora-lab"))
        ).scalar_one()
        other_branch = Branch(
            tenant_id=tenant.id,
            name="Diğer Şube",
            slug=f"diger-{uuid4().hex[:6]}",
            timezone="Europe/Istanbul",
            is_active=True,
        )
        db.add(other_branch)
        await db.flush()
        record = (
            await db.execute(select(DeliveryOrder).where(DeliveryOrder.id == UUID(delivery_id)))
        ).scalar_one()
        record.branch_id = other_branch.id
        await db.commit()

    cashier = auth_headers(await login(api, username="cashier@dixora.test"))
    response = await api.client.post(
        f"/api/v1/delivery/{delivery_id}/accept", headers=cashier, json={}
    )
    assert response.status_code in {403, 404}, response.text
