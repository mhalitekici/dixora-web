from __future__ import annotations

import asyncio
import hashlib
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import Database
from app.models import (
    Area,
    Branch,
    Category,
    DiningTable,
    InventoryItem,
    InventoryLocation,
    Modifier,
    ModifierGroup,
    PreparationStation,
    PrintBridgeClient,
    PrinterDevice,
    Product,
    ProductModifierGroup,
    ProductRecipe,
    ProductRecipeItem,
    QrMenuConfig,
    StockBalance,
    Subscription,
    SubscriptionFeature,
    SubscriptionPlan,
    Tenant,
    User,
)
from app.models.enums import QrOrderMode, TenantState
from app.rbac import ensure_role, ensure_tenant_role_presets
from app.security import hash_password, utcnow, verify_password
from app.services.pricing import (
    DEFAULT_ADDITIONAL_BRANCH_PRICE,
    DEFAULT_BASE_MONTHLY_PRICE,
    DEFAULT_CURRENCY,
    DEFAULT_INCLUDED_BRANCHES,
)

DEVELOPMENT_PASSWORDS = {
    "superadmin@dixora.app": "Dixora!2026",
    "owner@dixora.test": "DixoraLab!2026",
    "manager@dixora.test": "DixoraLab!2026",
    "cashier@dixora.test": "DixoraLab!2026",
    "waiter@dixora.test": "DixoraLab!2026",
    "kitchen@dixora.test": "DixoraLab!2026",
    "bar@dixora.test": "DixoraLab!2026",
}


async def _one_or_create(
    db: AsyncSession,
    model: type[Any],
    filters: dict[str, object],
    values: dict[str, object],
) -> Any:
    record = (await db.execute(select(model).filter_by(**filters))).scalar_one_or_none()
    if record is None:
        record = model(**filters, **values)
        db.add(record)
        await db.flush()
    return record


async def seed_database(db: AsyncSession) -> None:
    super_role = await ensure_role(db, tenant_id=None, code="SUPER_ADMIN")
    superadmin = (
        await db.execute(
            select(User).where(User.tenant_id.is_(None), User.username == "superadmin@dixora.app")
        )
    ).scalar_one_or_none()
    if superadmin is None:
        superadmin = User(
            tenant_id=None,
            branch_id=None,
            role_id=super_role.id,
            username="superadmin@dixora.app",
            email="superadmin@dixora.app",
            display_name="Dixora Super Admin",
            password_hash=hash_password(DEVELOPMENT_PASSWORDS["superadmin@dixora.app"]),
            is_super_admin=True,
        )
        db.add(superadmin)
    else:
        superadmin.role_id = super_role.id
        superadmin.is_active = True
        superadmin.is_super_admin = True
        if not verify_password(
            DEVELOPMENT_PASSWORDS["superadmin@dixora.app"], superadmin.password_hash
        ):
            superadmin.password_hash = hash_password(
                DEVELOPMENT_PASSWORDS["superadmin@dixora.app"]
            )

    tenant = await _one_or_create(
        db,
        Tenant,
        {"slug": "dixora-lab"},
        {
            "name": "Dixora Lab",
            "business_type": "BOUTIQUE_HOTEL",
            "state": TenantState.TRIAL,
            "is_active": True,
            "prevent_negative_stock": True,
            "default_currency": "TRY",
        },
    )
    branch = await _one_or_create(
        db,
        Branch,
        {"tenant_id": tenant.id, "slug": "merkez"},
        {
            "name": "Dixora Lab Main Branch",
            "timezone": "Europe/Istanbul",
            "is_active": True,
        },
    )
    roles = await ensure_tenant_role_presets(db, tenant.id)
    roles["BUSINESS_OWNER"] = await ensure_role(
        db, tenant_id=tenant.id, code="BUSINESS_OWNER", name="İşletme Sahibi"
    )
    # Legacy seeded operational accounts remain valid, but these roles are not assignable
    # from the business panel.
    roles["CASHIER"] = await ensure_role(db, tenant_id=tenant.id, code="CASHIER")
    roles["KITCHEN"] = await ensure_role(db, tenant_id=tenant.id, code="KITCHEN", name="Aşçı")
    users = [
        ("owner@dixora.test", "İşletme Sahibi", "BUSINESS_OWNER", None, None),
        ("manager@dixora.test", "Şube Yöneticisi", "BUSINESS_MANAGER", None, None),
        ("cashier@dixora.test", "Kasa Kullanıcısı", "CASHIER", branch.id, "1357"),
        ("waiter@dixora.test", "Servis Personeli", "WAITER", branch.id, "2468"),
        ("kitchen@dixora.test", "Kitchen User", "KITCHEN", branch.id, None),
        ("bar@dixora.test", "Bar User", "KITCHEN", branch.id, None),
    ]
    for username, display_name, role_code, branch_id, pin in users:
        user = (
            await db.execute(
                select(User).where(User.tenant_id == tenant.id, User.username == username)
            )
        ).scalar_one_or_none()
        if user is None:
            db.add(
                User(
                    tenant_id=tenant.id,
                    branch_id=branch_id,
                    role_id=roles[role_code].id,
                    username=username,
                    email=username,
                    display_name=display_name,
                    password_hash=hash_password(DEVELOPMENT_PASSWORDS[username]),
                    pin_hash=hash_password(pin) if pin else None,
                )
            )
            continue

        if not verify_password(DEVELOPMENT_PASSWORDS[username], user.password_hash):
            user.password_hash = hash_password(DEVELOPMENT_PASSWORDS[username])
        user.role_id = roles[role_code].id
        user.branch_id = branch_id
        user.is_active = True
        if pin and (user.pin_hash is None or not verify_password(pin, user.pin_hash)):
            user.pin_hash = hash_password(pin)

    area_specs = [
        ("Restaurant", "R", 10),
        ("Bar", "B", 5),
        ("Pool", "P", 8),
        ("Garden", "G", 6),
    ]
    for area_index, (area_name, prefix, count) in enumerate(area_specs):
        area = await _one_or_create(
            db,
            Area,
            {"tenant_id": tenant.id, "branch_id": branch.id, "name": area_name},
            {"sort_order": area_index, "is_active": True},
        )
        for number in range(1, count + 1):
            await _one_or_create(
                db,
                DiningTable,
                {
                    "tenant_id": tenant.id,
                    "branch_id": branch.id,
                    "area_id": area.id,
                    "name": f"{prefix}{number}",
                },
                {"capacity": 4, "sort_order": number, "is_active": True},
            )

    stations = {}
    for index, (name, code) in enumerate(
        [("Kitchen", "KITCHEN"), ("Bar", "BAR"), ("Dessert Station", "DESSERT")]
    ):
        stations[code] = await _one_or_create(
            db,
            PreparationStation,
            {"tenant_id": tenant.id, "branch_id": branch.id, "code": code},
            {"name": name, "sort_order": index},
        )

    category_names = [
        "Breakfast",
        "Main Courses",
        "Burgers",
        "Salads",
        "Desserts",
        "Hot Drinks",
        "Cold Drinks",
        "Alcohol-Free Cocktails",
    ]
    categories = {}
    for index, name in enumerate(category_names):
        categories[name] = await _one_or_create(
            db,
            Category,
            {"tenant_id": tenant.id, "branch_id": branch.id, "name": name},
            {"sort_order": index, "is_active": True},
        )

    legacy_breakfast = (
        await db.execute(
            select(Product).where(
                Product.tenant_id == tenant.id,
                Product.name == "Dixora Lab Breakfast",
                Product.description == "Dixora Lab signature elixir breakfast",
            )
        )
    ).scalar_one_or_none()
    if legacy_breakfast is not None:
        legacy_breakfast.description = "Arşivlenmiş geliştirme kahvaltı kaydı"
        legacy_breakfast.is_active = False
        legacy_breakfast.is_available = False
        legacy_breakfast.qr_visible = False
        legacy_breakfast.waiter_visible = False

    product_specs = [
        ("Kahvaltı Tabağı", "Breakfast", "KITCHEN", "420.00", False),
        ("Classic Burger", "Burgers", "KITCHEN", "360.00", True),
        ("Caesar Salad", "Salads", "KITCHEN", "295.00", False),
        ("San Sebastian Cheesecake", "Desserts", "DESSERT", "240.00", False),
        ("Turkish Coffee", "Hot Drinks", "BAR", "95.00", False),
        ("Homemade Lemonade", "Cold Drinks", "BAR", "140.00", False),
        ("Sunset Mocktail", "Alcohol-Free Cocktails", "BAR", "210.00", False),
    ]
    products = {}
    for index, (name, category_name, station_code, price, tracked) in enumerate(product_specs):
        products[name] = await _one_or_create(
            db,
            Product,
            {"tenant_id": tenant.id, "branch_id": branch.id, "name": name},
            {
                "category_id": categories[category_name].id,
                "preparation_station_id": stations[station_code].id,
                "selling_price": Decimal(price),
                "cost_price": Decimal(price) * Decimal("0.35"),
                "tax_rate": Decimal("10.00"),
                "track_inventory": tracked,
                "sort_order": index,
                "description": f"Dixora Lab signature {name.lower()}",
            },
        )

    extras = await _one_or_create(
        db,
        ModifierGroup,
        {"tenant_id": tenant.id, "name": "Burger Extras"},
        {"is_required": False, "minimum_selection": 0, "maximum_selection": 3},
    )
    await _one_or_create(
        db,
        ProductModifierGroup,
        {
            "tenant_id": tenant.id,
            "product_id": products["Classic Burger"].id,
            "modifier_group_id": extras.id,
        },
        {"sort_order": 0},
    )
    for index, (name, price) in enumerate(
        [("Extra Cheese", "35.00"), ("Jalapeño", "20.00"), ("Special Sauce", "15.00")]
    ):
        await _one_or_create(
            db,
            Modifier,
            {"tenant_id": tenant.id, "group_id": extras.id, "name": name},
            {"price_delta": Decimal(price), "sort_order": index},
        )

    stock_location = await _one_or_create(
        db,
        InventoryLocation,
        {"tenant_id": tenant.id, "branch_id": branch.id, "name": "Main Stock"},
        {"is_default": True, "is_active": True},
    )
    inventory_specs = [
        ("Burger Bun", "piece", "40"),
        ("Beef Patty", "gram", "12000"),
        ("Cheese Slice", "piece", "80"),
        ("Burger Sauce", "gram", "3000"),
    ]
    stock_items = {}
    for name, unit, quantity in inventory_specs:
        item = await _one_or_create(
            db,
            InventoryItem,
            {"tenant_id": tenant.id, "branch_id": branch.id, "name": name},
            {"unit": unit, "minimum_stock": Decimal("10"), "is_active": True},
        )
        stock_items[name] = item
        await _one_or_create(
            db,
            StockBalance,
            {
                "tenant_id": tenant.id,
                "branch_id": branch.id,
                "inventory_item_id": item.id,
                "location_id": stock_location.id,
            },
            {"quantity": Decimal(quantity)},
        )
    recipe = await _one_or_create(
        db,
        ProductRecipe,
        {
            "tenant_id": tenant.id,
            "branch_id": branch.id,
            "product_id": products["Classic Burger"].id,
        },
        {"yield_quantity": Decimal("1"), "is_active": True},
    )
    for ingredient, quantity in [
        ("Burger Bun", "1"),
        ("Beef Patty", "150"),
        ("Cheese Slice", "1"),
        ("Burger Sauce", "20"),
    ]:
        await _one_or_create(
            db,
            ProductRecipeItem,
            {
                "tenant_id": tenant.id,
                "recipe_id": recipe.id,
                "inventory_item_id": stock_items[ingredient].id,
            },
            {"branch_id": branch.id, "quantity": Decimal(quantity)},
        )

    await _one_or_create(
        db,
        QrMenuConfig,
        {"tenant_id": tenant.id, "branch_id": branch.id},
        {
            "menu_name": "Dixora Lab Menu",
            "is_enabled": True,
            "order_mode": QrOrderMode.WAITER_APPROVAL,
            "primary_color": "#F4511E",
            "currency": "TRY",
        },
    )
    await _one_or_create(
        db,
        PrinterDevice,
        {"tenant_id": tenant.id, "branch_id": branch.id, "code": "MOCK-KITCHEN"},
        {
            "name": "Mock Kitchen Printer",
            "preparation_station_id": stations["KITCHEN"].id,
            "transport": "MOCK",
        },
    )
    bridge_client = await _one_or_create(
        db,
        PrintBridgeClient,
        {"tenant_id": tenant.id, "branch_id": branch.id, "name": "Development Bridge"},
        {
            "token_hash": hashlib.sha256(b"pb_dev_dixora_lab_bridge_2026").hexdigest(),
            "is_active": True,
        },
    )
    bridge_client.token_hash = hashlib.sha256(
        b"pb_dev_dixora_lab_bridge_2026"
    ).hexdigest()
    bridge_client.is_active = True

    trial_plan = await _one_or_create(
        db,
        SubscriptionPlan,
        {"code": "TRIAL"},
        {
            "name": "Dixora Trial",
            "monthly_price": Decimal("0"),
            "currency": "TRY",
            "max_branches": 1,
            "max_users": 20,
        },
    )
    trial_plan.name = "Dixora Trial"
    trial_plan.monthly_price = Decimal("0")
    trial_plan.currency = "TRY"
    trial_plan.max_branches = 1
    trial_plan.max_users = 20
    for feature in [
        "QR_MENU",
        "QR_ORDERING",
        "INVENTORY",
        "KITCHEN_DISPLAY",
        "PRINT_BRIDGE",
        "REPORTS",
    ]:
        trial_feature = await _one_or_create(
            db,
            SubscriptionFeature,
            {"plan_id": trial_plan.id, "feature_code": feature},
            {"is_enabled": True},
        )
        trial_feature.is_enabled = True

    standard_plan = await _one_or_create(
        db,
        SubscriptionPlan,
        {"code": "STANDARD"},
        {
            "name": "Dixora Standard",
            "monthly_price": DEFAULT_BASE_MONTHLY_PRICE,
            "currency": DEFAULT_CURRENCY,
            "included_branches": DEFAULT_INCLUDED_BRANCHES,
            "additional_branch_price": DEFAULT_ADDITIONAL_BRANCH_PRICE,
            # Extra branches are billed, not blocked, so there is no hard cap.
            "max_branches": None,
            "max_users": 50,
        },
    )
    standard_plan.name = "Dixora Standard"
    standard_plan.monthly_price = DEFAULT_BASE_MONTHLY_PRICE
    standard_plan.currency = DEFAULT_CURRENCY
    standard_plan.included_branches = DEFAULT_INCLUDED_BRANCHES
    standard_plan.additional_branch_price = DEFAULT_ADDITIONAL_BRANCH_PRICE
    standard_plan.max_branches = None
    standard_plan.max_users = 50
    for feature in [
        "QR_MENU",
        "QR_ORDERING",
        "INVENTORY",
        "KITCHEN_DISPLAY",
        "PRINT_BRIDGE",
        "REPORTS",
    ]:
        standard_feature = await _one_or_create(
            db,
            SubscriptionFeature,
            {"plan_id": standard_plan.id, "feature_code": feature},
            {"is_enabled": True},
        )
        standard_feature.is_enabled = True
    await _one_or_create(
        db,
        Subscription,
        {"tenant_id": tenant.id},
        {
            "plan_id": trial_plan.id,
            "status": TenantState.TRIAL,
            "starts_at": utcnow(),
        },
    )
    await db.commit()


async def run() -> None:
    settings = get_settings()
    if settings.environment != "development" or not settings.dev_seed_enabled:
        raise RuntimeError(
            "The development seed requires a development environment and explicit opt-in."
        )
    database = Database(settings)
    try:
        async with database.session_factory() as session:
            await seed_database(session)
    finally:
        await database.dispose()
    print("Dixora development seed completed.")
    print("Business: dixora-lab / Branch: merkez")
    print("Development Print Bridge token: pb_dev_dixora_lab_bridge_2026")


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()
