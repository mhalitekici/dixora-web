from __future__ import annotations

from uuid import uuid4

from tests.conftest import ApiContext, auth_headers, login


async def test_tenant_scoped_user_role_branch_and_subscription_management(
    api: ApiContext,
) -> None:
    owner = await login(api)
    headers = auth_headers(owner)
    roles = await api.client.get("/api/v1/roles", headers=headers)
    branches = await api.client.get("/api/v1/branches", headers=headers)
    assert roles.status_code == 200
    assert branches.status_code == 200
    waiter_role = next(role for role in roles.json() if role["code"] == "WAITER")
    branch = branches.json()[0]
    created = await api.client.post(
        "/api/v1/users",
        headers=headers,
        json={
            "username": "new-waiter@dixora.test",
            "email": "new-waiter@dixora.test",
            "display_name": "New Waiter",
            "role_id": waiter_role["id"],
            "branch_id": branch["id"],
            "temporary_password": "Temporary!2026",
            "pin": "9876",
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["role"] == "WAITER"
    assert created.json()["has_pin"] is True

    invalid_create_pin = await api.client.post(
        "/api/v1/users",
        headers=headers,
        json={
            "username": "invalid-pin@dixora.test",
            "email": "invalid-pin@dixora.test",
            "display_name": "Invalid PIN",
            "role_id": waiter_role["id"],
            "branch_id": branch["id"],
            "temporary_password": "Temporary!2026",
            "pin": "abcd",
        },
    )
    assert invalid_create_pin.status_code == 422

    invalid_changed_pin = await api.client.put(
        f"/api/v1/users/{created.json()['id']}/pin",
        headers=headers,
        json={"pin": "12ab"},
    )
    assert invalid_changed_pin.status_code == 422

    removed_pin = await api.client.put(
        f"/api/v1/users/{created.json()['id']}/pin",
        headers=headers,
        json={"pin": None},
    )
    assert removed_pin.status_code == 204, removed_pin.text
    users = await api.client.get("/api/v1/users", headers=headers)
    assert users.status_code == 200, users.text
    refreshed = next(user for user in users.json() if user["id"] == created.json()["id"])
    assert refreshed["has_pin"] is False
    subscription = await api.client.get("/api/v1/subscriptions/current", headers=headers)
    feature = await api.client.get("/api/v1/subscriptions/features/QR_ORDERING", headers=headers)
    assert subscription.status_code == 200
    assert feature.status_code == 200
    assert feature.json()["enabled"] is True


async def test_owner_can_update_safe_business_settings_but_not_platform_state(
    api: ApiContext,
) -> None:
    owner = await login(api)
    headers = auth_headers(owner)
    businesses = await api.client.get("/api/v1/businesses", headers=headers)
    assert businesses.status_code == 200, businesses.text
    business = businesses.json()["items"][0]

    updated = await api.client.patch(
        f"/api/v1/businesses/{business['id']}",
        headers=headers,
        json={
            "name": "Dixora İşletmeleri",
            "default_currency": "EUR",
            "prevent_negative_stock": False,
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["name"] == "Dixora İşletmeleri"
    assert updated.json()["default_currency"] == "EUR"
    assert updated.json()["prevent_negative_stock"] is False

    forbidden = await api.client.patch(
        f"/api/v1/businesses/{business['id']}",
        headers=headers,
        json={"state": "SUSPENDED"},
    )
    assert forbidden.status_code == 403, forbidden.text
    assert forbidden.json()["error"]["code"] == "platform_fields_forbidden"


async def test_cashier_is_assignable_when_adding_an_employee(
    api: ApiContext,
) -> None:
    """A till operator could not be created: CASHIER was missing from the
    assignable presets, so the admin form offered no such option."""
    headers = auth_headers(await login(api))
    response = await api.client.get("/api/v1/roles", headers=headers)
    assert response.status_code == 200, response.text
    codes = {role["code"] for role in response.json()}
    assert {"BUSINESS_MANAGER", "CASHIER", "WAITER"} <= codes


async def test_an_employee_can_be_created_as_a_cashier(api: ApiContext) -> None:
    headers = auth_headers(await login(api))
    roles = (await api.client.get("/api/v1/roles", headers=headers)).json()
    cashier_role = next(role for role in roles if role["code"] == "CASHIER")
    branches = (await api.client.get("/api/v1/branches", headers=headers)).json()

    created = await api.client.post(
        "/api/v1/users",
        headers=headers,
        json={
            "username": f"kasa{uuid4().hex[:6]}",
            "display_name": "Kasa Halit",
            "role_id": cashier_role["id"],
            "branch_id": branches[0]["id"],
            "temporary_password": "Kasa-Guvenli!2026",
        },
    )
    assert created.status_code == 201, created.text
    # `role` carries the code, which is what drives routing and permissions.
    assert created.json()["role"] == "CASHIER"
    assert created.json()["role_id"] == cashier_role["id"]
    # The human-facing name is repaired to Turkish for the admin dropdown.
    assert cashier_role["name"] == "Kasiyer"
