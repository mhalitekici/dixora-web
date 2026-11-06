from __future__ import annotations

from uuid import UUID

import pytest
from sqlalchemy import select

from app.models import User
from app.security import hash_password
from tests.conftest import ApiContext, auth_headers, login, seeded_resources
from tests.test_orders import _create_burger_order


@pytest.mark.parametrize("role_code", ["BUSINESS_OWNER", "BUSINESS_ADMIN", "BUSINESS_MANAGER"])
async def test_manager_owns_shift_and_payments_without_adopting_cashier(
    api: ApiContext, role_code: str
) -> None:
    owner = await login(api)
    headers = auth_headers(owner)
    # Legacy tills may have been opened through the owner session. Preserve it.
    cashier = await api.client.post(
        "/api/v1/shifts/open",
        headers=headers,
        json={"username": "cashier@dixora.test", "pin": "1357", "opening_cash": "50"},
    )
    assert cashier.status_code == 201, cashier.text
    original = cashier.json()
    username = "owner@dixora.test"
    if role_code == "BUSINESS_OWNER":
        async with api.database.session_factory() as db:
            user = await db.get(User, UUID(owner["user"]["id"]))
            user.pin_hash = hash_password("7246")
            await db.commit()
    else:
        roles = (await api.client.get("/api/v1/roles", headers=headers)).json()
        role = next(r for r in roles if r["code"] == role_code)
        username = "panel-" + role_code.lower()
        created = await api.client.post(
            "/api/v1/users",
            headers=headers,
            json={
                "username": username,
                "display_name": "Panel Employee",
                "role_id": role["id"],
                "branch_id": owner["user"]["branch_id"]
                if role_code == "BUSINESS_MANAGER"
                else None,
                "temporary_password": "Temporary!2026",
                "pin": "7246",
            },
        )
        assert created.status_code == 201, created.text
    authenticated = await api.client.post(
        "/api/v1/auth/panel-login", headers=headers, json={"username": username, "pin": "7246"}
    )
    assert authenticated.status_code == 200, authenticated.text
    manager = auth_headers(authenticated.json())
    manager_id = authenticated.json()["user"]["id"]
    assert authenticated.json()["user"]["username"] == username
    assert (await api.client.get("/api/v1/auth/operation-options", headers=manager)).json()["ready"]
    selected = await api.client.post(
        "/api/v1/auth/operation-select", headers=manager, json={"panel": "cashier"}
    )
    assert selected.status_code == 200, selected.text
    assert (await api.client.get("/api/v1/shifts/current", headers=manager)).json() is None
    resources = await seeded_resources(api, manager)
    order = await _create_burger_order(
        api,
        manager,
        table_id=resources["tables"][0]["id"],
        product_id=resources["burger"]["id"],
        key="manager-panel",
    )
    payment_payload = {
        "method": "CASH",
        "amount": order["total"],
        "idempotency_key": "panel-payment",
    }
    missing = await api.client.post(
        f"/api/v1/orders/{order['id']}/payments", headers=manager, json=payment_payload
    )
    assert missing.status_code == 409, missing.text
    own = await api.client.post(
        "/api/v1/shifts/open-own", headers=manager, json={"opening_cash": "100"}
    )
    assert own.status_code == 201, own.text
    own = own.json()
    assert own["user_id"] == manager_id and own["id"] != original["id"]
    duplicate = await api.client.post(
        "/api/v1/shifts/open-own", headers=manager, json={"opening_cash": "0"}
    )
    assert duplicate.status_code == 409
    paid = await api.client.post(
        f"/api/v1/orders/{order['id']}/payments", headers=manager, json=payment_payload
    )
    assert paid.status_code == 201, paid.text
    assert paid.json()["shift_id"] == own["id"]
    foreign = await api.client.post(
        f"/api/v1/shifts/{original['id']}/close",
        headers=manager,
        json={"username": username, "pin": "7246", "closing_cash": "50"},
    )
    assert foreign.status_code == 403
    untouched = (await api.client.get(f"/api/v1/shifts/{original['id']}", headers=headers)).json()
    assert untouched == original
    current = (await api.client.get("/api/v1/shifts/current", headers=manager)).json()
    assert current["id"] == own["id"] and current["cash_sales"] == order["total"]


async def test_employee_pin_login_opens_panel_choice_and_wrong_credentials_do_not(
    api: ApiContext,
) -> None:
    enrollment = await api.client.post(
        "/api/v1/auth/login",
        json={
            "business": "dixora-lab",
            "username": "owner@dixora.test",
            "password": "DixoraLab!2026",
            "enroll_trusted_device": True,
        },
    )
    async with api.database.session_factory() as db:
        user = (
            await db.execute(select(User).where(User.username == "manager@dixora.test"))
        ).scalar_one()
        user.pin_hash = hash_password("7246")
        await db.commit()
    authenticated = await api.client.post(
        "/api/v1/auth/pin-login",
        json={
            "business_slug": "dixora-lab",
            "branch_slug": "merkez",
            "username": "manager@dixora.test",
            "pin": "7246",
            "device_token": enrollment.json()["trusted_device"]["token"],
        },
    )
    assert authenticated.status_code == 200, authenticated.text
    headers = auth_headers(authenticated.json())
    assert (await api.client.get("/api/v1/auth/operation-options", headers=headers)).json()["ready"]
    assert (
        await api.client.post(
            "/api/v1/auth/operation-select", headers=headers, json={"panel": "waiter"}
        )
    ).status_code == 200
    assert (
        await api.client.get("/api/v1/auth/operation-access?panel=waiter", headers=headers)
    ).json()["mode"] == "operator"
    denied = await api.client.post(
        "/api/v1/auth/panel-login",
        headers=headers,
        json={"username": "manager@dixora.test", "pin": "9999"},
    )
    assert denied.status_code == 403
    staff = await api.client.post(
        "/api/v1/auth/panel-login",
        headers=headers,
        json={"username": "cashier@dixora.test", "pin": "1357"},
    )
    assert staff.status_code == 403
    password_session = auth_headers(await login(api))
    assert (
        await api.client.post(
            "/api/v1/auth/operation-select", headers=password_session, json={"panel": "cashier"}
        )
    ).status_code == 403
