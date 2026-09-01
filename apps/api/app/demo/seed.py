"""Builds the Meydan Restaurant demo business.

This is the structural pass: business, branches, staff, floor plan, menu,
inventory, loyalty and subscription. Trade — orders, payments, tickets, shifts —
is generated afterwards by `app.demo.history`, which needs everything here to
already exist.

Everything is written under one tenant slug, so the demo can be torn down and
rebuilt without touching any other business in the database.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from random import Random
from uuid import UUID, uuid4

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.demo import data as D
from app.demo.context import (
    BranchContext,
    DemoContext,
    MembershipContext,
    ModifierGroupContext,
    ProductContext,
)
from app.models import (
    Area,
    Branch,
    Campaign,
    CampaignBranch,
    Category,
    DiningTable,
    InventoryItem,
    InventoryLocation,
    Invoice,
    LoyaltyCustomer,
    LoyaltyMembership,
    LoyaltyProgram,
    LoyaltyProgramBranch,
    LoyaltyRule,
    MarketplaceIntegration,
    Modifier,
    ModifierGroup,
    PreparationStation,
    PrintBridgeClient,
    PrinterDevice,
    Product,
    ProductModifierGroup,
    ProductRecipe,
    ProductRecipeItem,
    ProductVariant,
    QrMenuConfig,
    StockBalance,
    Subscription,
    SubscriptionFeature,
    SubscriptionPlan,
    Tenant,
    TenantOnboarding,
    User,
    UserBranchMembership,
)
from app.models.enums import (
    CampaignAudience,
    CampaignRewardKind,
    LoyaltyCampaignType,
    MarketplaceProvider,
    QrOrderMode,
    TenantState,
)
from app.rbac import ensure_role, ensure_tenant_role_presets
from app.security import hash_password
from app.services.billing import invoice_number
from app.services.pricing import (
    DEFAULT_ADDITIONAL_BRANCH_PRICE,
    DEFAULT_BASE_MONTHLY_PRICE,
    DEFAULT_CURRENCY,
    DEFAULT_INCLUDED_BRANCHES,
    quote_monthly_total,
)

# Every tenant-scoped table, ordered so each row is removed before whatever it
# points at. Used only to rebuild the demo from scratch; nothing else is touched.
PURGE_ORDER: tuple[str, ...] = (
    "loyalty_redemptions",
    "loyalty_rewards",
    "loyalty_ledger_entries",
    "loyalty_email_verifications",
    "loyalty_verification_challenges",
    "campaign_applications",
    "campaign_branches",
    "campaigns",
    "qr_order_requests",
    "print_jobs",
    "kitchen_ticket_items",
    "kitchen_tickets",
    "delivery_orders",
    "marketplace_product_mappings",
    "marketplace_integrations",
    "payments",
    "cancellations",
    "approval_requests",
    "order_operations",
    "order_notes",
    "order_item_modifiers",
    "stock_movements",
    "stock_adjustments",
    "stock_counts",
    "discounts",
    "order_items",
    "orders",
    "table_sessions",
    "loyalty_memberships",
    "loyalty_customers",
    "loyalty_program_branches",
    "loyalty_rules",
    "loyalty_programs",
    "dining_tables",
    "areas",
    "hotel_room_checkouts",
    "hotel_rooms",
    "cashier_shifts",
    "stock_balances",
    "product_recipe_items",
    "product_recipes",
    "inventory_items",
    "inventory_locations",
    "content_translations",
    "product_branch_availability",
    "product_modifier_groups",
    "product_variants",
    "products",
    "modifiers",
    "modifier_groups",
    "categories",
    "qr_menu_configs",
    "printer_devices",
    "print_bridge_clients",
    "preparation_stations",
    "suppliers",
    "payment_attempts",
    "invoices",
    "saved_cards",
    "subscriptions",
    "tenant_feature_overrides",
    "tenant_onboarding",
    "audit_logs",
    "realtime_tickets",
    "auth_sessions",
    "trusted_devices",
    "user_branch_memberships",
    "users",
)

PLAN_FEATURES = (
    "QR_MENU",
    "QR_ORDERING",
    "INVENTORY",
    "KITCHEN_DISPLAY",
    "PRINT_BRIDGE",
    "REPORTS",
    "LOYALTY",
    "CAMPAIGNS",
    "DELIVERY",
)

CARD_ALPHABET = "ACDEFGHJKMNPQRTUVWXY2346789"


async def find_demo_tenant(db: AsyncSession) -> Tenant | None:
    return (
        await db.execute(select(Tenant).where(Tenant.slug == D.TENANT_SLUG))
    ).scalar_one_or_none()


async def purge_demo_tenant(db: AsyncSession, tenant_id: UUID) -> None:
    """Remove every row belonging to the demo tenant, then the tenant itself."""
    for table in PURGE_ORDER:
        await db.execute(
            text(f"DELETE FROM {table} WHERE tenant_id = :tenant_id"),
            {"tenant_id": tenant_id},
        )
    await db.execute(
        text(
            "DELETE FROM role_permissions WHERE role_id IN "
            "(SELECT id FROM roles WHERE tenant_id = :tenant_id)"
        ),
        {"tenant_id": tenant_id},
    )
    for table in ("roles", "branches"):
        await db.execute(
            text(f"DELETE FROM {table} WHERE tenant_id = :tenant_id"),
            {"tenant_id": tenant_id},
        )
    await db.execute(text("DELETE FROM tenants WHERE id = :tenant_id"), {"tenant_id": tenant_id})
    await db.flush()


def _unique_code(rng: Random, seen: set[str], prefix: str, length: int) -> str:
    while True:
        code = prefix + "".join(rng.choice(CARD_ALPHABET) for _ in range(length))
        if code not in seen:
            seen.add(code)
            return code


async def build_structure(
    db: AsyncSession,
    *,
    rng: Random,
    history_days: int,
) -> DemoContext:
    now = datetime.now(UTC)
    opened_at = now - timedelta(days=history_days + 30)

    tenant = Tenant(
        name=D.TENANT_NAME,
        slug=D.TENANT_SLUG,
        business_type=D.TENANT_BUSINESS_TYPE,
        state=TenantState.ACTIVE,
        is_active=True,
        prevent_negative_stock=True,
        default_currency="TRY",
        created_at=opened_at,
        updated_at=opened_at,
    )
    db.add(tenant)
    await db.flush()

    db.add(
        TenantOnboarding(
            tenant_id=tenant.id,
            offers_delivery=True,
            delivery_platforms=["GETIR", "YEMEKSEPETI", "TRENDYOL"],
            payment_methods=["CASH", "CARD", "MEAL_CARD"],
            accepts_meal_cards=True,
            meal_card_providers=["Multinet", "Sodexo", "Ticket"],
            monthly_order_volume="3000+",
            table_count=52,
            heard_from="referral",
            completed_at=opened_at,
        )
    )

    context = DemoContext(tenant_id=tenant.id, currency="TRY", owner_id=uuid4())

    await _build_subscription(db, tenant, history_days=history_days, now=now)
    await _build_branches(db, context, opened_at=opened_at)
    # Stations first: kitchen staff are pinned to one, and every product needs
    # one to route its tickets.
    await _build_floor_plan(db, context)
    await _build_staff(db, context, opened_at=opened_at)
    await _build_menu(db, context)
    await _build_inventory(db, context)
    await _build_service_config(db, context, now=now)
    await _build_loyalty(db, context, rng=rng, opened_at=opened_at)
    await _build_campaigns(db, context, opened_at=opened_at)
    await db.flush()
    return context


# --------------------------------------------------------------------------
# Subscription and billing
# --------------------------------------------------------------------------


async def _ensure_standard_plan(db: AsyncSession) -> SubscriptionPlan:
    plan = (
        await db.execute(select(SubscriptionPlan).where(SubscriptionPlan.code == "STANDARD"))
    ).scalar_one_or_none()
    if plan is None:
        plan = SubscriptionPlan(
            code="STANDARD",
            name="Dixora Standard",
            monthly_price=DEFAULT_BASE_MONTHLY_PRICE,
            currency=DEFAULT_CURRENCY,
            included_branches=DEFAULT_INCLUDED_BRANCHES,
            additional_branch_price=DEFAULT_ADDITIONAL_BRANCH_PRICE,
            max_branches=None,
            max_users=50,
        )
        db.add(plan)
        await db.flush()
    existing = {
        feature.feature_code
        for feature in (
            await db.execute(
                select(SubscriptionFeature).where(SubscriptionFeature.plan_id == plan.id)
            )
        )
        .scalars()
        .all()
    }
    for code in PLAN_FEATURES:
        if code not in existing:
            db.add(SubscriptionFeature(plan_id=plan.id, feature_code=code, is_enabled=True))
    await db.flush()
    return plan


def _month_starts(*, months: int, until: date) -> list[date]:
    """The first day of each of the last `months` calendar months, oldest first."""
    starts: list[date] = []
    cursor = until.replace(day=1)
    for _ in range(months):
        starts.append(cursor)
        cursor = (cursor - timedelta(days=1)).replace(day=1)
    return list(reversed(starts))


async def _build_subscription(
    db: AsyncSession,
    tenant: Tenant,
    *,
    history_days: int,
    now: datetime,
) -> None:
    plan = await _ensure_standard_plan(db)
    started = now - timedelta(days=history_days + 30)
    db.add(
        Subscription(
            tenant_id=tenant.id,
            plan_id=plan.id,
            status=TenantState.ACTIVE,
            starts_at=started,
            created_at=started,
            updated_at=started,
        )
    )
    await db.flush()
    subscription = (
        await db.execute(select(Subscription).where(Subscription.tenant_id == tenant.id))
    ).scalar_one()

    branch_count = len(D.BRANCHES)
    amount = quote_monthly_total(
        base_monthly_price=plan.monthly_price,
        included_branches=plan.included_branches,
        additional_branch_price=plan.additional_branch_price,
        active_branches=branch_count,
    )
    extra = amount - plan.monthly_price
    today = now.date()
    for index, period_start in enumerate(_month_starts(months=4, until=today)):
        if period_start.month == 12:
            period_end = period_start.replace(year=period_start.year + 1, month=1)
        else:
            period_end = period_start.replace(month=period_start.month + 1)
        period_end -= timedelta(days=1)
        issued_at = datetime.combine(period_start, datetime.min.time(), tzinfo=UTC)
        is_current = period_start == today.replace(day=1)
        db.add(
            Invoice(
                tenant_id=tenant.id,
                subscription_id=subscription.id,
                number=invoice_number(tenant.slug, period_start),
                amount=amount,
                currency=plan.currency,
                status="ISSUED" if is_current else "PAID",
                issued_at=issued_at,
                due_at=issued_at + timedelta(days=7),
                paid_at=None if is_current else issued_at + timedelta(days=2, hours=4),
                period_start=period_start,
                period_end=period_end,
                branch_count=branch_count,
                base_amount=plan.monthly_price,
                extra_branch_amount=extra,
                attempt_count=0 if is_current else 1,
                created_at=issued_at,
                updated_at=issued_at,
            )
        )
        del index
    await db.flush()


# --------------------------------------------------------------------------
# Branches, staff and floor plan
# --------------------------------------------------------------------------


async def _build_branches(
    db: AsyncSession, context: DemoContext, *, opened_at: datetime
) -> None:
    for offset, spec in enumerate(D.BRANCHES):
        # The second and third branches opened later, which is what makes the
        # branch comparison in reports interesting rather than symmetrical.
        created = opened_at + timedelta(days=offset * 12)
        branch = Branch(
            tenant_id=context.tenant_id,
            name=spec.name,
            slug=spec.slug,
            timezone="Europe/Istanbul",
            address=spec.address,
            phone=spec.phone,
            working_hours=D.WORKING_HOURS,
            is_active=True,
            created_at=created,
            updated_at=created,
        )
        db.add(branch)
        await db.flush()
        context.branches.append(BranchContext(spec=spec, id=branch.id))


async def _build_staff(
    db: AsyncSession, context: DemoContext, *, opened_at: datetime
) -> None:
    roles = await ensure_tenant_role_presets(db, context.tenant_id)
    for code, name in (
        ("BUSINESS_OWNER", "İşletme Sahibi"),
        ("KITCHEN", "Mutfak"),
        ("ACCOUNTANT", "Muhasebe"),
    ):
        roles[code] = await ensure_role(db, tenant_id=context.tenant_id, code=code, name=name)

    password_hash = hash_password(D.DEMO_PASSWORD)

    for spec in D.HQ_STAFF:
        user = User(
            tenant_id=context.tenant_id,
            branch_id=context.branches[0].id,
            role_id=roles[spec.role].id,
            username=f"{spec.local_part}@{D.EMAIL_DOMAIN}",
            email=f"{spec.local_part}@{D.EMAIL_DOMAIN}",
            phone=spec.phone,
            display_name=spec.display_name,
            password_hash=password_hash,
            pin_hash=hash_password(spec.pin) if spec.pin else None,
            is_active=True,
            created_at=opened_at,
            updated_at=opened_at,
        )
        db.add(user)
        await db.flush()
        if spec.role == "BUSINESS_OWNER":
            context.owner_id = user.id

    for branch in context.branches:
        for spec in D.BRANCH_STAFF[branch.slug]:
            user = User(
                tenant_id=context.tenant_id,
                branch_id=branch.id,
                role_id=roles[spec.role].id,
                preparation_station_id=(
                    branch.stations[spec.station] if spec.station else None
                ),
                username=f"{spec.local_part}@{D.EMAIL_DOMAIN}",
                email=f"{spec.local_part}@{D.EMAIL_DOMAIN}",
                phone=spec.phone,
                display_name=spec.display_name,
                password_hash=password_hash,
                pin_hash=hash_password(spec.pin) if spec.pin else None,
                is_active=True,
                created_at=opened_at,
                updated_at=opened_at,
            )
            db.add(user)
            await db.flush()
            if spec.role == "BUSINESS_MANAGER":
                branch.manager_id = user.id
            elif spec.role == "CASHIER":
                branch.cashiers.append(user.id)
                branch.cashier_names[user.id] = spec.display_name
            elif spec.role == "WAITER":
                branch.waiters.append(user.id)

    # One regional manager covering a second branch, so the multi-branch
    # membership path has real data behind it.
    kadikoy = context.branches[0]
    besiktas = context.branches[1] if len(context.branches) > 1 else None
    if kadikoy.manager_id and besiktas is not None:
        db.add(
            UserBranchMembership(
                tenant_id=context.tenant_id,
                user_id=kadikoy.manager_id,
                branch_id=besiktas.id,
                is_active=True,
            )
        )
    await db.flush()


async def _build_floor_plan(db: AsyncSession, context: DemoContext) -> None:
    for branch in context.branches:
        for index, (name, code) in enumerate(D.STATIONS):
            station = PreparationStation(
                tenant_id=context.tenant_id,
                branch_id=branch.id,
                name=name,
                code=code,
                sort_order=index,
                is_active=True,
            )
            db.add(station)
            await db.flush()
            branch.stations[code] = station.id

        for area_index, (area_name, prefix, count) in enumerate(branch.spec.areas):
            area = Area(
                tenant_id=context.tenant_id,
                branch_id=branch.id,
                name=area_name,
                sort_order=area_index,
                is_active=True,
            )
            db.add(area)
            await db.flush()
            for number in range(1, count + 1):
                table = DiningTable(
                    tenant_id=context.tenant_id,
                    branch_id=branch.id,
                    area_id=area.id,
                    name=f"{prefix}{number}",
                    capacity=2 if number % 5 == 0 else (6 if number % 7 == 0 else 4),
                    sort_order=number,
                    is_active=True,
                    shape="ROUND" if number % 3 == 0 else "SQUARE",
                    visual_position={"x": 60 + (number % 5) * 130, "y": 60 + (number // 5) * 120},
                )
                db.add(table)
                await db.flush()
                branch.tables.append((table.id, table.name, area.id))
    await db.flush()


# --------------------------------------------------------------------------
# Menu
# --------------------------------------------------------------------------


async def _build_menu(db: AsyncSession, context: DemoContext) -> None:
    main_branch = context.branches[0]

    for index, (name, color) in enumerate(D.CATEGORIES):
        category = Category(
            tenant_id=context.tenant_id,
            branch_id=main_branch.id,
            name=name,
            color=color,
            sort_order=index,
            is_active=True,
        )
        db.add(category)
        await db.flush()
        context.categories[name] = category.id
        context.products_by_category[name] = []

    for index, spec in enumerate(D.PRODUCTS):
        price = Decimal(spec.price)
        product = Product(
            tenant_id=context.tenant_id,
            branch_id=main_branch.id,
            category_id=context.categories[spec.category],
            preparation_station_id=main_branch.stations[spec.station],
            name=spec.name,
            description=spec.description,
            sku=f"MYD-{index + 1:03d}",
            selling_price=price,
            cost_price=(price * Decimal("0.34")).quantize(Decimal("0.01")),
            tax_rate=Decimal(spec.tax_rate),
            is_active=True,
            is_available=True,
            qr_visible=True,
            waiter_visible=True,
            preparation_minutes=spec.prep_minutes,
            track_inventory=spec.tracked,
            sort_order=index,
            allergens=list(spec.allergens),
            calories=spec.calories,
            tags=list(spec.tags),
        )
        db.add(product)
        await db.flush()
        entry = ProductContext(
            id=product.id,
            spec=spec,
            category_id=product.category_id,
            category_name=spec.category,
        )
        context.products.append(entry)
        context.products_by_name[spec.name] = entry
        context.products_by_category[spec.category].append(entry)

    for name, variants in D.PRODUCT_VARIANTS.items():
        entry = context.products_by_name[name]
        for order, (variant_name, delta) in enumerate(variants):
            db.add(
                ProductVariant(
                    tenant_id=context.tenant_id,
                    product_id=entry.id,
                    name=variant_name,
                    price_delta=Decimal(delta),
                    sort_order=order,
                    is_active=True,
                )
            )

    for group_index, group_spec in enumerate(D.MODIFIER_GROUPS):
        group = ModifierGroup(
            tenant_id=context.tenant_id,
            name=group_spec.name,
            is_required=group_spec.is_required,
            minimum_selection=group_spec.minimum,
            maximum_selection=group_spec.maximum,
            sort_order=group_index,
            is_active=True,
        )
        db.add(group)
        await db.flush()
        options: list[tuple[UUID, str, Decimal]] = []
        for order, (modifier_name, delta) in enumerate(group_spec.modifiers):
            modifier = Modifier(
                tenant_id=context.tenant_id,
                group_id=group.id,
                name=modifier_name,
                price_delta=Decimal(delta),
                sort_order=order,
                is_active=True,
            )
            db.add(modifier)
            await db.flush()
            options.append((modifier.id, modifier_name, Decimal(delta)))

        group_context = ModifierGroupContext(
            id=group.id,
            name=group_spec.name,
            is_required=group_spec.is_required,
            minimum=group_spec.minimum,
            maximum=group_spec.maximum,
            options=tuple(options),
        )
        for product_name in group_spec.products:
            linked = context.products_by_name[product_name]
            db.add(
                ProductModifierGroup(
                    tenant_id=context.tenant_id,
                    product_id=linked.id,
                    modifier_group_id=group.id,
                    sort_order=group_index,
                )
            )
            context.modifier_groups_by_product.setdefault(linked.id, []).append(group_context)
    await db.flush()


# --------------------------------------------------------------------------
# Inventory
# --------------------------------------------------------------------------


async def _build_inventory(db: AsyncSession, context: DemoContext) -> None:
    for branch in context.branches:
        location = InventoryLocation(
            tenant_id=context.tenant_id,
            branch_id=branch.id,
            name="Ana Depo",
            is_default=True,
            is_active=True,
        )
        db.add(location)
        await db.flush()
        branch.location_id = location.id

        for index, spec in enumerate(D.INVENTORY):
            item = InventoryItem(
                tenant_id=context.tenant_id,
                branch_id=branch.id,
                name=spec.name,
                sku=f"STK-{index + 1:03d}",
                unit=spec.unit,
                minimum_stock=Decimal(spec.minimum_stock),
                average_cost=Decimal(spec.unit_cost),
                is_active=True,
            )
            db.add(item)
            await db.flush()
            branch.inventory[spec.name] = item.id
            db.add(
                StockBalance(
                    tenant_id=context.tenant_id,
                    branch_id=branch.id,
                    inventory_item_id=item.id,
                    location_id=location.id,
                    quantity=Decimal(spec.opening_quantity),
                )
            )

        for product_name, ingredients in D.RECIPES.items():
            recipe_product = context.products_by_name[product_name]
            recipe = ProductRecipe(
                tenant_id=context.tenant_id,
                branch_id=branch.id,
                product_id=recipe_product.id,
                yield_quantity=Decimal("1"),
                is_active=True,
            )
            db.add(recipe)
            await db.flush()
            for item_name, quantity in ingredients:
                db.add(
                    ProductRecipeItem(
                        tenant_id=context.tenant_id,
                        branch_id=branch.id,
                        recipe_id=recipe.id,
                        inventory_item_id=branch.inventory[item_name],
                        quantity=Decimal(quantity),
                    )
                )

    context.recipes = {
        context.products_by_name[name].id: tuple(
            (item_name, Decimal(quantity)) for item_name, quantity in ingredients
        )
        for name, ingredients in D.RECIPES.items()
    }
    await db.flush()


# --------------------------------------------------------------------------
# QR menu, printing, marketplaces
# --------------------------------------------------------------------------


async def _build_service_config(
    db: AsyncSession, context: DemoContext, *, now: datetime
) -> None:
    seen_recently = now - timedelta(seconds=45)
    for branch in context.branches:
        db.add(
            QrMenuConfig(
                tenant_id=context.tenant_id,
                branch_id=branch.id,
                menu_name=f"{D.TENANT_NAME} · {branch.spec.name}",
                is_enabled=True,
                order_mode=QrOrderMode(branch.spec.qr_order_mode),
                primary_color="#B91C1C",
                language="tr",
                currency="TRY",
                service_hours={"opens_at": "09:00", "closes_at": "23:30"},
                out_of_hours_message="Mutfağımız 23:30'da kapanır. Sizi yarın bekleriz.",
                customer_notes_enabled=True,
                allergens_visible=True,
                max_order_amount=8000,
                contact_info={"phone": branch.spec.phone, "address": branch.spec.address},
                social_links={
                    "instagram": "https://instagram.com/meydanrestaurant",
                    "website": "https://meydanrestaurant.com",
                },
            )
        )

        for code, station_id in branch.stations.items():
            printer = PrinterDevice(
                tenant_id=context.tenant_id,
                branch_id=branch.id,
                preparation_station_id=station_id,
                code=f"{branch.slug.upper()[:4]}-{code}",
                name=f"{branch.spec.name} {code.title()} Yazıcısı",
                transport="NETWORK",
                is_active=True,
                last_seen_at=seen_recently,
                settings={"width": 48, "cut": True},
            )
            db.add(printer)
            await db.flush()
            branch.printers[code] = printer.id

        db.add(
            PrinterDevice(
                tenant_id=context.tenant_id,
                branch_id=branch.id,
                preparation_station_id=None,
                code=f"{branch.slug.upper()[:4]}-KASA",
                name=f"{branch.spec.name} Kasa Yazıcısı",
                transport="NETWORK",
                is_active=True,
                last_seen_at=seen_recently,
                settings={"width": 48, "cut": True},
            )
        )
        db.add(
            PrintBridgeClient(
                tenant_id=context.tenant_id,
                branch_id=branch.id,
                name=f"{branch.spec.name} Print Bridge",
                token_hash=hashlib.sha256(
                    f"{D.PRINT_BRIDGE_TOKEN_PREFIX}_{branch.slug}".encode()
                ).hexdigest(),
                is_active=True,
                last_seen_at=seen_recently,
            )
        )

        for index, provider in enumerate(branch.spec.marketplaces):
            store_id = f"{provider[:3]}-{branch.slug}-{4200 + index * 37}"
            db.add(
                MarketplaceIntegration(
                    tenant_id=context.tenant_id,
                    branch_id=branch.id,
                    provider=MarketplaceProvider(provider),
                    is_enabled=True,
                    external_store_id=store_id,
                    credential_ref=f"vault://demo/{branch.slug}/{provider.lower()}",
                    settings={"auto_accept": provider == "GETIR", "prep_minutes": 25},
                    last_sync_at=now - timedelta(minutes=3),
                )
            )
    await db.flush()


# --------------------------------------------------------------------------
# Loyalty and campaigns
# --------------------------------------------------------------------------


async def _build_loyalty(
    db: AsyncSession, context: DemoContext, *, rng: Random, opened_at: datetime
) -> None:
    program = LoyaltyProgram(
        tenant_id=context.tenant_id,
        name=D.LOYALTY_PROGRAM_NAME,
        is_active=True,
        show_on_qr=True,
        starts_at=opened_at,
        created_at=opened_at,
        updated_at=opened_at,
    )
    db.add(program)
    await db.flush()
    context.program_id = program.id
    context.reward_category_id = context.categories["Tatlılar"]

    db.add(
        LoyaltyRule(
            tenant_id=context.tenant_id,
            program_id=program.id,
            campaign_type=LoyaltyCampaignType.VISIT_COUNT,
            threshold=D.LOYALTY_VISIT_THRESHOLD,
            reward_category_id=context.reward_category_id,
            minimum_order_amount=Decimal("250.00"),
            allow_multiple_same_day=False,
            reward_same_order=False,
        )
    )
    for branch in context.branches:
        db.add(
            LoyaltyProgramBranch(
                tenant_id=context.tenant_id,
                program_id=program.id,
                branch_id=branch.id,
            )
        )

    lookup_codes: set[str] = set()
    referral_codes: set[str] = set()
    for index, (first_name, last_name, local_part) in enumerate(D.LOYALTY_CUSTOMERS):
        branch = context.branches[index % len(context.branches)]
        joined = opened_at + timedelta(days=rng.randint(0, 60), hours=rng.randint(9, 21))
        customer = LoyaltyCustomer(
            tenant_id=context.tenant_id,
            email_normalized=f"{local_part}@{D.CUSTOMER_EMAIL_DOMAIN}",
            first_name=first_name,
            last_name=last_name,
            birth_date=date(
                rng.randint(1972, 2004), rng.randint(1, 12), rng.randint(1, 28)
            ),
            is_active=True,
            created_at=joined,
            updated_at=joined,
        )
        db.add(customer)
        await db.flush()
        membership = LoyaltyMembership(
            tenant_id=context.tenant_id,
            branch_id=branch.id,
            program_id=program.id,
            customer_id=customer.id,
            public_token_hash=hashlib.sha256(
                secrets.token_urlsafe(32).encode()
            ).hexdigest(),
            lookup_code=_unique_code(rng, lookup_codes, "MYD", 4),
            referral_code=_unique_code(rng, referral_codes, "MR", 6),
            consent_at=joined,
            consent_text_version="2026-01",
            is_active=True,
            created_at=joined,
            updated_at=joined,
        )
        db.add(membership)
        await db.flush()
        context.memberships.append(
            MembershipContext(
                id=membership.id,
                customer_id=customer.id,
                branch_id=branch.id,
                display_name=f"{first_name} {last_name}",
            )
        )
    await db.flush()


async def _build_campaigns(
    db: AsyncSession, context: DemoContext, *, opened_at: datetime
) -> None:
    for spec in D.CAMPAIGNS:
        campaign = Campaign(
            tenant_id=context.tenant_id,
            name=spec.name,
            description=spec.description,
            is_active=True,
            buy_category_id=(
                context.categories[spec.buy_category] if spec.buy_category else None
            ),
            buy_quantity=spec.buy_quantity,
            minimum_order_amount=Decimal(spec.minimum_order_amount),
            reward_kind=CampaignRewardKind(spec.reward_kind),
            reward_category_id=(
                context.categories[spec.reward_category] if spec.reward_category else None
            ),
            reward_quantity=1,
            reward_value=Decimal(spec.reward_value),
            audience=CampaignAudience(spec.audience),
            max_uses_per_order=spec.max_uses_per_order,
            starts_at=opened_at,
            created_at=opened_at,
            updated_at=opened_at,
        )
        db.add(campaign)
        await db.flush()
        for branch in context.branches:
            db.add(
                CampaignBranch(
                    tenant_id=context.tenant_id,
                    campaign_id=campaign.id,
                    branch_id=branch.id,
                )
            )
        if spec.name == "3 Kahveye 1 Bedava":
            context.coffee_campaign_id = campaign.id
    await db.flush()
