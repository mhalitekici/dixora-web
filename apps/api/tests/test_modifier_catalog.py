from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from sqlalchemy import select

from app.models import (
    AuditLog,
    Category,
    Modifier,
    ModifierGroup,
    Product,
    ProductModifierGroup,
    Tenant,
)
from app.models.enums import TenantState
from tests.conftest import ApiContext, auth_headers, login, seeded_resources


async def test_modifier_crud_validates_selection_limits_and_writes_audits(
    api: ApiContext,
) -> None:
    owner = await login(api)
    headers = auth_headers(owner)
    resources = await seeded_resources(api, headers)
    burger = resources["burger"]
    salad = next(product for product in resources["products"] if product["name"] == "Caesar Salad")

    groups_response = await api.client.get(
        "/api/v1/catalog/modifier-groups",
        headers=headers,
    )
    assert groups_response.status_code == 200, groups_response.text
    group = next(item for item in groups_response.json() if item["name"] == "Burger Extras")
    group_id = group["id"]

    updated_group = await api.client.patch(
        f"/api/v1/catalog/modifier-groups/{group_id}",
        headers=headers,
        json={
            "name": "Burger Choices",
            "is_required": True,
            "minimum_selection": 1,
            "maximum_selection": 2,
            "sort_order": 7,
            "product_ids": [burger["id"], salad["id"], burger["id"]],
        },
    )
    assert updated_group.status_code == 200, updated_group.text
    updated_group_body = updated_group.json()
    assert updated_group_body["name"] == "Burger Choices"
    assert updated_group_body["is_required"] is True
    assert updated_group_body["minimum_selection"] == 1
    assert updated_group_body["maximum_selection"] == 2
    assert updated_group_body["sort_order"] == 7
    assert updated_group_body["is_active"] is True
    assert set(updated_group_body["product_ids"]) == {burger["id"], salad["id"]}

    invalid_partial_update = await api.client.patch(
        f"/api/v1/catalog/modifier-groups/{group_id}",
        headers=headers,
        json={"minimum_selection": 3},
    )
    assert invalid_partial_update.status_code == 422, invalid_partial_update.text
    assert invalid_partial_update.json()["error"]["code"] == "invalid_modifier_selection_limits"

    unlimited_group = await api.client.patch(
        f"/api/v1/catalog/modifier-groups/{group_id}",
        headers=headers,
        json={"maximum_selection": None},
    )
    assert unlimited_group.status_code == 200, unlimited_group.text
    assert unlimited_group.json()["minimum_selection"] == 1
    assert unlimited_group.json()["maximum_selection"] is None

    created_modifier = await api.client.post(
        "/api/v1/catalog/modifiers",
        headers=headers,
        json={
            "group_id": group_id,
            "name": "Smoked Onion",
            "price_delta": "12.50",
            "sort_order": 8,
        },
    )
    assert created_modifier.status_code == 201, created_modifier.text
    modifier_id = created_modifier.json()["id"]

    updated_modifier = await api.client.patch(
        f"/api/v1/catalog/modifiers/{modifier_id}",
        headers=headers,
        json={
            "name": "Smoked Red Onion",
            "price_delta": "18.75",
            "sort_order": 9,
        },
    )
    assert updated_modifier.status_code == 200, updated_modifier.text
    assert updated_modifier.json()["name"] == "Smoked Red Onion"
    assert Decimal(updated_modifier.json()["price_delta"]) == Decimal("18.75")
    assert updated_modifier.json()["sort_order"] == 9

    archived_modifier = await api.client.delete(
        f"/api/v1/catalog/modifiers/{modifier_id}",
        headers=headers,
    )
    assert archived_modifier.status_code == 204, archived_modifier.text

    refreshed_groups = await api.client.get(
        "/api/v1/catalog/modifier-groups",
        headers=headers,
    )
    assert refreshed_groups.status_code == 200, refreshed_groups.text
    refreshed_group = next(item for item in refreshed_groups.json() if item["id"] == group_id)
    assert modifier_id not in {item["id"] for item in refreshed_group["modifiers"]}

    archived_group = await api.client.delete(
        f"/api/v1/catalog/modifier-groups/{group_id}",
        headers=headers,
    )
    assert archived_group.status_code == 204, archived_group.text

    active_groups = await api.client.get(
        "/api/v1/catalog/modifier-groups",
        headers=headers,
    )
    assert active_groups.status_code == 200, active_groups.text
    assert group_id not in {item["id"] for item in active_groups.json()}

    async with api.database.session_factory() as db:
        stored_group = await db.get(ModifierGroup, UUID(group_id))
        stored_modifier = await db.get(Modifier, UUID(modifier_id))
        assert stored_group is not None
        assert stored_group.is_active is False
        assert stored_modifier is not None
        assert stored_modifier.is_active is False

        audit_actions = set(
            (
                await db.execute(
                    select(AuditLog.action).where(AuditLog.resource_id.in_([group_id, modifier_id]))
                )
            )
            .scalars()
            .all()
        )
    assert {
        "catalog.modifier_group_updated",
        "catalog.modifier_group_archived",
        "catalog.modifier_created",
        "catalog.modifier_updated",
        "catalog.modifier_archived",
    } <= audit_actions


async def test_modifier_mutations_reject_cross_tenant_entities_and_product_links(
    api: ApiContext,
) -> None:
    owner = await login(api)
    headers = auth_headers(owner)
    groups_response = await api.client.get(
        "/api/v1/catalog/modifier-groups",
        headers=headers,
    )
    assert groups_response.status_code == 200, groups_response.text
    own_group = next(item for item in groups_response.json() if item["name"] == "Burger Extras")
    own_product_ids = set(own_group["product_ids"])

    async with api.database.session_factory() as db:
        foreign_tenant = Tenant(
            name="Foreign Modifier Tenant",
            slug="foreign-modifier-tenant",
            state=TenantState.ACTIVE,
            is_active=True,
        )
        db.add(foreign_tenant)
        await db.flush()
        foreign_category = Category(
            tenant_id=foreign_tenant.id,
            name="Foreign Modifier Category",
        )
        foreign_group = ModifierGroup(
            tenant_id=foreign_tenant.id,
            name="Foreign Modifier Group",
            minimum_selection=0,
            maximum_selection=1,
        )
        db.add_all([foreign_category, foreign_group])
        await db.flush()
        foreign_product = Product(
            tenant_id=foreign_tenant.id,
            category_id=foreign_category.id,
            name="Foreign Modifier Product",
            selling_price=Decimal("25.00"),
        )
        foreign_modifier = Modifier(
            tenant_id=foreign_tenant.id,
            group_id=foreign_group.id,
            name="Foreign Modifier",
            price_delta=Decimal("2.50"),
        )
        db.add_all([foreign_product, foreign_modifier])
        await db.flush()
        db.add(
            ProductModifierGroup(
                tenant_id=foreign_tenant.id,
                product_id=foreign_product.id,
                modifier_group_id=foreign_group.id,
            )
        )
        await db.commit()
        foreign_product_id = str(foreign_product.id)
        foreign_group_id = str(foreign_group.id)
        foreign_modifier_id = str(foreign_modifier.id)

    cross_tenant_link = await api.client.patch(
        f"/api/v1/catalog/modifier-groups/{own_group['id']}",
        headers=headers,
        json={"product_ids": [foreign_product_id]},
    )
    assert cross_tenant_link.status_code == 404, cross_tenant_link.text
    assert cross_tenant_link.json()["error"]["code"] == "product_not_found"

    cross_tenant_create = await api.client.post(
        "/api/v1/catalog/modifier-groups",
        headers=headers,
        json={
            "name": "Cross Tenant Group",
            "product_ids": [foreign_product_id],
        },
    )
    assert cross_tenant_create.status_code == 404, cross_tenant_create.text

    foreign_group_update = await api.client.patch(
        f"/api/v1/catalog/modifier-groups/{foreign_group_id}",
        headers=headers,
        json={"name": "Stolen Group"},
    )
    assert foreign_group_update.status_code == 404, foreign_group_update.text

    foreign_group_delete = await api.client.delete(
        f"/api/v1/catalog/modifier-groups/{foreign_group_id}",
        headers=headers,
    )
    assert foreign_group_delete.status_code == 404, foreign_group_delete.text

    foreign_modifier_update = await api.client.patch(
        f"/api/v1/catalog/modifiers/{foreign_modifier_id}",
        headers=headers,
        json={"name": "Stolen Modifier"},
    )
    assert foreign_modifier_update.status_code == 404, foreign_modifier_update.text

    foreign_modifier_delete = await api.client.delete(
        f"/api/v1/catalog/modifiers/{foreign_modifier_id}",
        headers=headers,
    )
    assert foreign_modifier_delete.status_code == 404, foreign_modifier_delete.text

    refreshed_groups = await api.client.get(
        "/api/v1/catalog/modifier-groups",
        headers=headers,
    )
    assert refreshed_groups.status_code == 200, refreshed_groups.text
    refreshed_own_group = next(
        item for item in refreshed_groups.json() if item["id"] == own_group["id"]
    )
    assert set(refreshed_own_group["product_ids"]) == own_product_ids

    async with api.database.session_factory() as db:
        stored_foreign_group = await db.get(ModifierGroup, UUID(foreign_group_id))
        stored_foreign_modifier = await db.get(Modifier, UUID(foreign_modifier_id))
        assert stored_foreign_group is not None
        assert stored_foreign_group.name == "Foreign Modifier Group"
        assert stored_foreign_group.is_active is True
        assert stored_foreign_modifier is not None
        assert stored_foreign_modifier.name == "Foreign Modifier"
        assert stored_foreign_modifier.is_active is True
