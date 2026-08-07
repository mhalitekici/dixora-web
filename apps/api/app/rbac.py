from __future__ import annotations

from collections.abc import Iterable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Permission, Role

PERMISSION_DESCRIPTIONS: dict[str, str] = {
    "*": "Full platform access",
    "platform.businesses.manage": "Manage platform businesses",
    "platform.system.read": "Read platform health and activity",
    "platform.support": "Enter audited support mode",
    "dashboard.read": "Read operational dashboard",
    "catalog.read": "Read product catalog",
    "catalog.manage": "Manage product catalog",
    "products.manage": "Manage product media",
    "tables.read": "Read areas and tables",
    "tables.manage": "Manage areas and tables",
    "tables.operate": "Operate table sessions",
    "tables.transfer": "Transfer active table sessions",
    "orders.read": "Read orders",
    "orders.create": "Create and submit orders",
    "orders.manage": "Manage order lifecycle",
    "payments.manage": "Record and manage payments",
    "discounts.request": "Request discounts",
    "discounts.approve": "Approve discounts",
    "kitchen.read": "Read kitchen tickets",
    "kitchen.manage": "Update kitchen tickets",
    "inventory.read": "Read inventory",
    "inventory.manage": "Manage inventory and recipes",
    "inventory.override": "Override stock policy",
    "qr.read": "Read QR menu requests",
    "qr.manage": "Manage QR menu configuration",
    "qr.approve": "Approve QR order requests",
    "reports.read": "Read reports",
    "printing.read": "Read print jobs",
    "printing.manage": "Create and retry print jobs",
    "users.manage": "Manage employees",
    "roles.manage": "Manage roles and permissions",
    "roles.read": "Read assignable role presets",
    "audit.read": "Read audit logs",
    "settings.manage": "Manage business and branch settings",
    "loyalty.read": "Read loyalty programs, customers, and rewards",
    "loyalty.manage": "Configure loyalty programs and reverse accruals",
    "loyalty.redeem": "Attach loyalty memberships and redeem rewards",
}

ROLE_PERMISSIONS: dict[str, set[str]] = {
    "SUPER_ADMIN": {"*"},
    "BUSINESS_OWNER": {
        code for code in PERMISSION_DESCRIPTIONS if code != "*" and not code.startswith("platform.")
    },
    "BUSINESS_ADMIN": {
        "dashboard.read",
        "catalog.read",
        "catalog.manage",
        "products.manage",
        "tables.read",
        "tables.manage",
        "tables.operate",
        "tables.transfer",
        "orders.read",
        "orders.create",
        "orders.manage",
        "payments.manage",
        "discounts.request",
        "discounts.approve",
        "kitchen.read",
        "kitchen.manage",
        "inventory.read",
        "inventory.manage",
        "inventory.override",
        "qr.read",
        "qr.manage",
        "qr.approve",
        "reports.read",
        "printing.read",
        "printing.manage",
        "users.manage",
        "roles.read",
        "audit.read",
        "settings.manage",
        "loyalty.read",
        "loyalty.manage",
        "loyalty.redeem",
    },
    "BUSINESS_MANAGER": {
        "dashboard.read",
        "catalog.read",
        "catalog.manage",
        "products.manage",
        "tables.read",
        "tables.manage",
        "tables.operate",
        "tables.transfer",
        "orders.read",
        "orders.create",
        "orders.manage",
        "payments.manage",
        "discounts.request",
        "discounts.approve",
        "kitchen.read",
        "kitchen.manage",
        "inventory.read",
        "inventory.manage",
        "qr.read",
        "qr.manage",
        "qr.approve",
        "reports.read",
        "printing.read",
        "printing.manage",
        "audit.read",
        "loyalty.read",
        "loyalty.redeem",
    },
    "CASHIER": {
        "dashboard.read",
        "catalog.read",
        "tables.read",
        "tables.operate",
        "tables.transfer",
        "orders.read",
        "orders.create",
        "orders.manage",
        "payments.manage",
        "discounts.request",
        "kitchen.read",
        "qr.read",
        "qr.approve",
        "loyalty.read",
        "loyalty.redeem",
        "printing.read",
        "printing.manage",
    },
    "WAITER": {
        "catalog.read",
        "tables.read",
        "tables.operate",
        "orders.read",
        "orders.create",
        "discounts.request",
        "kitchen.read",
        "qr.read",
        "qr.approve",
        "loyalty.read",
        "loyalty.redeem",
    },
    "KITCHEN": {
        "kitchen.read",
        "kitchen.manage",
        "orders.read",
        "printing.read",
        "printing.manage",
    },
    "ACCOUNTANT": {"dashboard.read", "reports.read", "inventory.read"},
}

ASSIGNABLE_ROLE_PRESETS: dict[str, str] = {
    "BUSINESS_ADMIN": "Yönetici",
    "BUSINESS_MANAGER": "Müdür",
    "WAITER": "Garson",
    "KITCHEN": "Aşçı",
}


async def ensure_permission_catalog(db: AsyncSession) -> dict[str, Permission]:
    existing = {
        permission.code: permission
        for permission in (await db.execute(select(Permission))).scalars().all()
    }
    for code, description in PERMISSION_DESCRIPTIONS.items():
        if code not in existing:
            permission = Permission(code=code, description=description)
            db.add(permission)
            existing[code] = permission
    await db.flush()
    return existing


async def ensure_role(
    db: AsyncSession,
    *,
    tenant_id: UUID | None,
    code: str,
    name: str | None = None,
    permission_codes: Iterable[str] | None = None,
    is_system: bool = True,
) -> Role:
    result = await db.execute(select(Role).where(Role.tenant_id == tenant_id, Role.code == code))
    role = result.scalar_one_or_none()
    permission_map = await ensure_permission_catalog(db)
    codes = set(
        permission_codes if permission_codes is not None else ROLE_PERMISSIONS.get(code, set())
    )
    permissions = [permission_map[item] for item in sorted(codes)]
    if role is None:
        role = Role(
            tenant_id=tenant_id,
            code=code,
            name=name or code.replace("_", " ").title(),
            is_system=is_system,
            permissions=permissions,
        )
        db.add(role)
    else:
        role.permissions = permissions
        if name is not None:
            role.name = name
        role.is_system = is_system
        role.is_active = True
    await db.flush()
    return role


async def ensure_tenant_role_presets(db: AsyncSession, tenant_id: UUID) -> dict[str, Role]:
    """Create or repair the four immutable employee role presets for a tenant."""

    return {
        code: await ensure_role(
            db,
            tenant_id=tenant_id,
            code=code,
            name=name,
            is_system=True,
        )
        for code, name in ASSIGNABLE_ROLE_PRESETS.items()
    }
