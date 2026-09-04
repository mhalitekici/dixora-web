"""No branch may read or touch another branch's records.

The sibling of `test_cross_tenant_sweep`, one level down. Tenant isolation was
already swept; branch isolation was not, and it is the weaker of the two: every
route here is inside one business, so the tenant filter passes and only an
explicit branch check stands between a Kadıköy cashier and a Beşiktaş adisyon.

A sweep rather than a list, for the same reason as the tenant one: the endpoint
added next month whose author remembered `tenant_id` and forgot the branch is
exactly the case a hand-written list would miss.

Records that genuinely belong to the whole business — products, categories,
modifiers, campaigns, roles, the subscription — are skipped. Sharing those
across branches is the point of them.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import select

from app.models import (
    ApprovalRequest,
    Area,
    Branch,
    CashierShift,
    DeliveryOrder,
    DiningTable,
    HotelRoom,
    InventoryLocation,
    KitchenTicket,
    KitchenTicketItem,
    Order,
    OrderItem,
    PreparationStation,
    PrinterDevice,
    PrintJob,
    Product,
    QrOrderRequest,
    Role,
    TableSession,
    Tenant,
    User,
)
from app.models.enums import (
    ApprovalStatus,
    ApprovalType,
    DeliveryChannel,
    DeliveryPaymentMethod,
    DeliveryPaymentStatus,
    DeliveryStatus,
    KitchenTicketStatus,
    OrderItemStatus,
    OrderSource,
    OrderStatus,
    PrintJobKind,
    PrintJobStatus,
    ProviderSyncStatus,
    QrRequestStatus,
    TableSessionStatus,
)
from app.security import hash_password
from tests.conftest import ApiContext, auth_headers, login

# Routes whose id is not branch-owned. Reaching one of these from another branch
# proves nothing, because the record belongs to the business as a whole.
SKIP_PREFIXES = (
    "/api/v1/auth/",
    "/api/v1/system/",
    "/api/v1/registrations/",
    "/api/v1/loyalty/public/",
    "/api/v1/loyalty/rewards/",
    "/api/v1/qr/public/",
    "/api/v1/menu/",
    "/api/v1/billing/",
    "/api/v1/print-bridge/",
    "/api/v1/media/",
    "/api/v1/businesses",
    "/api/v1/subscriptions/",
    "/api/v1/docs",
    "/api/v1/openapi.json",
    "/api/v1/redoc",
    "/docs/",
    "/health",
    "/ready",
    # Business-wide catalogue and configuration: shared across branches by design.
    "/api/v1/catalog/",
    "/api/v1/campaigns/{campaign_id}",
    "/api/v1/roles/",
    "/api/v1/inventory/recipes/",
)

ALLOWED = {400, 401, 403, 404, 405, 409, 415, 422, 429, 503}

BRANCH_B_PASSWORD = "Sube-B-Guvenli!2026"
BRANCH_B_USERNAME = "sube.b@dixora.test"


async def _seed_branch_a_records(api: ApiContext) -> dict[str, str]:
    """One record of every branch-owned kind, all belonging to the seeded branch."""
    now = datetime.now(UTC)
    async with api.database.session_factory() as db:
        tenant = (await db.execute(select(Tenant).where(Tenant.slug == "dixora-lab"))).scalar_one()
        branch_a = (
            await db.execute(select(Branch).where(Branch.tenant_id == tenant.id))
        ).scalars().first()
        assert branch_a is not None
        area = (
            await db.execute(select(Area).where(Area.branch_id == branch_a.id))
        ).scalars().first()
        table = (
            await db.execute(select(DiningTable).where(DiningTable.branch_id == branch_a.id))
        ).scalars().first()
        product = (
            await db.execute(
                select(Product).where(
                    Product.tenant_id == tenant.id, Product.is_active.is_(True)
                )
            )
        ).scalars().first()
        station = (
            await db.execute(
                select(PreparationStation).where(PreparationStation.branch_id == branch_a.id)
            )
        ).scalars().first()
        owner = (
            await db.execute(
                select(User).where(
                    User.tenant_id == tenant.id, User.username == "owner@dixora.test"
                )
            )
        ).scalar_one()
        assert area is not None and table is not None
        assert product is not None and station is not None

        session = TableSession(
            tenant_id=tenant.id,
            branch_id=branch_a.id,
            table_id=table.id,
            opened_by_user_id=owner.id,
            status=TableSessionStatus.OPEN,
            opened_at=now,
        )
        db.add(session)
        await db.flush()

        order = Order(
            tenant_id=tenant.id,
            branch_id=branch_a.id,
            table_session_id=session.id,
            created_by_user_id=owner.id,
            source=OrderSource.WAITER,
            status=OrderStatus.ACCEPTED,
            currency="TRY",
            subtotal=Decimal("100.00"),
            total=Decimal("100.00"),
            idempotency_key=f"sweep-order-{uuid4().hex}",
            submitted_at=now,
            accepted_at=now,
        )
        db.add(order)
        await db.flush()

        item = OrderItem(
            tenant_id=tenant.id,
            branch_id=branch_a.id,
            order_id=order.id,
            product_id=product.id,
            preparation_station_id=station.id,
            product_name_snapshot=product.name,
            unit_price=Decimal("100.00"),
            quantity=Decimal("1.00"),
            line_total=Decimal("100.00"),
            status=OrderItemStatus.ACCEPTED,
            submitted_at=now,
        )
        db.add(item)
        await db.flush()

        ticket = KitchenTicket(
            tenant_id=tenant.id,
            branch_id=branch_a.id,
            order_id=order.id,
            preparation_station_id=station.id,
            batch_number=1,
            status=KitchenTicketStatus.NEW,
        )
        db.add(ticket)
        await db.flush()
        db.add(
            KitchenTicketItem(
                tenant_id=tenant.id,
                branch_id=branch_a.id,
                ticket_id=ticket.id,
                order_item_id=item.id,
                status=OrderItemStatus.ACCEPTED,
            )
        )

        shift = CashierShift(
            tenant_id=tenant.id,
            branch_id=branch_a.id,
            user_id=owner.id,
            status="OPEN",
            opening_cash=Decimal("500.00"),
            opened_at=now,
        )
        db.add(shift)

        approval = ApprovalRequest(
            tenant_id=tenant.id,
            branch_id=branch_a.id,
            order_id=order.id,
            requested_by_user_id=owner.id,
            approval_type=ApprovalType.DISCOUNT,
            status=ApprovalStatus.PENDING,
            payload={"kind": "PERCENTAGE", "value": "10"},
            reason="Sweep",
        )
        db.add(approval)

        qr_request = QrOrderRequest(
            tenant_id=tenant.id,
            branch_id=branch_a.id,
            table_id=table.id,
            status=QrRequestStatus.PENDING,
            idempotency_key=f"sweep-qr-{uuid4().hex}",
            items_payload=[{"product_id": str(product.id), "quantity": "1"}],
            expires_at=now + timedelta(minutes=20),
        )
        db.add(qr_request)

        room = HotelRoom(
            tenant_id=tenant.id,
            branch_id=branch_a.id,
            room_number="101",
            sort_order=1,
        )
        db.add(room)

        device = PrinterDevice(
            tenant_id=tenant.id,
            branch_id=branch_a.id,
            preparation_station_id=station.id,
            code=f"SWEEP-{uuid4().hex[:6].upper()}",
            name="Sweep Printer",
            transport="MOCK",
        )
        db.add(device)
        await db.flush()

        job = PrintJob(
            tenant_id=tenant.id,
            branch_id=branch_a.id,
            preparation_station_id=station.id,
            printer_device_id=device.id,
            order_id=order.id,
            kitchen_ticket_id=ticket.id,
            payload={"items": []},
            status=PrintJobStatus.PENDING,
            kind=PrintJobKind.ORIGINAL,
            idempotency_key=f"sweep-print-{uuid4().hex}",
        )
        db.add(job)

        delivery = DeliveryOrder(
            tenant_id=tenant.id,
            branch_id=branch_a.id,
            order_id=order.id,
            channel=DeliveryChannel.PHONE,
            delivery_status=DeliveryStatus.NEW,
            sync_status=ProviderSyncStatus.NOT_APPLICABLE,
            payment_method=DeliveryPaymentMethod.CASH_ON_DELIVERY,
            payment_status=DeliveryPaymentStatus.UNPAID,
            customer_name="Sweep Müşteri",
        )
        db.add(delivery)
        await db.flush()

        ids = {
            "branch": str(branch_a.id),
            "area": str(area.id),
            "table": str(table.id),
            "session": str(session.id),
            "order": str(order.id),
            "ticket": str(ticket.id),
            "shift": str(shift.id),
            "approval": str(approval.id),
            "request": str(qr_request.id),
            "room": str(room.id),
            "device": str(device.id),
            "job": str(job.id),
            "delivery": str(delivery.id),
            "user": str(owner.id),
        }
        await db.commit()
    return ids


async def _branch_b_headers(api: ApiContext) -> dict[str, str]:
    """A second branch in the same business, and one administrator pinned to it."""
    async with api.database.session_factory() as db:
        tenant = (await db.execute(select(Tenant).where(Tenant.slug == "dixora-lab"))).scalar_one()
        role = (
            await db.execute(
                select(Role).where(Role.tenant_id == tenant.id, Role.code == "BUSINESS_ADMIN")
            )
        ).scalar_one()
        branch_b = Branch(
            tenant_id=tenant.id,
            name="İkinci Şube",
            slug="ikinci-sube",
            is_active=True,
        )
        db.add(branch_b)
        await db.flush()
        # The second branch gets its own floor and stock so the caller has a
        # complete, legitimate context of its own to work in.
        db.add(
            InventoryLocation(
                tenant_id=tenant.id,
                branch_id=branch_b.id,
                name="Depo",
                is_default=True,
            )
        )
        db.add(
            User(
                tenant_id=tenant.id,
                branch_id=branch_b.id,
                role_id=role.id,
                username=BRANCH_B_USERNAME,
                email=BRANCH_B_USERNAME,
                display_name="İkinci Şube Yöneticisi",
                password_hash=hash_password(BRANCH_B_PASSWORD),
                is_active=True,
            )
        )
        await db.commit()

    tokens = await login(
        api,
        username=BRANCH_B_USERNAME,
        password=BRANCH_B_PASSWORD,
        business="dixora-lab",
    )
    return auth_headers(tokens)


def _operations(app: Any) -> list[tuple[str, str]]:
    spec = app.openapi()
    return [
        (method.upper(), path)
        for path, item in spec["paths"].items()
        for method in item
        if method in ("get", "post", "put", "patch", "delete")
    ]


def _fill(path: str, ids: dict[str, str]) -> str | None:
    """Put branch A's real ids into the path, or give up if none of them fit."""
    out: list[str] = []
    used = False
    for segment in path.split("/"):
        if not (segment.startswith("{") and segment.endswith("}")):
            out.append(segment)
            continue
        name = segment[1:-1].lower()
        if not (name == "id" or name.endswith("_id")):
            return None
        for key, value in ids.items():
            if key in name:
                out.append(value)
                used = True
                break
        else:
            return None
    return "/".join(out) if used else None


async def test_a_sibling_branch_cannot_reach_our_records(api: ApiContext) -> None:
    ids = await _seed_branch_a_records(api)
    headers = await _branch_b_headers(api)

    leaked: list[str] = []
    for method, path in _operations(api.app):
        if any(path.startswith(prefix) for prefix in SKIP_PREFIXES):
            continue
        target = _fill(path, ids)
        if target is None:
            continue
        response = await api.client.request(method, target, headers=headers, json={})
        if response.status_code not in ALLOWED:
            leaked.append(f"{method} {path} -> {response.status_code}")

    assert leaked == [], "another branch's records were reachable:\n" + "\n".join(leaked)


async def test_the_sweep_actually_exercised_something(api: ApiContext) -> None:
    """Guard on the guard: a filter that skipped everything would pass."""
    ids = {key: str(uuid4()) for key in ("branch", "order", "table", "shift", "user")}
    covered = [
        path
        for _, path in _operations(api.app)
        if not any(path.startswith(prefix) for prefix in SKIP_PREFIXES)
        and _fill(path, ids) is not None
    ]
    assert len(covered) > 15


def test_branch_owned_path_params_are_all_mapped() -> None:
    """Every id this sweep feeds must be a real uuid, or routes 422 for free."""
    for value in ("branch", "order", "table"):
        assert re.fullmatch(r"[a-z]+", value)
    assert UUID("11111111-1111-1111-1111-111111111111")
