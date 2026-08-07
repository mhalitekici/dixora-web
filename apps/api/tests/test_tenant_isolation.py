from __future__ import annotations

from decimal import Decimal

from app.models import Area, Branch, Category, DiningTable, Product, Tenant, User
from app.models.enums import TenantState
from app.rbac import ensure_role
from app.security import hash_password
from tests.conftest import ApiContext, auth_headers, login


async def _create_tenant_b(api: ApiContext) -> dict[str, object]:
    async with api.database.session_factory() as db:
        tenant = Tenant(
            name="Other Restaurant",
            slug="other-restaurant",
            state=TenantState.ACTIVE,
            is_active=True,
        )
        db.add(tenant)
        await db.flush()
        branch = Branch(
            tenant_id=tenant.id,
            name="Other Main",
            slug="other-main",
        )
        db.add(branch)
        role = await ensure_role(db, tenant_id=tenant.id, code="BUSINESS_OWNER")
        user = User(
            tenant_id=tenant.id,
            role_id=role.id,
            username="owner@other.test",
            email="owner@other.test",
            display_name="Other Owner",
            password_hash=hash_password("Other!2026"),
        )
        db.add(user)
        category = Category(tenant_id=tenant.id, name="Private Category")
        db.add(category)
        await db.flush()
        product = Product(
            tenant_id=tenant.id,
            category_id=category.id,
            name="Private Product",
            selling_price=Decimal("99.00"),
        )
        area = Area(
            tenant_id=tenant.id,
            branch_id=branch.id,
            name="Private Hall",
        )
        db.add_all([product, area])
        await db.flush()
        table = DiningTable(
            tenant_id=tenant.id,
            branch_id=branch.id,
            area_id=area.id,
            name="X1",
        )
        db.add(table)
        await db.commit()
        return {
            "tenant_id": tenant.id,
            "category_id": category.id,
            "product_id": product.id,
            "area_id": area.id,
            "table_id": table.id,
        }


async def test_tenant_a_cannot_read_update_delete_or_reference_tenant_b(api: ApiContext) -> None:
    foreign = await _create_tenant_b(api)
    tokens = await login(api)
    headers = auth_headers(tokens)

    read = await api.client.get(
        f"/api/v1/catalog/products/{foreign['product_id']}",
        headers=headers,
    )
    assert read.status_code == 404

    update = await api.client.patch(
        f"/api/v1/catalog/products/{foreign['product_id']}",
        json={"name": "Stolen"},
        headers=headers,
    )
    assert update.status_code == 404

    delete = await api.client.delete(
        f"/api/v1/catalog/products/{foreign['product_id']}",
        headers=headers,
    )
    assert delete.status_code == 404

    reference = await api.client.post(
        "/api/v1/catalog/products",
        json={
            "category_id": str(foreign["category_id"]),
            "name": "Cross Tenant Product",
            "selling_price": "10.00",
        },
        headers=headers,
    )
    assert reference.status_code == 404

    table_read = await api.client.get(
        f"/api/v1/tables/{foreign['table_id']}",
        headers=headers,
    )
    assert table_read.status_code == 404
    area_update = await api.client.patch(
        f"/api/v1/tables/areas/{foreign['area_id']}",
        json={"name": "Stolen hall"},
        headers=headers,
    )
    assert area_update.status_code == 404
    area_delete = await api.client.delete(
        f"/api/v1/tables/areas/{foreign['area_id']}",
        headers=headers,
    )
    assert area_delete.status_code == 404

    async with api.database.session_factory() as db:
        original = await db.get(Product, foreign["product_id"])
        assert original is not None
        assert original.name == "Private Product"
        assert original.is_active is True
