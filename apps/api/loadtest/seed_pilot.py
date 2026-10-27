"""Create fresh loadtest-only tenants in the disposable validation database.

Run inside infrastructure/docker-compose.validation.yml, never the normal stack.
No records are deleted, updated or reused. Repeated runs use a fresh prefix.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import secrets
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.engine import make_url

from app.config import get_settings
from app.db import Database
from app.models import (
    Area,
    Branch,
    Category,
    DiningTable,
    PreparationStation,
    PrintBridgeClient,
    PrintBridgePrinterMapping,
    PrinterDevice,
    Product,
    QrMenuConfig,
    Subscription,
    SubscriptionPlan,
    Tenant,
    User,
)
from app.models.enums import QrOrderMode, TenantState
from app.rbac import ensure_role, ensure_tenant_role_presets
from app.security import hash_password, utcnow


async def seed(count: int, output: Path) -> None:
    settings = get_settings()
    if (
        settings.environment != "development"
        or make_url(settings.database_url).database != "dixora_validation"
    ):
        raise RuntimeError("Only the disposable dixora_validation database is allowed")
    if await asyncio.to_thread(output.exists):
        raise RuntimeError("Choose a fresh manifest path")
    database = Database(settings)
    password = secrets.token_urlsafe(24)
    password_hash, pin_hash = hash_password(password), hash_password("1357")
    prefix = f"loadtest-{uuid4().hex[:8]}"
    businesses = []
    try:
        async with database.session_factory() as db:
            plan = (
                await db.execute(
                    select(SubscriptionPlan).where(SubscriptionPlan.code == "STANDARD")
                )
            ).scalar_one()
            for number in range(count):
                slug = f"{prefix}-{number:02d}"
                tenant = Tenant(name=slug, slug=slug, state=TenantState.ACTIVE)
                db.add(tenant)
                await db.flush()
                branch = Branch(tenant_id=tenant.id, name="Loadtest", slug="main")
                db.add(branch)
                await db.flush()
                roles = await ensure_tenant_role_presets(db, tenant.id)
                for code in ("BUSINESS_OWNER", "CASHIER", "KITCHEN"):
                    roles[code] = await ensure_role(db, tenant_id=tenant.id, code=code)
                scope = {"tenant_id": tenant.id, "branch_id": branch.id}
                staff = []
                for index, role in enumerate(
                    ("BUSINESS_OWNER", "CASHIER", "WAITER", "WAITER", "KITCHEN")
                ):
                    username = f"staff{index}@{slug}.test"
                    db.add(
                        User(
                            **scope,
                            role_id=roles[role].id,
                            username=username,
                            display_name=f"Loadtest {role}",
                            password_hash=password_hash,
                            pin_hash=pin_hash,
                        )
                    )
                    staff.append({"username": username, "role": role})
                area = Area(**scope, name="Loadtest")
                db.add(area)
                await db.flush()
                table = DiningTable(**scope, area_id=area.id, name="QR-1")
                category = Category(**scope, name="Loadtest")
                db.add_all([table, category])
                await db.flush()
                products, printers = [], []
                for code in ("KITCHEN", "BAR"):
                    station = PreparationStation(**scope, name=code, code=code)
                    db.add(station)
                    await db.flush()
                    product = Product(
                        **scope,
                        category_id=category.id,
                        preparation_station_id=station.id,
                        name=code,
                        selling_price=Decimal("10.00"),
                        track_inventory=False,
                    )
                    token = f"pb_loadtest_{secrets.token_urlsafe(32)}"
                    bridge = PrintBridgeClient(
                        **scope, name=code, token_hash=hashlib.sha256(token.encode()).hexdigest()
                    )
                    printer = PrinterDevice(
                        **scope,
                        preparation_station_id=station.id,
                        name=code,
                        code=code,
                        purpose="PREPARATION",
                    )
                    db.add_all([product, bridge, printer])
                    await db.flush()
                    db.add(
                        PrintBridgePrinterMapping(
                            **scope,
                            bridge_id=bridge.id,
                            printer_device_id=printer.id,
                            local_printer_name=f"SIMULATED-{code}",
                        )
                    )
                    products.append(str(product.id))
                    printers.append({"token": token, "code": code})
                db.add_all(
                    [
                        QrMenuConfig(
                            **scope, is_enabled=True, order_mode=QrOrderMode.AUTOMATIC_ACCEPTANCE
                        ),
                        Subscription(
                            tenant_id=tenant.id,
                            plan_id=plan.id,
                            status=TenantState.ACTIVE,
                            starts_at=utcnow(),
                        ),
                    ]
                )
                businesses.append(
                    {
                        "business": slug,
                        "branch": "main",
                        "tenant_id": str(tenant.id),
                        "branch_id": str(branch.id),
                        "staff": staff,
                        "products": products,
                        "printers": printers,
                        "table_id": str(table.id),
                        "table_token": table.qr_token,
                    }
                )
            # The manifest is written before commit: a failed file write cannot
            # strand fixtures in the database without their test credentials.
            await asyncio.to_thread(
                output.write_text,
                json.dumps({"disposable": True, "password": password, "businesses": businesses}),
                encoding="utf-8",
            )
            await asyncio.to_thread(output.chmod, 0o600)
            await db.commit()
    finally:
        await database.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--businesses", type=int, choices=range(1, 101), default=30)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    asyncio.run(seed(args.businesses, args.output))
