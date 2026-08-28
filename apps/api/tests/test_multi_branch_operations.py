"""Running a second branch, with a catalogue shared across both.

Products belong to the business; preparation stations, printers, recipes and
tables belong to a branch. These tests pin down what has to happen where those
two scopes meet, which is the seam a single-branch install never exercises.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.models import (
    Area,
    Branch,
    DiningTable,
    InventoryItem,
    InventoryLocation,
    KitchenTicket,
    Order,
    OrderItem,
    PreparationStation,
    PrinterDevice,
    PrintJob,
    ProductRecipe,
    Role,
    Subscription,
    SubscriptionPlan,
    Tenant,
    User,
)
from app.security import hash_password
from tests.conftest import ApiContext, auth_headers, login

SECOND_BRANCH_SLUG = "ikinci-sube"
MANAGER_USERNAME = "sube2.mudur@dixora.test"
MANAGER_PASSWORD = "Ikinci-Sube!2026"

# Seeded and not inventory-tracked, so these tests exercise routing without
# dragging stock levels into it.
UNTRACKED_PRODUCT = "Turkish Coffee"
TRACKED_PRODUCT = "Classic Burger"


async def _open_second_branch(api: ApiContext) -> dict[str, Any]:
    """A second branch with its own stations, printers, floor and manager.

    Built directly rather than through the API so that the station-routing tests
    below are about routing alone, not about what branch creation happens to
    provision. The station codes deliberately match the first branch's, which is
    what a real chain looks like.
    """
    async with api.database.session_factory() as db:
        tenant = (
            await db.execute(select(Tenant).where(Tenant.slug == "dixora-lab"))
        ).scalar_one()
        first = (
            await db.execute(
                select(Branch).where(Branch.tenant_id == tenant.id, Branch.slug == "merkez")
            )
        ).scalar_one()
        role = (
            await db.execute(
                select(Role).where(
                    Role.tenant_id == tenant.id, Role.code == "BUSINESS_MANAGER"
                )
            )
        ).scalar_one()

        branch = Branch(
            tenant_id=tenant.id,
            name="İkinci Şube",
            slug=SECOND_BRANCH_SLUG,
            timezone="Europe/Istanbul",
            is_active=True,
        )
        db.add(branch)
        await db.flush()

        stations: dict[str, UUID] = {}
        for index, (name, code) in enumerate(
            [("Kitchen", "KITCHEN"), ("Bar", "BAR"), ("Dessert Station", "DESSERT")]
        ):
            station = PreparationStation(
                tenant_id=tenant.id,
                branch_id=branch.id,
                name=name,
                code=code,
                sort_order=index,
            )
            db.add(station)
            await db.flush()
            stations[code] = station.id
            db.add(
                PrinterDevice(
                    tenant_id=tenant.id,
                    branch_id=branch.id,
                    preparation_station_id=station.id,
                    code=f"B2-{code}",
                    name=f"İkinci Şube {name}",
                    transport="MOCK",
                )
            )

        area = Area(tenant_id=tenant.id, branch_id=branch.id, name="Salon", sort_order=0)
        db.add(area)
        await db.flush()
        table = DiningTable(
            tenant_id=tenant.id,
            branch_id=branch.id,
            area_id=area.id,
            name="S1",
            capacity=4,
            sort_order=1,
        )
        db.add(table)

        db.add(
            User(
                tenant_id=tenant.id,
                branch_id=branch.id,
                role_id=role.id,
                username=MANAGER_USERNAME,
                email=MANAGER_USERNAME,
                display_name="İkinci Şube Müdürü",
                password_hash=hash_password(MANAGER_PASSWORD),
                is_active=True,
            )
        )
        await db.commit()

        return {
            "tenant_id": tenant.id,
            "first_branch_id": first.id,
            "branch_id": branch.id,
            "stations": stations,
            "table_id": table.id,
        }


async def _manager_headers(api: ApiContext) -> dict[str, str]:
    tokens = await login(
        api,
        username=MANAGER_USERNAME,
        password=MANAGER_PASSWORD,
        business="dixora-lab",
    )
    return auth_headers(tokens)


async def _product_id(api: ApiContext, headers: dict[str, str], name: str) -> str:
    response = await api.client.get("/api/v1/catalog/products", headers=headers)
    assert response.status_code == 200, response.text
    return next(item for item in response.json()["items"] if item["name"] == name)["id"]


async def _place_order(
    api: ApiContext,
    headers: dict[str, str],
    *,
    table_id: str,
    product_id: str,
    idempotency_key: str,
    auto_accept: bool = True,
) -> Any:
    return await api.client.post(
        "/api/v1/orders",
        headers=headers,
        json={
            "table_id": table_id,
            "source": "WAITER",
            "items": [{"product_id": product_id, "quantity": "1.00"}],
            "idempotency_key": idempotency_key,
            "auto_accept": auto_accept,
        },
    )


# --------------------------------------------------------------------------
# The catalogue names one branch's station; every branch has to cook its own
# --------------------------------------------------------------------------


async def test_an_order_is_cooked_by_its_own_branch_station(api: ApiContext) -> None:
    """A shared product must not send its ticket to another branch's kitchen.

    `Product.preparation_station_id` can only name one branch's station, so
    without translation every branch's tickets would carry the main kitchen's id
    — invisible to the local station filter and unreachable by the local printer.
    """
    fixture = await _open_second_branch(api)
    headers = await _manager_headers(api)
    created = await _place_order(
        api,
        headers,
        table_id=str(fixture["table_id"]),
        product_id=await _product_id(api, headers, UNTRACKED_PRODUCT),
        idempotency_key="second-branch-order-1",
    )
    assert created.status_code == 201, created.text
    order_id = UUID(created.json()["id"])

    local_stations = set(fixture["stations"].values())
    async with api.database.session_factory() as db:
        items = (
            (await db.execute(select(OrderItem).where(OrderItem.order_id == order_id)))
            .scalars()
            .all()
        )
        assert items
        for item in items:
            assert item.preparation_station_id in local_stations, (
                "an order line was routed to a station outside its own branch"
            )

        tickets = (
            (
                await db.execute(
                    select(KitchenTicket).where(KitchenTicket.order_id == order_id)
                )
            )
            .scalars()
            .all()
        )
        assert tickets, "the order produced no kitchen ticket at all"
        for ticket in tickets:
            assert ticket.branch_id == fixture["branch_id"]
            assert ticket.preparation_station_id in local_stations


async def test_the_second_branch_ticket_finds_its_own_printer(api: ApiContext) -> None:
    """The printer lookup asks for a device in this branch on that station.

    It only ever matches when the station is the local one, so this is what makes
    the routing fix worth having rather than merely tidy.
    """
    fixture = await _open_second_branch(api)
    headers = await _manager_headers(api)
    created = await _place_order(
        api,
        headers,
        table_id=str(fixture["table_id"]),
        product_id=await _product_id(api, headers, UNTRACKED_PRODUCT),
        idempotency_key="second-branch-order-2",
    )
    assert created.status_code == 201, created.text

    async with api.database.session_factory() as db:
        jobs = (
            (
                await db.execute(
                    select(PrintJob).where(PrintJob.order_id == UUID(created.json()["id"]))
                )
            )
            .scalars()
            .all()
        )
        assert jobs, "accepting an order produced no print job"
        for job in jobs:
            assert job.branch_id == fixture["branch_id"]
            assert job.printer_device_id is not None, (
                "the ticket had no printer, so nothing would come out of it"
            )
            device = await db.get(PrinterDevice, job.printer_device_id)
            assert device is not None and device.branch_id == fixture["branch_id"]


async def test_the_main_branch_still_uses_its_own_station(api: ApiContext) -> None:
    """The translation must be a no-op where the catalogue already points."""
    fixture = await _open_second_branch(api)
    owner = auth_headers(await login(api))
    tables = await api.client.get("/api/v1/tables", headers=owner)
    created = await _place_order(
        api,
        owner,
        table_id=tables.json()[0]["id"],
        product_id=await _product_id(api, owner, UNTRACKED_PRODUCT),
        idempotency_key="main-branch-order-1",
    )
    assert created.status_code == 201, created.text

    async with api.database.session_factory() as db:
        order = await db.get(Order, UUID(created.json()["id"]))
        assert order is not None and order.branch_id == fixture["first_branch_id"]
        items = (
            (await db.execute(select(OrderItem).where(OrderItem.order_id == order.id)))
            .scalars()
            .all()
        )
        assert items
        for item in items:
            assert item.preparation_station_id is not None
            station = await db.get(PreparationStation, item.preparation_station_id)
            assert station is not None
            assert station.branch_id == fixture["first_branch_id"]


# --------------------------------------------------------------------------
# One branch's records are not another's
# --------------------------------------------------------------------------


async def test_a_branch_manager_cannot_open_another_branchs_order(
    api: ApiContext,
) -> None:
    """Knowing an id is not access. The business matches; the branch must too."""
    await _open_second_branch(api)
    owner = auth_headers(await login(api))
    tables = await api.client.get("/api/v1/tables", headers=owner)
    created = await _place_order(
        api,
        owner,
        table_id=tables.json()[0]["id"],
        product_id=await _product_id(api, owner, UNTRACKED_PRODUCT),
        idempotency_key="main-branch-order-2",
        auto_accept=False,
    )
    assert created.status_code == 201, created.text
    foreign_order_id = created.json()["id"]

    headers = await _manager_headers(api)
    for method, path in (
        ("GET", f"/api/v1/orders/{foreign_order_id}"),
        ("POST", f"/api/v1/orders/{foreign_order_id}/accept"),
        ("POST", f"/api/v1/orders/{foreign_order_id}/bill-request"),
        ("POST", f"/api/v1/orders/{foreign_order_id}/payments"),
    ):
        response = await api.client.request(method, path, headers=headers, json={})
        assert response.status_code in (403, 422), (
            f"{method} {path} reached another branch's order: "
            f"{response.status_code} {response.text}"
        )
        if response.status_code == 403:
            assert response.json()["error"]["code"] == "branch_forbidden"


async def test_the_branch_switcher_only_offers_reachable_branches(
    api: ApiContext,
) -> None:
    """A pinned manager must not be handed a branch they cannot act in."""
    fixture = await _open_second_branch(api)
    headers = await _manager_headers(api)

    response = await api.client.get("/api/v1/auth/branches", headers=headers)
    assert response.status_code == 200, response.text
    assert {row["id"] for row in response.json()["branches"]} == {
        str(fixture["branch_id"])
    }

    owner = auth_headers(await login(api))
    everything = await api.client.get("/api/v1/branches", headers=owner)
    assert everything.status_code == 200
    assert len(everything.json()) == 2, "the owner should still see the whole business"


# --------------------------------------------------------------------------
# A new branch has to arrive able to work
# --------------------------------------------------------------------------


async def _use_paid_plan(api: ApiContext) -> None:
    """Trials are capped at one branch; opening a second one needs the paid plan."""
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


async def _create_branch_via_api(api: ApiContext, headers: dict[str, str]) -> str:
    await _use_paid_plan(api)
    response = await api.client.post(
        "/api/v1/branches",
        headers=headers,
        json={"name": "Yeni Şube", "slug": "yeni-sube", "timezone": "Europe/Istanbul"},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def test_a_new_branch_arrives_with_the_stations_it_needs(api: ApiContext) -> None:
    """Without stations there is no ticket, because a ticket is grouped by one.

    An empty branch accepted orders and quietly produced nothing for the kitchen,
    which is the worst shape a failure can take: the till looks fine.
    """
    owner = auth_headers(await login(api))
    branch_id = UUID(await _create_branch_via_api(api, owner))

    async with api.database.session_factory() as db:
        stations = (
            (
                await db.execute(
                    select(PreparationStation).where(
                        PreparationStation.branch_id == branch_id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert {station.code for station in stations} == {"KITCHEN", "BAR", "DESSERT"}


async def test_a_new_branch_arrives_with_inventory_and_recipes(api: ApiContext) -> None:
    """Recipes are per branch while `track_inventory` is per product.

    A branch without them refuses every tracked product with `recipe_missing`,
    which reads as a bug at the till rather than as the setup step it is.
    """
    owner = auth_headers(await login(api))
    branch_id = UUID(await _create_branch_via_api(api, owner))

    async with api.database.session_factory() as db:
        location = (
            await db.execute(
                select(InventoryLocation).where(
                    InventoryLocation.branch_id == branch_id,
                    InventoryLocation.is_default.is_(True),
                )
            )
        ).scalar_one_or_none()
        assert location is not None, "the new branch has nowhere to hold stock"

        items = (
            (
                await db.execute(
                    select(InventoryItem).where(InventoryItem.branch_id == branch_id)
                )
            )
            .scalars()
            .all()
        )
        assert items, "the new branch inherited no ingredients"

        recipes = (
            (
                await db.execute(
                    select(ProductRecipe)
                    .where(ProductRecipe.branch_id == branch_id)
                )
            )
            .scalars()
            .all()
        )
        assert recipes, "the new branch inherited no recipes"
        # Every ingredient must point at this branch's own row, never the
        # source branch's, or the new branch would deduct someone else's stock.
        local_item_ids = {item.id for item in items}
        for recipe in recipes:
            lines = list(recipe.items)
            assert lines
            for line in lines:
                assert line.branch_id == branch_id
                assert line.inventory_item_id in local_item_ids


async def test_a_new_branch_starts_with_empty_shelves(api: ApiContext) -> None:
    """Copying the blueprint must not copy the other branch's stock with it."""
    owner = auth_headers(await login(api))
    branch_id = UUID(await _create_branch_via_api(api, owner))

    async with api.database.session_factory() as db:
        items = (
            (
                await db.execute(
                    select(InventoryItem).where(InventoryItem.branch_id == branch_id)
                )
            )
            .scalars()
            .all()
        )
        assert items
    response = await api.client.get(
        "/api/v1/inventory/items", headers=owner, params={"branch_id": str(branch_id)}
    )
    assert response.status_code == 200, response.text
    for row in response.json():
        assert row["current_stock"] in ("0", "0.000000", "0.00"), row


async def test_a_tracked_product_fails_on_stock_not_on_configuration(
    api: ApiContext,
) -> None:
    """The remaining obstacle must be one the stock screen can clear.

    `recipe_missing` tells an operator nothing they can act on mid-service;
    `insufficient_stock` points straight at the count they need to enter.
    """
    owner = auth_headers(await login(api))
    branch_id = await _create_branch_via_api(api, owner)

    async with api.database.session_factory() as db:
        tenant = (
            await db.execute(select(Tenant).where(Tenant.slug == "dixora-lab"))
        ).scalar_one()
        area = Area(
            tenant_id=tenant.id, branch_id=UUID(branch_id), name="Salon", sort_order=0
        )
        db.add(area)
        await db.flush()
        table = DiningTable(
            tenant_id=tenant.id,
            branch_id=UUID(branch_id),
            area_id=area.id,
            name="Y1",
            capacity=4,
            sort_order=1,
        )
        db.add(table)
        await db.commit()
        table_id = str(table.id)

    switched = await api.client.post(
        "/api/v1/auth/switch-branch",
        json={
            "refresh_token": (await login(api))["refresh_token"],
            "branch_id": branch_id,
        },
    )
    assert switched.status_code == 200, switched.text
    headers = auth_headers(switched.json())

    response = await _place_order(
        api,
        headers,
        table_id=table_id,
        product_id=await _product_id(api, headers, TRACKED_PRODUCT),
        idempotency_key="new-branch-tracked-1",
    )
    assert response.status_code == 409, response.text
    assert response.json()["error"]["code"] == "insufficient_stock", response.text


# --------------------------------------------------------------------------
# A branch's own section of the menu stays its own
# --------------------------------------------------------------------------


async def test_a_branch_scoped_product_cannot_be_sold_elsewhere(
    api: ApiContext,
) -> None:
    """The QR menu has always hidden another branch's categories; the till had not.

    A category pinned to a branch is that branch's part of the menu. Leaving the
    order service to check only the business meant a product could be invisible
    to a branch's customers and still be rung up on its own register.
    """
    fixture = await _open_second_branch(api)
    owner = auth_headers(await login(api))

    category = await api.client.post(
        "/api/v1/catalog/categories",
        headers=owner,
        json={
            "name": "Sadece İkinci Şube",
            "branch_id": str(fixture["branch_id"]),
            "sort_order": 99,
        },
    )
    assert category.status_code == 201, category.text
    product = await api.client.post(
        "/api/v1/catalog/products",
        headers=owner,
        json={
            "category_id": category.json()["id"],
            "name": "Şubeye Özel Tatlı",
            "selling_price": "150.00",
            "tax_rate": "10.00",
        },
    )
    assert product.status_code == 201, product.text
    product_id = product.json()["id"]

    tables = await api.client.get("/api/v1/tables", headers=owner)
    refused = await _place_order(
        api,
        owner,
        table_id=tables.json()[0]["id"],
        product_id=product_id,
        idempotency_key="wrong-branch-product-1",
    )
    assert refused.status_code == 409, refused.text
    assert refused.json()["error"]["code"] == "product_not_available"

    accepted = await _place_order(
        api,
        await _manager_headers(api),
        table_id=str(fixture["table_id"]),
        product_id=product_id,
        idempotency_key="right-branch-product-1",
    )
    assert accepted.status_code == 201, accepted.text


async def test_the_product_list_can_be_narrowed_to_one_branch(api: ApiContext) -> None:
    """So a till can show what it may actually sell, and only that."""
    fixture = await _open_second_branch(api)
    owner = auth_headers(await login(api))

    category = await api.client.post(
        "/api/v1/catalog/categories",
        headers=owner,
        json={
            "name": "Sadece İkinci Şube",
            "branch_id": str(fixture["branch_id"]),
            "sort_order": 99,
        },
    )
    assert category.status_code == 201, category.text
    product = await api.client.post(
        "/api/v1/catalog/products",
        headers=owner,
        json={
            "category_id": category.json()["id"],
            "name": "Şubeye Özel Tatlı",
            "selling_price": "150.00",
            "tax_rate": "10.00",
        },
    )
    assert product.status_code == 201, product.text
    special = product.json()["id"]

    everything = await api.client.get("/api/v1/catalog/products", headers=owner)
    assert special in {row["id"] for row in everything.json()["items"]}, (
        "the catalogue screen must still manage the whole business"
    )

    main_only = await api.client.get(
        "/api/v1/catalog/products",
        headers=owner,
        params={"branch_id": str(fixture["first_branch_id"])},
    )
    assert main_only.status_code == 200, main_only.text
    assert special not in {row["id"] for row in main_only.json()["items"]}

    second_only = await api.client.get(
        "/api/v1/catalog/products",
        headers=owner,
        params={"branch_id": str(fixture["branch_id"])},
    )
    assert second_only.status_code == 200, second_only.text
    assert special in {row["id"] for row in second_only.json()["items"]}
