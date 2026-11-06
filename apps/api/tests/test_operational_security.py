from __future__ import annotations

from datetime import timedelta

import pytest
from sqlalchemy import select

from app.models import OperationGrant, User
from app.security import hash_password, utcnow
from tests.conftest import ApiContext, auth_headers, login, seeded_resources


@pytest.mark.parametrize("role_code", ["BUSINESS_OWNER", "BUSINESS_ADMIN", "BUSINESS_MANAGER"])
async def test_operation_pin_reauth_uses_only_current_account(
    api: ApiContext, role_code: str
) -> None:
    owner = await login(api)
    owner_headers = auth_headers(owner)
    username = "owner@dixora.test"
    if role_code != "BUSINESS_OWNER":
        roles = (await api.client.get("/api/v1/roles", headers=owner_headers)).json()
        role = next(role for role in roles if role["code"] == role_code)
        username = "panel-" + role_code.lower()
        created = await api.client.post(
            "/api/v1/users",
            headers=owner_headers,
            json={
                "username": username,
                "display_name": "Panel Manager",
                "role_id": role["id"],
                "branch_id": owner["user"]["branch_id"]
                if role_code == "BUSINESS_MANAGER"
                else None,
                "temporary_password": "Temporary!2026",
                "pin": "7246",
            },
        )
        assert created.status_code == 201, created.text
        headers = auth_headers(await login(api, username=username, password="Temporary!2026"))
    else:
        headers = owner_headers
        async with api.database.session_factory() as db:
            user = (await db.execute(select(User).where(User.username == username))).scalar_one()
            user.pin_hash = hash_password("7246")
            await db.commit()
    for credentials in [
        {"username": username, "pin": "9999"},
        {"username": "cashier@dixora.test", "pin": "1357"},
    ]:
        denied = await api.client.post(
            "/api/v1/auth/operation-grant",
            headers=headers,
            json={**credentials, "panel": "cashier"},
        )
        assert denied.status_code == 403, denied.text
    for panel in ["cashier", "waiter"]:
        granted = await api.client.post(
            "/api/v1/auth/operation-grant",
            headers=headers,
            json={"username": username, "pin": "7246", "panel": panel},
        )
        assert granted.status_code == 200, granted.text
        access = await api.client.get(
            f"/api/v1/auth/operation-access?panel={panel}", headers=headers
        )
        assert access.json()["mode"] == "support"
        other_session = auth_headers(
            await login(
                api,
                username=username,
                password="DixoraLab!2026" if role_code == "BUSINESS_OWNER" else "Temporary!2026",
            )
        )
        assert (
            await api.client.get(
                f"/api/v1/auth/operation-access?panel={panel}", headers=other_session
            )
        ).status_code == 403


async def test_operation_pin_requires_configured_pin_and_enabled_feature(api: ApiContext) -> None:
    headers = auth_headers(await login(api))
    for payload in [
        {"pin": "7246"},
        {"password": "DixoraLab!2026", "pin": "7246"},
        {},
        {"pin": "abc"},
    ]:
        result = await api.client.post(
            "/api/v1/auth/operation-grant",
            headers=headers,
            json={"username": "owner@dixora.test", "panel": "waiter", **payload},
        )
        assert result.status_code == (403 if payload == {"pin": "7246"} else 422), result.text
    async with api.database.session_factory() as db:
        user = (
            await db.execute(select(User).where(User.username == "owner@dixora.test"))
        ).scalar_one()
        user.pin_hash = hash_password("7246")
        await db.commit()
    api.settings.pin_login_enabled = False
    denied = await api.client.post(
        "/api/v1/auth/operation-grant",
        headers=headers,
        json={"username": "owner@dixora.test", "panel": "waiter", "pin": "7246"},
    )
    assert denied.status_code == 403


async def test_operation_pin_failures_are_rate_limited(api: ApiContext) -> None:
    headers = auth_headers(await login(api))
    payload = {"username": "owner@dixora.test", "pin": "9999", "panel": "waiter"}
    for _ in range(api.settings.login_rate_limit_attempts):
        result = await api.client.post(
            "/api/v1/auth/operation-grant", headers=headers, json=payload
        )
        assert result.status_code == 403, result.text
    blocked = await api.client.post("/api/v1/auth/operation-grant", headers=headers, json=payload)
    assert blocked.status_code == 429, blocked.text
    async with api.database.session_factory() as db:
        assert (await db.execute(select(OperationGrant))).scalars().all() == []


async def test_operation_reauth_is_self_scoped_and_cashier_is_observation_only(
    api: ApiContext,
) -> None:
    tokens = await login(api)
    headers = auth_headers(tokens)
    direct = await api.client.get("/api/v1/auth/operation-access?panel=cashier", headers=headers)
    assert direct.status_code == 403
    other = await api.client.post(
        "/api/v1/auth/operation-grant",
        headers=headers,
        json={
            "username": "cashier@dixora.test",
            "password": "DixoraLab!2026",
            "panel": "cashier",
        },
    )
    assert other.status_code == 403
    grant = await api.client.post(
        "/api/v1/auth/operation-grant",
        headers=headers,
        json={
            "username": "owner@dixora.test",
            "password": "DixoraLab!2026",
            "panel": "cashier",
        },
    )
    assert grant.status_code == 200, grant.text
    allowed = await api.client.get("/api/v1/auth/operation-access?panel=cashier", headers=headers)
    assert allowed.json()["mode"] == "support"
    wrong_panel = await api.client.get(
        "/api/v1/auth/operation-access?panel=waiter", headers=headers
    )
    assert wrong_panel.status_code == 403
    # Even a valid body cannot open another employee's shift in support mode.
    opening = await api.client.post(
        "/api/v1/shifts/open",
        headers=headers,
        json={
            "username": "cashier@dixora.test",
            "pin": "1357",
            "opening_cash": "100.00",
        },
    )
    assert opening.status_code == 403, opening.text
    other_session = auth_headers(await login(api))
    denied = await api.client.get(
        "/api/v1/auth/operation-access?panel=cashier", headers=other_session
    )
    assert denied.status_code == 403
    assert (
        await api.client.delete("/api/v1/auth/operation-grant", headers=headers)
    ).status_code == 204
    assert (
        await api.client.get("/api/v1/auth/operation-access?panel=cashier", headers=headers)
    ).status_code == 403


async def test_grant_expiry_and_normal_staff_access(api: ApiContext) -> None:
    owner = auth_headers(await login(api))
    await api.client.post(
        "/api/v1/auth/operation-grant",
        headers=owner,
        json={
            "username": "owner@dixora.test",
            "password": "DixoraLab!2026",
            "panel": "waiter",
        },
    )
    async with api.database.session_factory() as db:
        record = (await db.execute(select(OperationGrant))).scalar_one()
        record.expires_at = utcnow() - timedelta(seconds=1)
        await db.commit()
    assert (
        await api.client.get("/api/v1/auth/operation-access?panel=waiter", headers=owner)
    ).status_code == 403
    waiter = auth_headers(await login(api, username="waiter@dixora.test"))
    assert (
        await api.client.get("/api/v1/auth/operation-access?panel=waiter", headers=waiter)
    ).json()["mode"] == "staff"
    forbidden = await api.client.post(
        "/api/v1/auth/operation-grant",
        headers=waiter,
        json={
            "username": "waiter@dixora.test",
            "password": "DixoraLab!2026",
            "panel": "cashier",
        },
    )
    assert forbidden.status_code == 403


@pytest.mark.parametrize("code", ["*", "platform.support", "roles.manage", "unknown.permission"])
async def test_custom_roles_reject_protected_or_unknown_permissions(
    api: ApiContext, code: str
) -> None:
    result = await api.client.post(
        "/api/v1/roles",
        headers=auth_headers(await login(api)),
        json={
            "code": "LIMITED_WAITER",
            "name": "Sınırlı garson",
            "permission_codes": [code],
        },
    )
    assert result.status_code == 403, result.text


async def test_custom_waiter_role_assignment_revocation_and_no_payment(api: ApiContext) -> None:
    headers = auth_headers(await login(api))
    permissions = ["orders.create", "orders.read", "tables.read", "catalog.read"]
    role = await api.client.post(
        "/api/v1/roles",
        headers=headers,
        json={
            "code": "LIMITED_WAITER",
            "name": "Garson — Sınırlı",
            "permission_codes": permissions,
            "operational_profile": "WAITER",
        },
    )
    assert role.status_code == 201, role.text
    users = (await api.client.get("/api/v1/users", headers=headers)).json()
    waiter = next(user for user in users if user["username"] == "waiter@dixora.test")
    assigned = await api.client.patch(
        f"/api/v1/users/{waiter['id']}", headers=headers, json={"role_id": role.json()["id"]}
    )
    assert assigned.status_code == 200, assigned.text
    session = auth_headers(await login(api, username="waiter@dixora.test"))
    resources = await seeded_resources(api, headers)
    order = await api.client.post(
        "/api/v1/orders",
        headers=session,
        json={
            "table_id": resources["tables"][0]["id"],
            "idempotency_key": "limited-waiter-order",
            "items": [{"product_id": resources["burger"]["id"], "quantity": "1"}],
        },
    )
    assert order.status_code == 201, order.text
    payment = await api.client.post(
        f"/api/v1/orders/{order.json()['id']}/payments",
        headers=session,
        json={
            "method": "CASH",
            "amount": "1",
            "idempotency_key": "limited-waiter-pay",
        },
    )
    assert payment.status_code == 403
    in_use = await api.client.patch(
        f"/api/v1/roles/{role.json()['id']}", headers=headers, json={"is_active": False}
    )
    assert in_use.status_code == 409
    changed = await api.client.patch(
        f"/api/v1/roles/{role.json()['id']}",
        headers=headers,
        json={"permission_codes": ["tables.read"]},
    )
    assert changed.status_code == 200, changed.text
    assert (await api.client.get("/api/v1/orders", headers=session)).status_code == 403


async def test_custom_cashier_cannot_bypass_shift_requirement(api: ApiContext) -> None:
    headers = auth_headers(await login(api))
    role = await api.client.post(
        "/api/v1/roles",
        headers=headers,
        json={
            "code": "CUSTOM_TILL",
            "name": "Özel kasa",
            "operational_profile": "CASHIER",
            "permission_codes": ["payments.manage", "orders.read", "tables.read", "catalog.read"],
        },
    )
    assert role.status_code == 201, role.text
    users = (await api.client.get("/api/v1/users", headers=headers)).json()
    cashier = next(user for user in users if user["username"] == "cashier@dixora.test")
    assigned = await api.client.patch(
        f"/api/v1/users/{cashier['id']}", headers=headers, json={"role_id": role.json()["id"]}
    )
    assert assigned.status_code == 200, assigned.text
    resources = await seeded_resources(api, headers)
    order = await api.client.post(
        "/api/v1/orders",
        headers=headers,
        json={
            "table_id": resources["tables"][0]["id"],
            "idempotency_key": "custom-till-order",
            "items": [{"product_id": resources["burger"]["id"], "quantity": "1"}],
        },
    )
    session = auth_headers(await login(api, username="cashier@dixora.test"))
    payment = await api.client.post(
        f"/api/v1/orders/{order.json()['id']}/payments",
        headers=session,
        json={
            "method": "CASH",
            "amount": "1.00",
            "idempotency_key": "custom-till-payment",
        },
    )
    assert payment.status_code == 409, payment.text
    assert payment.json()["error"]["code"] == "cashier_shift_required"


async def test_custom_roles_cannot_restore_retired_kitchen_profile(api: ApiContext) -> None:
    headers = auth_headers(await login(api))
    role = await api.client.post(
        "/api/v1/roles",
        headers=headers,
        json={
            "code": "CUSTOM_KITCHEN",
            "name": "Eski hazırlık profili",
            "operational_profile": "KITCHEN",
            "permission_codes": ["kitchen.read", "kitchen.manage"],
        },
    )
    assert role.status_code == 422, role.text
