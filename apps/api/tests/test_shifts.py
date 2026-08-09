from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from sqlalchemy import select

from app.models import Role, User
from app.security import hash_password
from tests.conftest import ApiContext, auth_headers, login, seeded_resources
from tests.test_orders import _create_burger_order
from tests.test_tenant_isolation import _create_tenant_b


async def _create_second_cashier(api: ApiContext, tenant_id: UUID, branch_id: UUID) -> dict:
    async with api.database.session_factory() as db:
        role = (
            await db.execute(
                select(Role).where(Role.tenant_id == tenant_id, Role.code == "CASHIER")
            )
        ).scalar_one()
        user = User(
            tenant_id=tenant_id,
            branch_id=branch_id,
            role_id=role.id,
            username="cashier2@dixora.test",
            email="cashier2@dixora.test",
            display_name="İkinci Kasiyer",
            password_hash=hash_password("Cashier2!2026"),
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        return {
            "id": str(user.id),
            "username": user.username,
            "password": "Cashier2!2026",
            "display_name": user.display_name,
        }


async def test_cashier_shift_open_current_close_and_history(api: ApiContext) -> None:
    cashier = await login(api, username="cashier@dixora.test")
    headers = auth_headers(cashier)
    opened = await api.client.post(
        "/api/v1/shifts/open",
        headers=headers,
        json={"cashier_name": "Ahmet", "opening_cash": "500.00", "note": "Kasa sayıldı"},
    )
    assert opened.status_code == 201, opened.text
    assert opened.json()["cashier_name"] == "Ahmet"
    assert opened.json()["opening_note"] == "Kasa sayıldı"
    current = await api.client.get("/api/v1/shifts/current", headers=headers)
    assert current.status_code == 200
    assert current.json()["id"] == opened.json()["id"]
    closed = await api.client.post(
        f"/api/v1/shifts/{opened.json()['id']}/close",
        headers=headers,
        json={"closing_cash": "500.00", "note": "Balanced"},
    )
    assert closed.status_code == 200, closed.text
    assert closed.json()["status"] == "CLOSED"
    assert closed.json()["cash_variance"] == "0.00"
    history = await api.client.get("/api/v1/shifts/history", headers=headers)
    assert history.status_code == 200
    assert history.json()[0]["id"] == opened.json()["id"]


async def test_shift_open_requires_a_cashier_name(api: ApiContext) -> None:
    cashier = await login(api, username="cashier@dixora.test")
    headers = auth_headers(cashier)
    missing_name = await api.client.post(
        "/api/v1/shifts/open", headers=headers, json={"opening_cash": "100.00"}
    )
    assert missing_name.status_code == 422
    blank_name = await api.client.post(
        "/api/v1/shifts/open",
        headers=headers,
        json={"cashier_name": "A", "opening_cash": "100.00"},
    )
    assert blank_name.status_code == 422


async def test_shift_cannot_open_twice_for_same_cashier(api: ApiContext) -> None:
    cashier = await login(api, username="cashier@dixora.test")
    headers = auth_headers(cashier)
    first = await api.client.post(
        "/api/v1/shifts/open",
        headers=headers,
        json={"cashier_name": "Ahmet", "opening_cash": "100.00"},
    )
    assert first.status_code == 201, first.text
    conflict = await api.client.post(
        "/api/v1/shifts/open",
        headers=headers,
        json={"cashier_name": "Ahmet", "opening_cash": "50.00"},
    )
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "shift_already_open"


async def test_shift_close_is_idempotent_and_does_not_recompute(api: ApiContext) -> None:
    cashier = await login(api, username="cashier@dixora.test")
    headers = auth_headers(cashier)
    opened = await api.client.post(
        "/api/v1/shifts/open",
        headers=headers,
        json={"cashier_name": "Ahmet", "opening_cash": "200.00"},
    )
    shift_id = opened.json()["id"]
    first_close = await api.client.post(
        f"/api/v1/shifts/{shift_id}/close",
        headers=headers,
        json={"closing_cash": "200.00", "note": "First close"},
    )
    assert first_close.status_code == 200, first_close.text
    second_close = await api.client.post(
        f"/api/v1/shifts/{shift_id}/close",
        headers=headers,
        # Different payload — must NOT be applied since the shift is already closed.
        json={"closing_cash": "999.00", "note": "Should not apply"},
    )
    assert second_close.status_code == 200, second_close.text
    assert second_close.json()["closing_cash"] == "200.00"
    assert second_close.json()["closing_note"] == "First close"


async def test_shift_expected_cash_and_counted_cash_variance(api: ApiContext) -> None:
    cashier = await login(api, username="cashier@dixora.test")
    headers = auth_headers(cashier)
    resources = await seeded_resources(api, headers)
    opened = await api.client.post(
        "/api/v1/shifts/open",
        headers=headers,
        json={"cashier_name": "Ahmet", "opening_cash": "1500.00"},
    )
    assert opened.status_code == 201, opened.text

    order = await _create_burger_order(
        api,
        headers,
        table_id=resources["tables"][11]["id"],
        product_id=resources["burger"]["id"],
        key="shift-cash-order-key-0001",
    )
    cash_payment = await api.client.post(
        f"/api/v1/orders/{order['id']}/payments",
        headers=headers,
        json={"method": "CASH", "amount": "200.00", "idempotency_key": "shift-pay-cash-0001"},
    )
    assert cash_payment.status_code == 201, cash_payment.text
    card_payment = await api.client.post(
        f"/api/v1/orders/{order['id']}/payments",
        headers=headers,
        json={"method": "CARD", "amount": "160.00", "idempotency_key": "shift-pay-card-0001"},
    )
    assert card_payment.status_code == 201, card_payment.text

    # Expected cash = opening (1500) + cash sales (200) = 1700; count 1650 -> variance -50.
    closed = await api.client.post(
        f"/api/v1/shifts/{opened.json()['id']}/close",
        headers=headers,
        json={"closing_cash": "1650.00", "note": "50 TL eksik"},
    )
    assert closed.status_code == 200, closed.text
    body = closed.json()
    assert Decimal(body["cash_sales"]) == Decimal("200.00")
    assert Decimal(body["card_sales"]) == Decimal("160.00")
    assert Decimal(body["total_sales"]) == Decimal("360.00")
    assert Decimal(body["cash_variance"]) == Decimal("-50.00")


async def test_shift_handoff_closes_current_and_opens_successor_on_same_login(
    api: ApiContext,
) -> None:
    """Handoff stays on the same authenticated login (cafes commonly share one
    terminal account) — only the typed cashier_name changes hands."""
    cashier = await login(api, username="cashier@dixora.test")
    headers = auth_headers(cashier)
    opened = await api.client.post(
        "/api/v1/shifts/open",
        headers=headers,
        json={"cashier_name": "Ahmet", "opening_cash": "1000.00"},
    )
    shift_id = opened.json()["id"]

    handoff = await api.client.post(
        f"/api/v1/shifts/{shift_id}/handoff",
        headers=headers,
        json={
            "counted_cash": "950.00",
            "next_cashier_name": "Zeynep",
            "note": "Vardiya devri",
        },
    )
    assert handoff.status_code == 200, handoff.text
    body = handoff.json()
    assert body["closed"]["id"] == shift_id
    assert body["closed"]["status"] == "CLOSED"
    assert body["closed"]["closing_cash"] == "950.00"
    assert body["closed"]["cashier_name"] == "Ahmet"
    assert body["opened"]["predecessor_shift_id"] == shift_id
    assert body["opened"]["opening_cash"] == "950.00"
    assert body["opened"]["status"] == "OPEN"
    assert body["opened"]["cashier_name"] == "Zeynep"
    assert body["opened"]["user_id"] == body["closed"]["user_id"]

    current = await api.client.get("/api/v1/shifts/current", headers=headers)
    assert current.status_code == 200
    assert current.json()["id"] == body["opened"]["id"]
    assert current.json()["cashier_name"] == "Zeynep"

    # Idempotent replay: same result, no duplicate successor shift.
    replay = await api.client.post(
        f"/api/v1/shifts/{shift_id}/handoff",
        headers=headers,
        json={"counted_cash": "1.00", "next_cashier_name": "Someone Else"},
    )
    assert replay.status_code == 200, replay.text
    assert replay.json()["opened"]["id"] == body["opened"]["id"]
    assert replay.json()["opened"]["cashier_name"] == "Zeynep"
    assert replay.json()["closed"]["closing_cash"] == "950.00"


async def test_shift_handoff_requires_a_next_cashier_name(api: ApiContext) -> None:
    cashier = await login(api, username="cashier@dixora.test")
    headers = auth_headers(cashier)
    opened = await api.client.post(
        "/api/v1/shifts/open",
        headers=headers,
        json={"cashier_name": "Ahmet", "opening_cash": "100.00"},
    )
    shift_id = opened.json()["id"]

    missing_name = await api.client.post(
        f"/api/v1/shifts/{shift_id}/handoff",
        headers=headers,
        json={"counted_cash": "100.00"},
    )
    assert missing_name.status_code == 422


async def test_shift_handoff_on_already_closed_shift_without_handoff_conflicts(
    api: ApiContext,
) -> None:
    cashier = await login(api, username="cashier@dixora.test")
    headers = auth_headers(cashier)
    opened = await api.client.post(
        "/api/v1/shifts/open",
        headers=headers,
        json={"cashier_name": "Ahmet", "opening_cash": "100.00"},
    )
    shift_id = opened.json()["id"]
    plain_close = await api.client.post(
        f"/api/v1/shifts/{shift_id}/close", headers=headers, json={"closing_cash": "100.00"}
    )
    assert plain_close.status_code == 200, plain_close.text

    handoff_after_plain_close = await api.client.post(
        f"/api/v1/shifts/{shift_id}/handoff",
        headers=headers,
        json={"counted_cash": "100.00", "next_cashier_name": "Zeynep"},
    )
    assert handoff_after_plain_close.status_code == 409
    assert handoff_after_plain_close.json()["error"]["code"] == "shift_already_closed"


async def test_shift_is_tenant_and_branch_scoped(api: ApiContext) -> None:
    other = await _create_tenant_b(api)
    _ = other
    cashier_headers = auth_headers(await login(api, username="cashier@dixora.test"))
    opened = await api.client.post(
        "/api/v1/shifts/open",
        headers=cashier_headers,
        json={"cashier_name": "Ahmet", "opening_cash": "10.00"},
    )
    shift_id = opened.json()["id"]

    other_owner_headers = auth_headers(
        await login(
            api,
            username="owner@other.test",
            password="Other!2026",
            business="other-restaurant",
        )
    )
    cross_tenant_close = await api.client.post(
        f"/api/v1/shifts/{shift_id}/close",
        headers=other_owner_headers,
        json={"closing_cash": "10.00"},
    )
    assert cross_tenant_close.status_code == 404

    close = await api.client.post(
        f"/api/v1/shifts/{shift_id}/close", headers=cashier_headers, json={"closing_cash": "10.00"}
    )
    assert close.status_code == 200, close.text


async def test_shift_history_scopes_cashier_to_own_shifts(api: ApiContext) -> None:
    owner = await login(api)
    owner_headers = auth_headers(owner)
    tenant_id = UUID(owner["user"]["tenant_id"])
    branch_id = UUID(owner["user"]["branch_id"])
    second = await _create_second_cashier(api, tenant_id, branch_id)
    second_headers = auth_headers(
        await login(api, username=second["username"], password=second["password"])
    )
    opened = await api.client.post(
        "/api/v1/shifts/open",
        headers=second_headers,
        json={"cashier_name": "İkinci Kasiyer", "opening_cash": "20.00"},
    )
    assert opened.status_code == 201, opened.text

    cashier_headers = auth_headers(await login(api, username="cashier@dixora.test"))
    cashier_history = await api.client.get("/api/v1/shifts/history", headers=cashier_headers)
    assert cashier_history.status_code == 200
    assert all(row["user_id"] != second["id"] for row in cashier_history.json()), (
        "CASHIER role must not see another cashier's shift history"
    )

    owner_history = await api.client.get(
        "/api/v1/shifts/history", headers=owner_headers, params={"user_id": second["id"]}
    )
    assert owner_history.status_code == 200
    assert any(row["id"] == opened.json()["id"] for row in owner_history.json())
