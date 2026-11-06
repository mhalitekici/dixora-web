from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select

from app.models import Area, Branch, Subscription, SubscriptionPlan, Tenant, User
from app.rbac import ensure_role
from tests.conftest import ApiContext, auth_headers, login


async def _use_paid_plan(api: ApiContext) -> None:
    """Trials are capped at one branch; multi-branch needs the paid plan."""
    async with api.database.session_factory() as db:
        tenant = (await db.execute(select(Tenant).where(Tenant.slug == "dixora-lab"))).scalar_one()
        standard = (
            await db.execute(select(SubscriptionPlan).where(SubscriptionPlan.code == "STANDARD"))
        ).scalar_one()
        subscription = (
            await db.execute(select(Subscription).where(Subscription.tenant_id == tenant.id))
        ).scalar_one()
        subscription.plan_id = standard.id
        await db.commit()


async def _add_branch(api: ApiContext, headers: dict[str, str], name: str, slug: str) -> dict:
    response = await api.client.post(
        "/api/v1/branches",
        headers=headers,
        json={"name": name, "slug": slug, "timezone": "Europe/Istanbul"},
    )
    assert response.status_code == 201, response.text
    return response.json()


async def test_branch_archive_and_restore_preserves_history(api: ApiContext) -> None:
    await _use_paid_plan(api)
    headers = auth_headers(await login(api))
    branch = await _add_branch(api, headers, "Kadıköy", "kadikoy")

    # Give the branch some history that must survive archiving.
    async with api.database.session_factory() as db:
        tenant = (await db.execute(select(Tenant).where(Tenant.slug == "dixora-lab"))).scalar_one()
        db.add(
            Area(
                tenant_id=tenant.id,
                branch_id=UUID(branch["id"]),
                name="Teras",
                sort_order=0,
                is_active=True,
            )
        )
        await db.commit()

    archived = await api.client.post(
        f"/api/v1/branches/{branch['id']}/archive",
        headers=headers,
        json={"reason": "Şube kapandı"},
    )
    assert archived.status_code == 200, archived.text
    assert archived.json()["is_active"] is False
    assert archived.json()["archived_at"] is not None

    # History is intact, not deleted.
    async with api.database.session_factory() as db:
        areas = (
            (await db.execute(select(Area).where(Area.branch_id == UUID(branch["id"]))))
            .scalars()
            .all()
        )
        assert len(areas) == 1

    restored = await api.client.post(f"/api/v1/branches/{branch['id']}/restore", headers=headers)
    assert restored.status_code == 200, restored.text
    assert restored.json()["is_active"] is True
    assert restored.json()["archived_at"] is None


async def test_the_last_active_branch_cannot_be_archived(api: ApiContext) -> None:
    headers = auth_headers(await login(api))
    branches = await api.client.get("/api/v1/branches", headers=headers)
    only_branch = branches.json()[0]

    response = await api.client.post(
        f"/api/v1/branches/{only_branch['id']}/archive", headers=headers, json={}
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "last_active_branch"


async def test_branch_pricing_preview_reflects_active_branches(api: ApiContext) -> None:
    await _use_paid_plan(api)
    headers = auth_headers(await login(api))
    before = await api.client.get("/api/v1/branches/pricing", headers=headers)
    assert before.status_code == 200, before.text
    assert before.json()["active_branches"] == 1

    await _add_branch(api, headers, "Ataşehir", "atasehir")

    after = await api.client.get("/api/v1/branches/pricing", headers=headers)
    assert after.json()["active_branches"] == 2
    # Opening one more must always cost the additional-branch price.
    delta = Decimal(after.json()["next_branch_monthly_total"]) - Decimal(
        after.json()["monthly_total"]
    )
    assert delta == Decimal(after.json()["additional_branch_price"])


async def test_branch_rejects_automatic_service_charge_activation(api: ApiContext) -> None:
    headers = auth_headers(await login(api))
    branches = await api.client.get("/api/v1/branches", headers=headers)
    assert branches.status_code == 200, branches.text
    branch = branches.json()[0]

    updated = await api.client.patch(
        f"/api/v1/branches/{branch['id']}",
        headers=headers,
        json={
            "service_charge_enabled": True,
            "service_charge_type": "PERCENTAGE",
            "service_charge_value": "10.00",
        },
    )
    assert updated.status_code == 422, updated.text
    assert updated.json()["error"]["code"] == "automatic_service_charge_disabled"
    disabled = await api.client.patch(
        f"/api/v1/branches/{branch['id']}",
        headers=headers,
        json={"service_charge_enabled": False},
    )
    assert disabled.status_code == 200, disabled.text
    assert disabled.json()["service_charge_enabled"] is False


async def test_multi_branch_manager_reaches_exactly_their_branches(
    api: ApiContext,
) -> None:
    """A user granted two branches may use both — and nothing beyond them."""
    await _use_paid_plan(api)
    headers = auth_headers(await login(api))
    second = await _add_branch(api, headers, "Kadıköy", "kadikoy")
    third = await _add_branch(api, headers, "Ataşehir", "atasehir")

    users = await api.client.get("/api/v1/users", headers=headers)
    cashier = next(item for item in users.json() if item["username"] == "cashier@dixora.test")
    home_branch = cashier["branch_id"]

    granted = await api.client.put(
        f"/api/v1/users/{cashier['id']}/branches",
        headers=headers,
        json={"branch_ids": [second["id"]]},
    )
    assert granted.status_code == 200, granted.text
    assert set(granted.json()["branch_ids"]) == {home_branch, second["id"]}

    cashier_headers = auth_headers(await login(api, username="cashier@dixora.test"))

    # Home branch and the granted branch both work...
    for branch_id in (home_branch, second["id"]):
        allowed = await api.client.get(
            "/api/v1/tables/areas",
            headers=cashier_headers,
            params={"branch_id": branch_id},
        )
        assert allowed.status_code == 200, f"branch {branch_id}: {allowed.text}"

    # ...the third one does not.
    denied = await api.client.get(
        "/api/v1/tables/areas",
        headers=cashier_headers,
        params={"branch_id": third["id"]},
    )
    assert denied.status_code == 403, denied.text


async def test_branch_access_cannot_be_granted_across_tenants(api: ApiContext) -> None:
    headers = auth_headers(await login(api))
    users = await api.client.get("/api/v1/users", headers=headers)
    cashier = next(item for item in users.json() if item["username"] == "cashier@dixora.test")

    async with api.database.session_factory() as db:
        tenant = (await db.execute(select(Tenant).where(Tenant.slug == "dixora-lab"))).scalar_one()
        foreign = Branch(
            tenant_id=tenant.id,
            name="placeholder",
            slug="placeholder",
            timezone="Europe/Istanbul",
        )
        db.add(foreign)
        await db.commit()

    response = await api.client.put(
        f"/api/v1/users/{cashier['id']}/branches",
        headers=headers,
        json={"branch_ids": ["00000000-0000-0000-0000-0000000000cc"]},
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "branch_not_found"


async def test_granted_branch_appears_in_the_switcher_and_can_be_switched_to(
    api: ApiContext,
) -> None:
    """The switcher must offer exactly what the API will accept — no more, no less."""
    await _use_paid_plan(api)
    headers = auth_headers(await login(api))
    second = await _add_branch(api, headers, "Kadıköy", "kadikoy")
    third = await _add_branch(api, headers, "Ataşehir", "atasehir")

    users = await api.client.get("/api/v1/users", headers=headers)
    cashier = next(item for item in users.json() if item["username"] == "cashier@dixora.test")
    await api.client.put(
        f"/api/v1/users/{cashier['id']}/branches",
        headers=headers,
        json={"branch_ids": [second["id"]]},
    )

    session = await login(api, username="cashier@dixora.test")
    cashier_headers = auth_headers(session)

    listed = await api.client.get("/api/v1/auth/branches", headers=cashier_headers)
    assert listed.status_code == 200, listed.text
    offered = {branch["id"] for branch in listed.json()["branches"]}
    assert second["id"] in offered, "a granted branch was hidden from the switcher"
    assert third["id"] not in offered, "the switcher offered an unauthorised branch"

    switched = await api.client.post(
        "/api/v1/auth/switch-branch",
        json={"refresh_token": session["refresh_token"], "branch_id": second["id"]},
    )
    assert switched.status_code == 200, switched.text
    assert switched.json()["user"]["branch_id"] == second["id"]

    assert listed.json()["can_switch"] is True
    switched_headers = auth_headers(switched.json())
    protected = await api.client.get("/api/v1/tables", headers=switched_headers)
    assert protected.status_code == 200, protected.text
    refreshed = await api.client.post(
        "/api/v1/auth/refresh", json={"refresh_token": switched.json()["refresh_token"]}
    )
    assert refreshed.status_code == 200, refreshed.text
    assert refreshed.json()["user"]["branch_id"] == second["id"]
    direct_login = await api.client.post(
        "/api/v1/auth/login",
        json={
            "business": "dixora-lab",
            "username": "cashier@dixora.test",
            "password": "DixoraLab!2026",
            "branch_id": second["id"],
        },
    )
    assert direct_login.status_code == 200, direct_login.text
    await api.client.put(
        f"/api/v1/users/{cashier['id']}/branches", headers=headers, json={"branch_ids": []}
    )
    denied = await api.client.get("/api/v1/tables", headers=auth_headers(refreshed.json()))
    assert denied.status_code == 403, denied.text
    denied_refresh = await api.client.post(
        "/api/v1/auth/refresh", json={"refresh_token": refreshed.json()["refresh_token"]}
    )
    assert denied_refresh.status_code == 403, denied_refresh.text


async def test_switching_to_an_ungranted_branch_is_refused(api: ApiContext) -> None:
    await _use_paid_plan(api)
    headers = auth_headers(await login(api))
    other = await _add_branch(api, headers, "Ataşehir", "atasehir")

    session = await login(api, username="cashier@dixora.test")
    response = await api.client.post(
        "/api/v1/auth/switch-branch",
        json={"refresh_token": session["refresh_token"], "branch_id": other["id"]},
    )
    assert response.status_code == 403, response.text
    assert response.json()["error"]["code"] == "branch_switch_forbidden"


async def test_default_branch_prefers_catalogue_source_when_timestamps_are_reordered(
    api: ApiContext,
) -> None:
    await _use_paid_plan(api)
    initial = await login(api)
    first_id = UUID(initial["user"]["branch_id"])
    second = await _add_branch(api, auth_headers(initial), "Kopya şube", "kopya-sube")
    async with api.database.session_factory() as db:
        first = await db.get(Branch, first_id)
        copied = await db.get(Branch, UUID(second["id"]))
        assert first is not None and copied is not None
        first.created_at = datetime(2026, 1, 2, tzinfo=UTC)
        copied.created_at = datetime(2026, 1, 1, tzinfo=UTC)
        copied.catalog_source_branch_id = first.id
        await db.commit()
    session = await login(api)
    assert session["user"]["branch_id"] == str(first_id)
    refreshed = await api.client.post(
        "/api/v1/auth/refresh", json={"refresh_token": session["refresh_token"]}
    )
    assert refreshed.status_code == 200, refreshed.text
    assert refreshed.json()["user"]["branch_id"] == str(first_id)


async def test_roster_includes_all_manageable_branches_and_global_admin(api: ApiContext) -> None:
    await _use_paid_plan(api)
    owner = await login(api)
    headers = auth_headers(owner)
    second = await _add_branch(api, headers, "Alphabetical first", "aaa-roster")
    roles = (await api.client.get("/api/v1/roles", headers=headers)).json()
    created = {}
    for code, branch_id in [("BUSINESS_MANAGER", second["id"]), ("BUSINESS_ADMIN", None)]:
        role = next(r for r in roles if r["code"] == code)
        response = await api.client.post(
            "/api/v1/users",
            headers=headers,
            json={
                "username": f"roster-{code.lower()}",
                "display_name": f"Roster {code}",
                "role_id": role["id"],
                "branch_id": branch_id,
                "temporary_password": "Temporary!2026",
                "pin": "7246",
            },
        )
        assert response.status_code == 201, response.text
        created[code] = response.json()
    roster = (await api.client.get("/api/v1/users", headers=headers)).json()
    assert all(user["id"] in {row["id"] for row in roster} for user in created.values())
    # Exercise a branch-pinned role explicitly authorized to manage users.
    async with api.database.session_factory() as db:
        role = await ensure_role(
            db,
            tenant_id=UUID(owner["user"]["tenant_id"]),
            code="CUSTOM_ROSTER",
            is_system=False,
            permission_codes={"users.manage"},
        )
        role.operational_profile = "MANAGEMENT"
        user = await db.get(User, UUID(created["BUSINESS_MANAGER"]["id"]))
        assert user is not None
        user.role_id = role.id
        await db.commit()
    manager = await login(api, username="roster-business_manager", password="Temporary!2026")
    scoped = await api.client.get("/api/v1/users", headers=auth_headers(manager))
    assert scoped.status_code == 200, scoped.text
    assert created["BUSINESS_MANAGER"]["id"] in {u["id"] for u in scoped.json()}
    assert all(u["branch_id"] == second["id"] for u in scoped.json())
    assert created["BUSINESS_ADMIN"]["id"] not in {u["id"] for u in scoped.json()}
    enrollment = await api.client.post(
        "/api/v1/auth/login",
        json={
            "business": "dixora-lab",
            "username": "roster-business_manager",
            "password": "Temporary!2026",
            "enroll_trusted_device": True,
        },
    )
    assert enrollment.status_code == 200, enrollment.text
    pin_login = await api.client.post(
        "/api/v1/auth/pin-login",
        json={
            "business_slug": "dixora-lab",
            "branch_slug": second["slug"],
            "username": "roster-business_manager",
            "pin": "7246",
            "device_token": enrollment.json()["trusted_device"]["token"],
        },
    )
    assert pin_login.status_code == 200, pin_login.text
    forbidden = await api.client.post(
        "/api/v1/auth/login",
        json={
            "business": "dixora-lab",
            "username": "roster-business_manager",
            "password": "Temporary!2026",
            "branch_id": owner["user"]["branch_id"],
        },
    )
    assert forbidden.status_code == 403, forbidden.text
    assert forbidden.json()["error"]["code"] == "branch_forbidden"
