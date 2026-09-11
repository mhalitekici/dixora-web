from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select

from app.models import AuditLog, Branch, Payment, Role, User
from app.security import hash_password
from app.services.cashier_reconciliation import business_window
from tests.conftest import ApiContext, auth_headers, login, seeded_resources
from tests.test_orders import _create_burger_order

CASHIER = {"username": "cashier@dixora.test", "pin": "1357"}


def test_business_window_uses_branch_timezone_not_server_utc() -> None:
    business_date, start, end = business_window("Europe/Istanbul", date(2026, 9, 10))
    assert business_date == date(2026, 9, 10)
    assert start == datetime(2026, 9, 9, 21, 0, tzinfo=UTC)
    assert end.date() == date(2026, 9, 10)


async def _cashier_headers(api: ApiContext) -> dict[str, str]:
    return auth_headers(await login(api, username=CASHIER["username"]))


async def _manager_pin(api: ApiContext, pin: str = "8642") -> None:
    async with api.database.session_factory() as db:
        manager = (
            await db.execute(select(User).where(User.username == "manager@dixora.test"))
        ).scalar_one()
        manager.pin_hash = hash_password(pin)
        await db.commit()


async def _open(api: ApiContext, headers: dict[str, str], amount: str = "0.00") -> dict:
    response = await api.client.post(
        "/api/v1/shifts/open",
        headers=headers,
        json={**CASHIER, "opening_cash": amount, "note": "Sayım tamam"},
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _close(
    api: ApiContext,
    headers: dict[str, str],
    shift_id: str,
    amount: str,
    card: str | None = None,
) -> dict:
    payload = {**CASHIER, "closing_cash": amount, "note": "Kapanış sayımı"}
    if card is not None:
        payload["reported_card_total"] = card
    response = await api.client.post(
        f"/api/v1/shifts/{shift_id}/close",
        headers=headers,
        json=payload,
    )
    assert response.status_code == 200, response.text
    return response.json()


async def test_staff_pin_verification_enforces_credentials_status_branch_and_permission(
    api: ApiContext,
) -> None:
    headers = await _cashier_headers(api)
    valid = await api.client.post("/api/v1/shifts/verify", headers=headers, json=CASHIER)
    assert valid.status_code == 200
    assert valid.json()["display_name"] == "Kasa Kullanıcısı"

    wrong = await api.client.post(
        "/api/v1/shifts/verify", headers=headers, json={**CASHIER, "pin": "9999"}
    )
    assert wrong.status_code == 401
    waiter = await api.client.post(
        "/api/v1/shifts/verify",
        headers=headers,
        json={"username": "waiter@dixora.test", "pin": "2468"},
    )
    assert waiter.status_code == 403
    assert waiter.json()["error"]["code"] == "staff_permission_required"

    async with api.database.session_factory() as db:
        cashier = (
            await db.execute(select(User).where(User.username == CASHIER["username"]))
        ).scalar_one()
        cashier.is_active = False
        await db.commit()
    disabled = await api.client.post("/api/v1/shifts/verify", headers=headers, json=CASHIER)
    assert disabled.status_code == 401


async def test_shift_open_allows_zero_prevents_duplicates_and_audits(api: ApiContext) -> None:
    headers = await _cashier_headers(api)
    opened = await _open(api, headers)
    assert opened["opening_cash"] == "0.00"
    assert opened["cashier_name"] == "Kasa Kullanıcısı"
    assert opened["opened_by_user_id"] == opened["user_id"]
    duplicate = await api.client.post(
        "/api/v1/shifts/open", headers=headers, json={**CASHIER, "opening_cash": "10.00"}
    )
    assert duplicate.status_code == 409
    async with api.database.session_factory() as db:
        audit = (
            await db.execute(select(AuditLog).where(AuditLog.action == "shift.opened"))
        ).scalar_one()
        assert audit.new_value["cashier_user_id"] == opened["user_id"]


async def test_cashier_payment_requires_and_is_attributed_to_current_shift(api: ApiContext) -> None:
    headers = await _cashier_headers(api)
    resources = await seeded_resources(api, headers)
    order = await _create_burger_order(
        api,
        headers,
        table_id=resources["tables"][11]["id"],
        product_id=resources["burger"]["id"],
        key="shift-required-order-0001",
    )
    blocked = await api.client.post(
        f"/api/v1/orders/{order['id']}/payments",
        headers=headers,
        json={"method": "CASH", "amount": "10.00", "idempotency_key": "shift-required-pay-0001"},
    )
    assert blocked.status_code == 409
    shift = await _open(api, headers, "100.00")
    paid = await api.client.post(
        f"/api/v1/orders/{order['id']}/payments",
        headers=headers,
        json={"method": "CASH", "amount": "10.01", "idempotency_key": "shift-attached-pay-0001"},
    )
    assert paid.status_code == 201, paid.text
    assert paid.json()["shift_id"] == shift["id"]
    async with api.database.session_factory() as db:
        payment = await db.get(Payment, UUID(paid.json()["id"]))
        assert payment is not None and payment.branch_id == UUID(shift["branch_id"])


async def test_shift_expected_cash_refunds_and_decimal_variance(api: ApiContext) -> None:
    headers = await _cashier_headers(api)
    resources = await seeded_resources(api, headers)
    shift = await _open(api, headers, "1500.10")
    order = await _create_burger_order(
        api,
        headers,
        table_id=resources["tables"][11]["id"],
        product_id=resources["burger"]["id"],
        key="shift-totals-order-0001",
    )
    cash = await api.client.post(
        f"/api/v1/orders/{order['id']}/payments",
        headers=headers,
        json={"method": "CASH", "amount": "200.05", "idempotency_key": "shift-cash-pay-0001"},
    )
    card = await api.client.post(
        f"/api/v1/orders/{order['id']}/payments",
        headers=headers,
        json={"method": "CARD", "amount": "159.95", "idempotency_key": "shift-card-pay-0001"},
    )
    assert cash.status_code == card.status_code == 201
    refunded = await api.client.post(
        f"/api/v1/orders/{order['id']}/payments/{cash.json()['id']}/refund",
        headers=headers,
        json={"reason": "Müşteri iadesi"},
    )
    assert refunded.status_code == 200, refunded.text
    current = await api.client.get("/api/v1/shifts/current", headers=headers)
    assert Decimal(current.json()["expected_cash"]) == Decimal("1500.10")
    assert Decimal(current.json()["card_sales"]) == Decimal("159.95")
    closed = await _close(api, headers, shift["id"], "1500.09", "160.00")
    assert Decimal(closed["cash_refunds"]) == Decimal("200.05")
    assert Decimal(closed["cash_variance"]) == Decimal("-0.01")
    assert Decimal(closed["reported_card_total"]) == Decimal("160.00")
    assert Decimal(closed["card_variance"]) == Decimal("0.05")
    again = await api.client.post(
        f"/api/v1/shifts/{shift['id']}/close",
        headers=headers,
        json={**CASHIER, "closing_cash": "0"},
    )
    assert again.status_code == 409


async def test_handoff_requires_both_employees_and_explicit_opening_cash(api: ApiContext) -> None:
    headers = await _cashier_headers(api)
    shift = await _open(api, headers, "50.00")
    async with api.database.session_factory() as db:
        cashier = (
            await db.execute(select(User).where(User.username == CASHIER["username"]))
        ).scalar_one()
        role = (
            await db.execute(
                select(Role).where(Role.tenant_id == cashier.tenant_id, Role.code == "CASHIER")
            )
        ).scalar_one()
        next_user = User(
            tenant_id=cashier.tenant_id,
            branch_id=cashier.branch_id,
            role_id=role.id,
            username="next.cashier",
            display_name="Yeni Kasiyer",
            password_hash=hash_password("unused-password"),
            pin_hash=hash_password("9753"),
        )
        db.add(next_user)
        await db.commit()
    handoff = await api.client.post(
        f"/api/v1/shifts/{shift['id']}/handoff",
        headers=headers,
        json={
            **CASHIER,
            "closing_cash": "49.00",
            "reported_card_total": "0.00",
            "next_username": "next.cashier",
            "next_pin": "9753",
            "next_opening_cash": "45.00",
        },
    )
    assert handoff.status_code == 200, handoff.text
    assert handoff.json()["opened"]["cashier_name"] == "Yeni Kasiyer"
    assert handoff.json()["opened"]["opening_cash"] == "45.00"
    assert handoff.json()["closed"]["reported_card_total"] == "0.00"
    next_headers = auth_headers(
        await login(api, username="next.cashier", password="unused-password")
    )
    current = await api.client.get("/api/v1/shifts/current", headers=next_headers)
    assert current.status_code == 200
    assert current.json()["id"] == handoff.json()["opened"]["id"]


async def test_business_day_close_blocks_open_shift_and_is_unique(api: ApiContext) -> None:
    await _manager_pin(api)
    cashier_headers = await _cashier_headers(api)
    shift = await _open(api, cashier_headers, "100.00")
    resources = await seeded_resources(api, cashier_headers)
    order = await _create_burger_order(
        api,
        cashier_headers,
        table_id=resources["tables"][11]["id"],
        product_id=resources["burger"]["id"],
        key="day-close-order-0001",
    )
    for method, amount, key in (
        ("CASH", "10.00", "day-close-cash-0001"),
        ("CARD", "20.00", "day-close-card-0001"),
    ):
        payment = await api.client.post(
            f"/api/v1/orders/{order['id']}/payments",
            headers=cashier_headers,
            json={"method": method, "amount": amount, "idempotency_key": key},
        )
        assert payment.status_code == 201, payment.text
    manager_headers = auth_headers(await login(api, username="manager@dixora.test"))
    payload = {
        "username": "manager@dixora.test",
        "pin": "8642",
        "counted_cash": "110.00",
        "reported_card_total": "20.00",
        "note": "Fiziksel Z kontrol edildi",
    }
    cashier_denied = await api.client.post(
        "/api/v1/shifts/business-day-close",
        headers=cashier_headers,
        json={**payload, **CASHIER},
    )
    assert cashier_denied.status_code == 403
    blocked = await api.client.post(
        "/api/v1/shifts/business-day-close", headers=manager_headers, json=payload
    )
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "open_shifts_exist"
    manager_close = await api.client.post(
        f"/api/v1/shifts/{shift['id']}/close",
        headers=manager_headers,
        json={
            "username": "manager@dixora.test",
            "pin": "8642",
            "closing_cash": "110.00",
            "reported_card_total": "20.00",
        },
    )
    assert manager_close.status_code == 200, manager_close.text
    assert manager_close.json()["closed_by_display_name"] == "Şube Yöneticisi"
    assert manager_close.json()["card_variance"] == "0.00"
    closed = await api.client.post(
        "/api/v1/shifts/business-day-close", headers=manager_headers, json=payload
    )
    assert closed.status_code == 201, closed.text
    assert closed.json()["system_cash_total"] == "10.00"
    assert closed.json()["system_card_total"] == "20.00"
    assert closed.json()["expected_cash"] == "110.00"
    assert closed.json()["cash_difference"] == "0.00"
    assert closed.json()["card_difference"] == "0.00"
    duplicate = await api.client.post(
        "/api/v1/shifts/business-day-close", headers=manager_headers, json=payload
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "already_closed"
    history = await api.client.get("/api/v1/shifts/day/history", headers=manager_headers)
    assert history.status_code == 200
    assert history.json()[0]["id"] == closed.json()["id"]


async def test_wrong_branch_employee_is_rejected(api: ApiContext) -> None:
    headers = await _cashier_headers(api)
    async with api.database.session_factory() as db:
        cashier = (
            await db.execute(select(User).where(User.username == CASHIER["username"]))
        ).scalar_one()
        role = (
            await db.execute(
                select(Role).where(Role.tenant_id == cashier.tenant_id, Role.code == "CASHIER")
            )
        ).scalar_one()
        branch = Branch(
            tenant_id=cashier.tenant_id, name="Other", slug="other", timezone="Europe/Istanbul"
        )
        db.add(branch)
        await db.flush()
        outsider = User(
            tenant_id=cashier.tenant_id,
            branch_id=branch.id,
            role_id=role.id,
            username="other.cashier",
            display_name="Other Cashier",
            password_hash=hash_password("unused-password"),
            pin_hash=hash_password("1122"),
        )
        db.add(outsider)
        await db.commit()
    response = await api.client.post(
        "/api/v1/shifts/verify", headers=headers, json={"username": "other.cashier", "pin": "1122"}
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "staff_branch_forbidden"
