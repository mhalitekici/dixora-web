from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from sqlalchemy import select

from app.models import Area, Branch, Subscription, SubscriptionPlan, Tenant
from tests.conftest import ApiContext, auth_headers, login


async def _use_paid_plan(api: ApiContext) -> None:
    """Trials are capped at one branch; multi-branch needs the paid plan."""
    async with api.database.session_factory() as db:
        tenant = (
            await db.execute(select(Tenant).where(Tenant.slug == "dixora-lab"))
        ).scalar_one()
        standard = (
            await db.execute(
                select(SubscriptionPlan).where(SubscriptionPlan.code == "STANDARD")
            )
        ).scalar_one()
        subscription = (
            await db.execute(
                select(Subscription).where(Subscription.tenant_id == tenant.id)
            )
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
        tenant = (
            await db.execute(select(Tenant).where(Tenant.slug == "dixora-lab"))
        ).scalar_one()
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

    restored = await api.client.post(
        f"/api/v1/branches/{branch['id']}/restore", headers=headers
    )
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


async def test_multi_branch_manager_reaches_exactly_their_branches(
    api: ApiContext,
) -> None:
    """A user granted two branches may use both — and nothing beyond them."""
    await _use_paid_plan(api)
    headers = auth_headers(await login(api))
    second = await _add_branch(api, headers, "Kadıköy", "kadikoy")
    third = await _add_branch(api, headers, "Ataşehir", "atasehir")

    users = await api.client.get("/api/v1/users", headers=headers)
    cashier = next(
        item for item in users.json() if item["username"] == "cashier@dixora.test"
    )
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
    cashier = next(
        item for item in users.json() if item["username"] == "cashier@dixora.test"
    )

    async with api.database.session_factory() as db:
        tenant = (
            await db.execute(select(Tenant).where(Tenant.slug == "dixora-lab"))
        ).scalar_one()
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
    cashier = next(
        item for item in users.json() if item["username"] == "cashier@dixora.test"
    )
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
