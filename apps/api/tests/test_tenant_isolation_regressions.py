from __future__ import annotations

from uuid import uuid4

from sqlalchemy import select

from app.models import Branch, Tenant, User
from app.rbac import ensure_role, ensure_tenant_role_presets
from app.security import hash_password
from tests.conftest import ApiContext, auth_headers, login

OTHER_PASSWORD = "0therBusiness!2026"


async def _create_second_business(api: ApiContext) -> dict[str, str]:
    """A second tenant with its own branch, owner and catalog row."""
    async with api.database.session_factory() as db:
        tenant = Tenant(
            name="Rakip Kafe",
            slug=f"rakip-{uuid4().hex[:8]}",
            business_type="CAFE",
            state="ACTIVE",
            is_active=True,
        )
        db.add(tenant)
        await db.flush()
        branch = Branch(
            tenant_id=tenant.id,
            name="Merkez",
            slug="merkez",
            timezone="Europe/Istanbul",
            is_active=True,
        )
        db.add(branch)
        owner_role = await ensure_role(db, tenant_id=tenant.id, code="BUSINESS_OWNER")
        await ensure_tenant_role_presets(db, tenant.id)
        owner = User(
            tenant_id=tenant.id,
            branch_id=None,
            role_id=owner_role.id,
            username="owner@rakip.test",
            email="owner@rakip.test",
            display_name="Rakip Sahibi",
            password_hash=hash_password(OTHER_PASSWORD),
        )
        db.add(owner)
        await db.commit()
        return {"slug": tenant.slug, "tenant_id": str(tenant.id), "branch_id": str(branch.id)}


async def test_cross_tenant_resource_ids_are_not_readable(api: ApiContext) -> None:
    """A guessed/leaked UUID from another business must not resolve."""
    other = await _create_second_business(api)
    victim = await login(api, username="owner@dixora.test")
    victim_headers = auth_headers(victim)

    attacker = await login(
        api, username="owner@rakip.test", password=OTHER_PASSWORD, business=other["slug"]
    )
    attacker_headers = auth_headers(attacker)

    # Grab a real id that belongs to the victim tenant.
    products = await api.client.get("/api/v1/catalog/products", headers=victim_headers)
    assert products.status_code == 200
    items = products.json().get("items", products.json())
    assert items, "seed should provide products"
    victim_product_id = items[0]["id"]

    tables = await api.client.get("/api/v1/tables", headers=victim_headers)
    victim_table_id = tables.json()[0]["id"]

    # The other tenant must not see them.
    for url in (
        f"/api/v1/catalog/products/{victim_product_id}",
        f"/api/v1/tables/{victim_table_id}",
        f"/api/v1/tables/{victim_table_id}/active-order",
    ):
        response = await api.client.get(url, headers=attacker_headers)
        assert response.status_code in {403, 404}, f"{url} leaked to another tenant"


async def test_cross_tenant_product_mutation_is_rejected(api: ApiContext) -> None:
    other = await _create_second_business(api)
    victim = await login(api, username="owner@dixora.test")
    attacker = await login(
        api, username="owner@rakip.test", password=OTHER_PASSWORD, business=other["slug"]
    )

    products = await api.client.get(
        "/api/v1/catalog/products", headers=auth_headers(victim)
    )
    items = products.json().get("items", products.json())
    victim_product_id = items[0]["id"]

    response = await api.client.patch(
        f"/api/v1/catalog/products/{victim_product_id}",
        headers=auth_headers(attacker),
        json={"name": "Ele geçirildi"},
    )
    assert response.status_code in {403, 404}

    # The original name is untouched.
    after = await api.client.get(
        f"/api/v1/catalog/products/{victim_product_id}", headers=auth_headers(victim)
    )
    assert after.status_code == 200
    assert after.json()["name"] != "Ele geçirildi"


async def test_browser_supplied_tenant_and_branch_ids_are_ignored(
    api: ApiContext,
) -> None:
    """Tenant/branch scope comes from the session, never the request body."""
    other = await _create_second_business(api)
    attacker = await login(
        api, username="owner@rakip.test", password=OTHER_PASSWORD, business=other["slug"]
    )
    victim = await login(api, username="owner@dixora.test")
    victim_me = await api.client.get("/api/v1/auth/me", headers=auth_headers(victim))
    victim_tenant_id = victim_me.json()["tenant_id"]

    # Attempt to create a category *into* the victim tenant by spoofing ids.
    response = await api.client.post(
        "/api/v1/catalog/categories",
        headers=auth_headers(attacker),
        json={"name": "Sızdırılmış", "tenant_id": victim_tenant_id},
    )
    # Either the extra field is rejected outright, or it is ignored and the row
    # lands in the attacker's own tenant — never in the victim's.
    if response.status_code in {200, 201}:
        async with api.database.session_factory() as db:
            from app.models import Category

            created = (
                await db.execute(select(Category).where(Category.name == "Sızdırılmış"))
            ).scalar_one()
            assert str(created.tenant_id) != victim_tenant_id
    else:
        assert response.status_code in {400, 403, 422}


async def test_public_qr_menu_hides_staff_and_commercial_data(api: ApiContext) -> None:
    response = await api.client.get("/api/v1/qr/public/dixora-lab/merkez")
    assert response.status_code == 200
    body = response.text

    # No internal identifiers or commercial fields anywhere in the payload.
    for forbidden in (
        "cost_price",
        '"sku"',
        "tax_rate",
        "track_inventory",
        "stock_quantity",
        "password",
        "internal_name",
    ):
        assert forbidden not in body, f"public menu leaked {forbidden}"

    payload = response.json()
    # Public ids must be opaque references, not raw tenant UUIDs.
    for product in payload["products"]:
        assert product["id"].startswith("p_")
    for category in payload["categories"]:
        assert category["id"].startswith("c_")


async def test_public_qr_menu_rejects_unknown_business(api: ApiContext) -> None:
    response = await api.client.get("/api/v1/qr/public/does-not-exist/merkez")
    assert response.status_code == 404


async def test_audit_log_endpoint_is_tenant_scoped(api: ApiContext) -> None:
    other = await _create_second_business(api)
    attacker = await login(
        api, username="owner@rakip.test", password=OTHER_PASSWORD, business=other["slug"]
    )
    response = await api.client.get(
        "/api/v1/audit-logs", headers=auth_headers(attacker), params={"limit": 200}
    )
    assert response.status_code == 200
    rows = response.json()
    # A brand-new tenant cannot see the seeded tenant's history.
    assert all(
        "dixora-lab" not in str(row.get("new_value", "")) for row in rows
    ), "audit feed leaked another tenant's records"
