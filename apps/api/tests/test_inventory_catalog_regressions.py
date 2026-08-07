from __future__ import annotations

from decimal import Decimal

from tests.conftest import ApiContext, auth_headers, login, seeded_resources


async def test_recipe_update_replaces_ingredients_and_returns_enriched_recipe(
    api: ApiContext,
) -> None:
    owner = await login(api)
    headers = auth_headers(owner)
    resources = await seeded_resources(api, headers)
    burger = resources["burger"]

    inventory_response = await api.client.get("/api/v1/inventory/items", headers=headers)
    assert inventory_response.status_code == 200, inventory_response.text
    inventory = {item["name"]: item for item in inventory_response.json()}
    bun = inventory["Burger Bun"]
    sauce = inventory["Burger Sauce"]

    updated = await api.client.put(
        f"/api/v1/inventory/recipes/{burger['id']}",
        headers=headers,
        json={
            "product_id": burger["id"],
            "yield_quantity": "2",
            "items": [
                {"inventory_item_id": bun["id"], "quantity": "2"},
                {"inventory_item_id": sauce["id"], "quantity": "35.5"},
            ],
        },
    )
    assert updated.status_code == 204, updated.text

    recipes_response = await api.client.get("/api/v1/inventory/recipes", headers=headers)
    assert recipes_response.status_code == 200, recipes_response.text
    recipe = next(
        item for item in recipes_response.json() if item["product_id"] == burger["id"]
    )
    assert recipe["product_name"] == "Classic Burger"
    assert Decimal(recipe["yield_quantity"]) == Decimal("2")

    ingredients = {item["name"]: item for item in recipe["ingredients"]}
    assert set(ingredients) == {"Burger Bun", "Burger Sauce"}
    assert ingredients["Burger Bun"]["unit"] == "piece"
    assert Decimal(ingredients["Burger Bun"]["quantity"]) == Decimal("2")
    assert Decimal(ingredients["Burger Sauce"]["quantity"]) == Decimal("35.5")


async def test_stock_movement_is_idempotent_and_enforces_direction(
    api: ApiContext,
) -> None:
    owner = await login(api)
    headers = auth_headers(owner)
    inventory_response = await api.client.get("/api/v1/inventory/items", headers=headers)
    assert inventory_response.status_code == 200, inventory_response.text
    bun = next(item for item in inventory_response.json() if item["name"] == "Burger Bun")
    starting_stock = Decimal(bun["current_stock"])
    payload = {
        "inventory_item_id": bun["id"],
        "type": "PURCHASE",
        "quantity_delta": "5.5",
        "reason": "Regression test delivery",
        "idempotency_key": "inventory-regression-purchase-0001",
    }

    created = await api.client.post(
        "/api/v1/inventory/movements",
        headers=headers,
        json=payload,
    )
    assert created.status_code == 201, created.text
    assert created.json()["item_name"] == "Burger Bun"
    assert Decimal(created.json()["balance_after"]) == starting_stock + Decimal("5.5")

    replay = await api.client.post(
        "/api/v1/inventory/movements",
        headers=headers,
        json=payload,
    )
    assert replay.status_code == 201, replay.text
    assert replay.json()["id"] == created.json()["id"]
    assert Decimal(replay.json()["balance_after"]) == starting_stock + Decimal("5.5")

    refreshed = await api.client.get("/api/v1/inventory/items", headers=headers)
    assert refreshed.status_code == 200, refreshed.text
    refreshed_bun = next(item for item in refreshed.json() if item["id"] == bun["id"])
    assert Decimal(refreshed_bun["current_stock"]) == starting_stock + Decimal("5.5")

    movements = await api.client.get("/api/v1/inventory/movements", headers=headers)
    assert movements.status_code == 200, movements.text
    created_movements = [
        item for item in movements.json() if item["id"] == created.json()["id"]
    ]
    assert len(created_movements) == 1
    assert created_movements[0]["type"] == "PURCHASE"
    assert created_movements[0]["reason"] == "Regression test delivery"

    invalid = await api.client.post(
        "/api/v1/inventory/movements",
        headers=headers,
        json={
            "inventory_item_id": bun["id"],
            "type": "WASTE",
            "quantity_delta": "1",
            "reason": "Invalid positive waste",
            "idempotency_key": "inventory-regression-waste-0001",
        },
    )
    assert invalid.status_code == 422, invalid.text
    assert invalid.json()["error"]["code"] == "invalid_stock_direction"


async def test_category_color_round_trips_through_create_update_and_list(
    api: ApiContext,
) -> None:
    owner = await login(api)
    headers = auth_headers(owner)

    created = await api.client.post(
        "/api/v1/catalog/categories",
        headers=headers,
        json={"name": "Regression Accent", "color": "#123ABC"},
    )
    assert created.status_code == 201, created.text
    assert created.json()["color"] == "#123ABC"
    category_id = created.json()["id"]

    updated = await api.client.patch(
        f"/api/v1/catalog/categories/{category_id}",
        headers=headers,
        json={"color": "#F05A24"},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["color"] == "#F05A24"

    categories = await api.client.get("/api/v1/catalog/categories", headers=headers)
    assert categories.status_code == 200, categories.text
    listed = next(item for item in categories.json()["items"] if item["id"] == category_id)
    assert listed["color"] == "#F05A24"

    invalid = await api.client.post(
        "/api/v1/catalog/categories",
        headers=headers,
        json={"name": "Invalid Regression Accent", "color": "orange"},
    )
    assert invalid.status_code == 422, invalid.text
