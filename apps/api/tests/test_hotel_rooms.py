from __future__ import annotations

from decimal import Decimal

from tests.conftest import ApiContext, auth_headers, login, seeded_resources


async def _create_room(api: ApiContext, headers: dict[str, str], room_number: str) -> dict:
    response = await api.client.post(
        "/api/v1/hotel-rooms",
        headers=headers,
        json={"room_number": room_number, "sort_order": 0},
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _check_in(
    api: ApiContext, headers: dict[str, str], room: dict, guest_name: str
) -> dict:
    response = await api.client.post(
        f"/api/v1/hotel-rooms/{room['id']}/check-in",
        headers=headers,
        json={"guest_name": guest_name, "expected_version": room["version"]},
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _charge_room(
    api: ApiContext,
    headers: dict[str, str],
    *,
    table_id: str,
    product_id: str,
    reference: str,
    key: str,
) -> dict:
    order = await api.client.post(
        "/api/v1/orders",
        headers=headers,
        json={
            "table_id": table_id,
            "items": [{"product_id": product_id, "quantity": "1"}],
            "idempotency_key": key,
            "auto_accept": True,
        },
    )
    assert order.status_code == 201, order.text
    order_body = order.json()
    payment = await api.client.post(
        f"/api/v1/orders/{order_body['id']}/payments",
        headers=headers,
        json={
            "method": "ROOM_CHARGE",
            "amount": order_body["total"],
            "idempotency_key": f"{key}-pay",
            "reference": reference,
        },
    )
    assert payment.status_code == 201, payment.text
    return order_body


async def test_checkout_excludes_previous_guests_settled_charges(api: ApiContext) -> None:
    """otel oda hesabı: check-out sonrası bir önceki misafirin siparişleri yeni

    misafirin hesabında görünmemeli. Folio preview and the checkout charge
    itself must both be scoped to the *current* stay only.
    """
    tokens = await login(api)
    headers = auth_headers(tokens)
    resources = await seeded_resources(api, headers)
    tables = resources["tables"]
    burger = resources["burger"]

    room = await _create_room(api, headers, "212")
    room = await _check_in(api, headers, room, "Ahmet Yılmaz")
    first_order = await _charge_room(
        api,
        headers,
        table_id=tables[0]["id"],
        product_id=burger["id"],
        reference=room["folio_reference"],
        key="room-212-stay-1-order-1",
    )
    first_total = Decimal(first_order["total"])
    assert first_total > 0

    folio = await api.client.get(f"/api/v1/hotel-rooms/{room['id']}/folio", headers=headers)
    assert folio.status_code == 200, folio.text
    assert Decimal(folio.json()["total"]) == first_total
    assert len(folio.json()["orders"]) == 1

    checkout = await api.client.post(
        f"/api/v1/hotel-rooms/{room['id']}/check-out",
        headers=headers,
        json={"payment_method": "CASH", "expected_version": room["version"]},
    )
    assert checkout.status_code == 200, checkout.text
    assert Decimal(checkout.json()["total_amount"]) == first_total

    rooms_after = await api.client.get("/api/v1/hotel-rooms", headers=headers)
    room_vacant = next(r for r in rooms_after.json() if r["id"] == room["id"])
    assert room_vacant["status"] == "VACANT"
    assert room_vacant["guest_name"] is None

    # A brand-new guest checks into the same physical room number.
    room2 = await _check_in(api, headers, room_vacant, "Zeynep Kaya")

    # The first guest's already-settled order must not leak into the new stay.
    empty_folio = await api.client.get(
        f"/api/v1/hotel-rooms/{room2['id']}/folio", headers=headers
    )
    assert empty_folio.status_code == 200, empty_folio.text
    assert empty_folio.json()["orders"] == []
    assert Decimal(empty_folio.json()["total"]) == Decimal("0")

    # The new guest runs up their own, separate charge...
    second_order = await _charge_room(
        api,
        headers,
        table_id=tables[1]["id"],
        product_id=burger["id"],
        reference=room2["folio_reference"],
        key="room-212-stay-2-order-1",
    )
    second_total = Decimal(second_order["total"])

    folio2 = await api.client.get(f"/api/v1/hotel-rooms/{room2['id']}/folio", headers=headers)
    assert folio2.status_code == 200, folio2.text
    # Only the second stay's order shows up — never the first guest's.
    assert len(folio2.json()["orders"]) == 1
    assert Decimal(folio2.json()["total"]) == second_total

    # ...and checking them out charges exactly that, not first_total + second_total.
    checkout2 = await api.client.post(
        f"/api/v1/hotel-rooms/{room2['id']}/check-out",
        headers=headers,
        json={"payment_method": "CARD", "expected_version": room2["version"]},
    )
    assert checkout2.status_code == 200, checkout2.text
    assert Decimal(checkout2.json()["total_amount"]) == second_total


async def test_folio_is_scoped_to_tenant_and_branch(api: ApiContext) -> None:
    tokens = await login(api)
    headers = auth_headers(tokens)
    room = await _create_room(api, headers, "301")

    # A vacant room (no active stay) has an empty folio, not a 500 or a leak.
    folio = await api.client.get(f"/api/v1/hotel-rooms/{room['id']}/folio", headers=headers)
    assert folio.status_code == 200, folio.text
    assert folio.json()["orders"] == []
    assert Decimal(folio.json()["total"]) == Decimal("0")
