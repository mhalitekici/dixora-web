from __future__ import annotations

from uuid import UUID

from sqlalchemy import select

from app.models import Role, Subscription, SubscriptionPlan
from app.rbac import ensure_role
from tests.conftest import ApiContext, auth_headers, login, seeded_resources


async def _register_business(api, payload: dict):
    """Sign up through the two-step, email-verified flow."""
    started = await api.client.post("/api/v1/registrations/start", json=payload)
    if started.status_code != 201:
        return started
    body = started.json()
    return await api.client.post(
        "/api/v1/registrations/confirm",
        json={"verification_id": body["verification_id"], "code": body["development_code"]},
    )


async def test_super_admin_subscription_portfolio_uses_real_assignments(api: ApiContext) -> None:
    super_admin = await login(
        api,
        username="superadmin@dixora.app",
        password="Dixora!2026",
        business=None,
    )
    response = await api.client.get(
        "/api/v1/subscriptions/portfolio",
        headers=auth_headers(super_admin),
    )
    assert response.status_code == 200, response.text
    seeded = next(
        row for row in response.json() if row["business"]["slug"] == "dixora-lab"
    )
    assert seeded["plan"]["code"] == "TRIAL"
    assert seeded["status"] == "TRIAL"
    assert seeded["starts_at"]


async def test_role_presets_and_employee_scope_are_server_enforced(api: ApiContext) -> None:
    owner = await login(api)
    headers = auth_headers(owner)
    roles_response = await api.client.get("/api/v1/roles", headers=headers)
    branches_response = await api.client.get("/api/v1/branches", headers=headers)
    assert roles_response.status_code == 200
    assert {role["code"]: role["name"] for role in roles_response.json()} == {
        "BUSINESS_ADMIN": "Yönetici",
        "BUSINESS_MANAGER": "Müdür",
        "CASHIER": "Kasiyer",
        "WAITER": "Garson",
    }
    branch = branches_response.json()[0]
    role_by_code = {role["code"]: role for role in roles_response.json()}
    assert "loyalty.manage" in role_by_code["BUSINESS_ADMIN"]["permissions"]
    assert "loyalty.manage" not in role_by_code["BUSINESS_MANAGER"]["permissions"]
    assert {"loyalty.read", "loyalty.redeem"}.issubset(role_by_code["WAITER"]["permissions"])

    admin_with_branch = await api.client.post(
        "/api/v1/users",
        headers=headers,
        json={
            "username": "scoped-admin",
            "display_name": "Scoped Admin",
            "role_id": role_by_code["BUSINESS_ADMIN"]["id"],
            "branch_id": branch["id"],
            "temporary_password": "Temporary!2026",
        },
    )
    assert admin_with_branch.status_code == 422
    assert admin_with_branch.json()["error"]["code"] == "admin_scope_must_be_global"

    async with api.database.session_factory() as session:
        owner_role_id = (
            await session.execute(
                select(Role.id).where(
                    Role.tenant_id == UUID(owner["user"]["tenant_id"]),
                    Role.code == "BUSINESS_OWNER",
                )
            )
        ).scalar_one()
        # KITCHEN is a retired preset (the kitchen display was replaced by
        # printed tickets): simulate a tenant with a grandfathered KITCHEN
        # role row (from before the retirement) and confirm it can no
        # longer be assigned to new employees.
        kitchen_role = await ensure_role(
            session,
            tenant_id=UUID(owner["user"]["tenant_id"]),
            code="KITCHEN",
            name="Aşçı",
        )
        kitchen_role_id = kitchen_role.id
        await session.commit()
    kitchen_rejected = await api.client.post(
        "/api/v1/users",
        headers=headers,
        json={
            "username": "station-chef",
            "display_name": "Station Chef",
            "role_id": str(kitchen_role_id),
            "branch_id": branch["id"],
            "temporary_password": "Temporary!2026",
        },
    )
    assert kitchen_rejected.status_code == 422
    assert kitchen_rejected.json()["error"]["code"] == "role_not_assignable"
    protected_owner_role = await api.client.post(
        "/api/v1/users",
        headers=headers,
        json={
            "username": "second-owner",
            "display_name": "Second Owner",
            "role_id": str(owner_role_id),
            "temporary_password": "Temporary!2026",
        },
    )
    assert protected_owner_role.status_code == 422
    assert protected_owner_role.json()["error"]["code"] == "role_not_assignable"


async def test_employee_station_is_tenant_and_branch_scoped(api: ApiContext) -> None:
    registration = await _register_business(
        api,
        {
            "business_name": "Scope Test Cafe",
            "business_type": "CAFE",
            "owner_name": "Scope Owner",
            "email": "scope-owner@example.test",
            "phone": "+90 555 000 11 22",
            "password": "ScopeOwner!2026",
            "terms_accepted": True,
        },
    )
    assert registration.status_code == 201, registration.text
    second_owner = await login(
        api,
        username="scope-owner@example.test",
        password="ScopeOwner!2026",
        business=registration.json()["business_slug"],
    )
    second_headers = auth_headers(second_owner)
    branch = (await api.client.get("/api/v1/branches", headers=second_headers)).json()[0]

    # KITCHEN is a retired preset; simulate a tenant with a grandfathered
    # KITCHEN role row and confirm the retirement holds across tenants too.
    async with api.database.session_factory() as session:
        kitchen_role = await ensure_role(
            session,
            tenant_id=UUID(second_owner["user"]["tenant_id"]),
            code="KITCHEN",
            name="Aşçı",
        )
        kitchen_role_id = kitchen_role.id
        await session.commit()

    response = await api.client.post(
        "/api/v1/users",
        headers=second_headers,
        json={
            "username": "cross-tenant-chef",
            "display_name": "Cross Tenant Chef",
            "role_id": str(kitchen_role_id),
            "branch_id": branch["id"],
            "temporary_password": "Temporary!2026",
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "role_not_assignable"


async def test_branch_limit_contact_and_working_hours(api: ApiContext) -> None:
    owner = await login(api)
    headers = auth_headers(owner)
    usage = await api.client.get("/api/v1/branches/usage", headers=headers)
    assert usage.status_code == 200
    assert usage.json()["max_branches"] == 1
    assert usage.json()["can_create"] is False

    blocked = await api.client.post(
        "/api/v1/branches",
        headers=headers,
        json={"name": "Blocked Branch", "slug": "blocked", "timezone": "Europe/Istanbul"},
    )
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "branch_limit_reached"

    current_branch = (await api.client.get("/api/v1/branches", headers=headers)).json()[0]
    last_branch = await api.client.patch(
        f"/api/v1/branches/{current_branch['id']}",
        headers=headers,
        json={"is_active": False},
    )
    assert last_branch.status_code == 409
    assert last_branch.json()["error"]["code"] == "last_active_branch"

    updated = await api.client.patch(
        f"/api/v1/branches/{current_branch['id']}",
        headers=headers,
        json={
            "address": "Caferağa Mahallesi, Kadıköy",
            "phone": "+90 216 555 10 10",
            "working_hours": {
                "monday": {"is_closed": False, "opens_at": "09:00", "closes_at": "23:00"}
            },
        },
    )
    assert updated.status_code == 200
    assert updated.json()["working_hours"]["monday"]["closes_at"] == "23:00"

    async with api.database.session_factory() as session:
        plan = (
            await session.execute(
                select(SubscriptionPlan)
                .join(Subscription, Subscription.plan_id == SubscriptionPlan.id)
                .where(Subscription.tenant_id == UUID(owner["user"]["tenant_id"]))
            )
        ).scalar_one()
        plan.max_branches = 2
        await session.commit()

    created = await api.client.post(
        "/api/v1/branches",
        headers=headers,
        json={
            "name": "Kadıköy Şubesi",
            "slug": "kadikoy",
            "timezone": "Europe/Istanbul",
            "address": "Rıhtım Caddesi, Kadıköy",
            "phone": "+90 216 555 10 10",
            "working_hours": {
                "monday": {"is_closed": False, "opens_at": "09:00", "closes_at": "23:00"}
            },
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["address"] == "Rıhtım Caddesi, Kadıköy"
    assert created.json()["working_hours"]["monday"]["opens_at"] == "09:00"

    third = await api.client.post(
        "/api/v1/branches",
        headers=headers,
        json={"name": "Third", "slug": "third", "timezone": "Europe/Istanbul"},
    )
    assert third.status_code == 409
    assert third.json()["error"]["code"] == "branch_limit_reached"


async def test_printer_test_creates_real_scoped_print_job(api: ApiContext) -> None:
    owner = await login(api)
    headers = auth_headers(owner)
    branch = (await api.client.get("/api/v1/branches", headers=headers)).json()[0]
    station = (await api.client.get("/api/v1/catalog/stations", headers=headers)).json()[0]
    device = await api.client.post(
        "/api/v1/printing/devices",
        headers=headers,
        json={
            "branch_id": branch["id"],
            "preparation_station_id": station["id"],
            "code": "ROUTE-01",
            "name": "Kitchen Route Printer",
            "transport": "BRIDGE",
            "settings": {"paper_width": 80},
        },
    )
    assert device.status_code == 201, device.text

    test_job = await api.client.post(
        f"/api/v1/printing/devices/{device.json()['id']}/test",
        headers=headers,
    )
    assert test_job.status_code == 201, test_job.text
    assert test_job.json()["status"] == "PENDING"
    assert test_job.json()["printer_device_id"] == device.json()["id"]
    assert test_job.json()["payload"]["document_type"] == "PRINTER_TEST"

    jobs = await api.client.get(
        "/api/v1/printing/jobs",
        headers=headers,
        params={"branch_id": branch["id"]},
    )
    assert jobs.status_code == 200
    assert any(job["id"] == test_job.json()["id"] for job in jobs.json())

    resources = await seeded_resources(api, headers)
    order = await api.client.post(
        "/api/v1/orders",
        headers=headers,
        json={
            "table_id": resources["tables"][0]["id"],
            "items": [{"product_id": resources["burger"]["id"], "quantity": "1"}],
            "idempotency_key": "printer-routing-order-0001",
            "auto_accept": True,
        },
    )
    assert order.status_code == 201, order.text
    routed_jobs = await api.client.get(
        "/api/v1/printing/jobs",
        headers=headers,
        params={"branch_id": branch["id"]},
    )
    routed_job = next(job for job in routed_jobs.json() if job["order_id"] == order.json()["id"])
    assert routed_job["printer_device_id"] is not None
    assert routed_job["preparation_station_id"] == station["id"]
