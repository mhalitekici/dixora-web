from __future__ import annotations

from uuid import UUID

from sqlalchemy import select

from app.models import Area, Branch, Tenant
from tests.conftest import ApiContext, auth_headers, login


async def _second_branch(api: ApiContext) -> dict[str, str]:
    """A second branch in the SAME tenant, with an area only it owns."""
    async with api.database.session_factory() as db:
        tenant = (
            await db.execute(select(Tenant).where(Tenant.slug == "dixora-lab"))
        ).scalar_one()
        branch = Branch(
            tenant_id=tenant.id,
            name="İkinci Şube",
            slug="ikinci-sube",
            timezone="Europe/Istanbul",
            is_active=True,
        )
        db.add(branch)
        await db.flush()
        db.add(
            Area(
                tenant_id=tenant.id,
                branch_id=branch.id,
                name="Gizli Salon",
                sort_order=0,
                is_active=True,
            )
        )
        await db.commit()
        return {"branch_id": str(branch.id), "tenant_id": str(tenant.id)}


async def test_branch_scoped_user_cannot_read_another_branch_via_query_param(
    api: ApiContext,
) -> None:
    """A cashier pinned to branch A must not read branch B by changing ?branch_id=.

    Branch scope is trusted server-side context. Supplying another branch's id
    must be rejected outright, not silently honoured.
    """
    other = await _second_branch(api)
    cashier = await login(api, username="cashier@dixora.test")
    headers = auth_headers(cashier)

    response = await api.client.get(
        "/api/v1/tables/areas",
        headers=headers,
        params={"branch_id": other["branch_id"]},
    )
    assert response.status_code == 403, (
        "branch scope was honoured from a browser-supplied query param: "
        f"{response.status_code} {response.text}"
    )


async def test_branch_scoped_user_still_reads_their_own_branch(api: ApiContext) -> None:
    """The fix must not break the legitimate case."""
    await _second_branch(api)
    cashier = await login(api, username="cashier@dixora.test")
    response = await api.client.get("/api/v1/tables/areas", headers=auth_headers(cashier))
    assert response.status_code == 200, response.text


async def test_owner_can_read_any_branch_of_their_own_business(api: ApiContext) -> None:
    """Owners legitimately operate across every branch they own."""
    other = await _second_branch(api)
    owner = await login(api, username="owner@dixora.test")
    response = await api.client.get(
        "/api/v1/tables/areas",
        headers=auth_headers(owner),
        params={"branch_id": other["branch_id"]},
    )
    assert response.status_code == 200, response.text
    assert any(area["name"] == "Gizli Salon" for area in response.json())


async def test_owner_cannot_reach_a_branch_of_another_business(api: ApiContext) -> None:
    """Even an owner's cross-branch freedom stops at their own tenant."""
    foreign_branch_id = str(UUID("00000000-0000-0000-0000-0000000000ff"))
    owner = await login(api, username="owner@dixora.test")
    response = await api.client.get(
        "/api/v1/tables/areas",
        headers=auth_headers(owner),
        params={"branch_id": foreign_branch_id},
    )
    assert response.status_code == 403, response.text
