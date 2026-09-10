from __future__ import annotations

import hashlib
import secrets
import string
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, Query, status
from sqlalchemy import func, or_, select

from app.config import Settings
from app.dependencies import (
    DbSession,
    Identity,
    get_app_settings,
    require_branch,
    require_permissions,
    require_record_branch,
    require_tenant,
)
from app.errors import DomainError
from app.models import (
    Branch,
    DiningTable,
    KitchenTicket,
    Order,
    PreparationStation,
    PrintBridgeClient,
    PrintBridgeEnrollmentCode,
    PrintBridgePrinterMapping,
    PrinterDevice,
    PrintJob,
    PrintJobAcknowledgement,
    Receipt,
    TableSession,
    Tenant,
    User,
)
from app.models.enums import OrderItemStatus, OrderStatus, PaymentStatus, PrintJobStatus
from app.schemas import (
    BridgeHeartbeat,
    BridgeHeartbeatOut,
    BridgeStatusUpdate,
    PlatformPrintBridgeSummary,
    PrintBridgeCreate,
    PrintBridgeCreated,
    PrintBridgeEnrollmentOut,
    PrintBridgeEnrollmentRequest,
    PrintBridgeEnrollRequest,
    PrintBridgeOut,
    PrintBridgePrinterMappingOut,
    PrintBridgePrinterMappingUpdate,
    PrinterDeviceCreate,
    PrinterDeviceOut,
    PrinterDeviceUpdate,
    PrintJobClaimOut,
    PrintJobCreate,
    PrintJobOut,
    ReceiptHistoryOut,
    ReceiptOut,
)
from app.security import as_utc
from app.services.audit import add_audit_log
from app.services.orders import (
    load_order,
    mark_order_bill_requested,
    order_bill_reference,
)
from app.services.receipts import allocate_order_receipt

router = APIRouter(prefix="/printing", tags=["printing"])
PrintReader = Annotated[Identity, Depends(require_permissions("printing.read"))]
PrintManager = Annotated[Identity, Depends(require_permissions("printing.manage"))]
PlatformHealthReader = Annotated[Identity, Depends(require_permissions("platform.system.read"))]

# How long a bridge holds an uncontested lease on a job it has claimed. Chosen
# to comfortably exceed one poll interval plus a slow physical print, while
# still recovering a crashed bridge's stuck job well within a shift rather
# than needing an operator to notice and intervene.
PRINT_JOB_LEASE_SECONDS = 90

# The heartbeat/poll cadence a bridge is expected to keep to (see
# apps/print-bridge). Anything quieter than a few missed intervals is treated
# as offline for panel/status purposes.
BRIDGE_ONLINE_WINDOW_SECONDS = 45

_ENROLLMENT_CODE_ALPHABET = "".join(
    ch for ch in string.ascii_uppercase + string.digits if ch not in "0O1I"
)


def _bridge_is_online(last_seen_at: datetime | None) -> bool:
    if last_seen_at is None:
        return False
    now = datetime.now(UTC)
    seen = last_seen_at if last_seen_at.tzinfo else last_seen_at.replace(tzinfo=UTC)
    return (now - seen).total_seconds() <= BRIDGE_ONLINE_WINDOW_SECONDS


def _bridge_out(
    bridge: PrintBridgeClient,
    mappings: list[PrintBridgePrinterMapping] | None = None,
) -> PrintBridgeOut:
    """`is_online` is computed at read time, not stored — building it requires
    a plain constructor call rather than `model_validate`, which would demand
    the field exist on the ORM row itself."""
    return PrintBridgeOut(
        id=bridge.id,
        tenant_id=bridge.tenant_id,
        branch_id=bridge.branch_id,
        name=bridge.name,
        is_active=bridge.is_active,
        platform=bridge.platform,
        version=bridge.version,
        printer_inventory=list(bridge.printer_inventory),
        last_seen_at=bridge.last_seen_at,
        is_online=bridge.is_active and _bridge_is_online(bridge.last_seen_at),
        created_at=bridge.created_at,
        printer_mappings=[
            PrintBridgePrinterMappingOut.model_validate(mapping) for mapping in (mappings or [])
        ],
    )


async def _scoped_branch(db: DbSession, *, tenant_id: UUID, branch_id: UUID) -> Branch:
    branch = (
        await db.execute(
            select(Branch).where(Branch.id == branch_id, Branch.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if branch is None:
        raise DomainError("branch_not_found", "Branch not found", status_code=404)
    return branch


async def _scoped_station(
    db: DbSession,
    *,
    tenant_id: UUID,
    branch_id: UUID,
    station_id: UUID | None,
) -> PreparationStation | None:
    if station_id is None:
        return None
    station = (
        await db.execute(
            select(PreparationStation).where(
                PreparationStation.id == station_id,
                PreparationStation.tenant_id == tenant_id,
                PreparationStation.branch_id == branch_id,
            )
        )
    ).scalar_one_or_none()
    if station is None:
        raise DomainError("station_not_found", "Preparation station not found", status_code=404)
    return station


@router.get("/devices", response_model=list[PrinterDeviceOut])
async def list_printer_devices(
    identity: PrintReader,
    db: DbSession,
    branch_id: UUID | None = None,
) -> list[PrinterDeviceOut]:
    rows = (
        (
            await db.execute(
                select(PrinterDevice)
                .where(
                    PrinterDevice.tenant_id == require_tenant(identity),
                    PrinterDevice.branch_id == require_branch(identity, branch_id),
                )
                .order_by(PrinterDevice.name)
            )
        )
        .scalars()
        .all()
    )
    return [PrinterDeviceOut.model_validate(device) for device in rows]


@router.post(
    "/devices",
    response_model=PrinterDeviceOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_printer_device(
    payload: PrinterDeviceCreate,
    identity: PrintManager,
    db: DbSession,
) -> PrinterDeviceOut:
    tenant_id = require_tenant(identity)
    branch_id = require_branch(identity, payload.branch_id)
    await _scoped_branch(db, tenant_id=tenant_id, branch_id=branch_id)
    await _scoped_station(
        db,
        tenant_id=tenant_id,
        branch_id=branch_id,
        station_id=payload.preparation_station_id,
    )
    if payload.purpose == "CASHIER" and payload.preparation_station_id is not None:
        raise DomainError(
            "cashier_printer_station_not_allowed",
            "A cashier printer cannot be assigned to a preparation station",
            status_code=422,
        )
    device = PrinterDevice(
        tenant_id=tenant_id,
        branch_id=branch_id,
        **payload.model_dump(exclude={"branch_id"}),
    )
    db.add(device)
    await db.flush()
    add_audit_log(
        db,
        identity=identity,
        action="printing.device_created",
        resource_type="printer_device",
        resource_id=device.id,
        new_value={
            "code": device.code,
            "purpose": device.purpose,
            "transport": device.transport,
        },
    )
    await db.commit()
    return PrinterDeviceOut.model_validate(device)


@router.patch("/devices/{device_id}", response_model=PrinterDeviceOut)
async def update_printer_device(
    device_id: UUID,
    payload: PrinterDeviceUpdate,
    identity: PrintManager,
    db: DbSession,
) -> PrinterDeviceOut:
    tenant_id = require_tenant(identity)
    device = (
        await db.execute(
            select(PrinterDevice).where(
                PrinterDevice.id == device_id,
                PrinterDevice.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if device is None:
        raise DomainError("printer_not_found", "Printer not found", status_code=404)
    require_record_branch(identity, device.branch_id)
    data = payload.model_dump(exclude_unset=True)
    if "preparation_station_id" in data:
        await _scoped_station(
            db,
            tenant_id=tenant_id,
            branch_id=device.branch_id,
            station_id=data["preparation_station_id"],
        )
    next_purpose = str(data.get("purpose", device.purpose))
    next_station_id = data.get("preparation_station_id", device.preparation_station_id)
    if next_purpose == "CASHIER" and next_station_id is not None:
        raise DomainError(
            "cashier_printer_station_not_allowed",
            "A cashier printer cannot be assigned to a preparation station",
            status_code=422,
        )
    previous = {
        "name": device.name,
        "is_active": device.is_active,
        "transport": device.transport,
        "purpose": device.purpose,
    }
    for key, value in data.items():
        setattr(device, key, value)
    add_audit_log(
        db,
        identity=identity,
        action="printing.device_updated",
        resource_type="printer_device",
        resource_id=device.id,
        previous_value=previous,
        new_value={
            "name": device.name,
            "is_active": device.is_active,
            "transport": device.transport,
            "purpose": device.purpose,
        },
    )
    await db.commit()
    return PrinterDeviceOut.model_validate(device)


@router.post(
    "/devices/{device_id}/test",
    response_model=PrintJobOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_test_print_job(
    device_id: UUID,
    identity: PrintManager,
    db: DbSession,
) -> PrintJobOut:
    tenant_id = require_tenant(identity)
    device = (
        await db.execute(
            select(PrinterDevice).where(
                PrinterDevice.id == device_id,
                PrinterDevice.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if device is None:
        raise DomainError("printer_not_found", "Printer not found", status_code=404)
    require_record_branch(identity, device.branch_id)
    if not device.is_active:
        raise DomainError(
            "printer_inactive",
            "An inactive printer cannot receive a test job",
            status_code=409,
        )
    mapping = (
        await db.execute(
            select(PrintBridgePrinterMapping.id)
            .join(
                PrintBridgeClient,
                PrintBridgeClient.id == PrintBridgePrinterMapping.bridge_id,
            )
            .where(
                PrintBridgePrinterMapping.tenant_id == tenant_id,
                PrintBridgePrinterMapping.branch_id == device.branch_id,
                PrintBridgePrinterMapping.printer_device_id == device.id,
                PrintBridgeClient.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if mapping is None:
        raise DomainError(
            "printer_bridge_mapping_required",
            "Map this printer to an active local Print Bridge before sending a test job",
            status_code=409,
        )
    branch = await _scoped_branch(db, tenant_id=tenant_id, branch_id=device.branch_id)
    now = datetime.now(UTC)
    test_id = uuid4()
    job = PrintJob(
        tenant_id=tenant_id,
        branch_id=device.branch_id,
        preparation_station_id=device.preparation_station_id,
        printer_device_id=device.id,
        payload={
            "document_type": "PRINTER_TEST",
            "content_type": "application/vnd.dixora.receipt+json",
            "copies": 1,
            "is_reprint": False,
            "document": {
                "title": "YAZICI TESTİ",
                "branch_name": branch.name,
                "station_name": device.name,
                "order_number": str(test_id)[:8].upper(),
                "submitted_at": now.isoformat(),
                "lines": [
                    {"name": "DIXORA YAZICI TESTİ", "quantity": "1"},
                    {"name": device.name, "quantity": "1", "note": device.code},
                ],
                "footer": ["Bağlantı işi başarıyla kuyruğa alındı."],
            },
        },
        status=PrintJobStatus.PENDING,
        idempotency_key=f"printer-test:{device.id}:{test_id}",
    )
    db.add(job)
    await db.flush()
    add_audit_log(
        db,
        identity=identity,
        action="printing.test_job_created",
        resource_type="print_job",
        resource_id=job.id,
        branch_id=device.branch_id,
        new_value={"printer_device_id": str(device.id), "status": job.status.value},
    )
    await db.commit()
    return PrintJobOut.model_validate(job)


@router.get("/jobs", response_model=list[PrintJobOut])
async def list_print_jobs(
    identity: PrintReader,
    db: DbSession,
    branch_id: UUID | None = None,
    job_status: PrintJobStatus | None = Query(default=None, alias="status"),
    order_id: UUID | None = None,
) -> list[PrintJobOut]:
    predicates = [
        PrintJob.tenant_id == require_tenant(identity),
        PrintJob.branch_id == require_branch(identity, branch_id),
    ]
    if job_status:
        predicates.append(PrintJob.status == job_status)
    if order_id:
        predicates.append(PrintJob.order_id == order_id)
    jobs = (
        (
            await db.execute(
                select(PrintJob).where(*predicates).order_by(PrintJob.created_at.desc()).limit(300)
            )
        )
        .scalars()
        .all()
    )
    return [PrintJobOut.model_validate(job) for job in jobs]


@router.post("/jobs/{job_id}/retry", response_model=PrintJobOut)
async def retry_manual_print_job(
    job_id: UUID,
    identity: PrintManager,
    db: DbSession,
) -> PrintJobOut:
    """Explicitly release one uncertain local print for another attempt.

    This is deliberately a manager action rather than a bridge retry. The
    preceding attempt may have reached the physical printer just before a
    crash, so the person at the printer has to decide whether a second ticket
    is appropriate.
    """
    tenant_id = require_tenant(identity)
    job = (
        await db.execute(
            select(PrintJob)
            .where(PrintJob.id == job_id, PrintJob.tenant_id == tenant_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if job is None:
        raise DomainError("print_job_not_found", "Print job not found", status_code=404)
    require_record_branch(identity, job.branch_id)
    if job.status != PrintJobStatus.FAILED or not job.manual_retry_required:
        raise DomainError(
            "print_job_not_manual_retry",
            "Only an uncertain failed print can be manually retried",
            status_code=409,
        )
    job.status = PrintJobStatus.PENDING
    job.manual_retry_required = False
    job.claimed_by_bridge_id = None
    job.claimed_at = None
    job.sent_at = None
    job.printed_at = None
    job.print_result = None
    job.lease_expires_at = None
    job.last_error = None
    add_audit_log(
        db,
        identity=identity,
        action="printing.job_manual_retry_requested",
        resource_type="print_job",
        resource_id=job.id,
        branch_id=job.branch_id,
        previous_value={"attempt_count": job.attempt_count, "status": "FAILED"},
        new_value={"status": "PENDING"},
    )
    await db.commit()
    return PrintJobOut.model_validate(job)


async def _validate_print_references(
    db: DbSession,
    *,
    tenant_id: UUID,
    branch_id: UUID,
    payload: PrintJobCreate,
) -> None:
    if payload.preparation_station_id is not None:
        station = (
            await db.execute(
                select(PreparationStation.id).where(
                    PreparationStation.id == payload.preparation_station_id,
                    PreparationStation.tenant_id == tenant_id,
                    PreparationStation.branch_id == branch_id,
                )
            )
        ).scalar_one_or_none()
        if station is None:
            raise DomainError("station_not_found", "Station not found", status_code=404)
    if payload.printer_device_id is not None:
        printer = (
            await db.execute(
                select(PrinterDevice).where(
                    PrinterDevice.id == payload.printer_device_id,
                    PrinterDevice.tenant_id == tenant_id,
                    PrinterDevice.branch_id == branch_id,
                )
            )
        ).scalar_one_or_none()
        if printer is None:
            raise DomainError("printer_not_found", "Printer not found", status_code=404)
        if not printer.is_active:
            raise DomainError("printer_inactive", "Printer is inactive", status_code=409)
        if (
            payload.preparation_station_id is not None
            and printer.preparation_station_id is not None
            and printer.preparation_station_id != payload.preparation_station_id
        ):
            raise DomainError(
                "printer_station_mismatch",
                "Printer is routed to a different preparation station",
                status_code=422,
            )
    if payload.order_id is not None:
        order = (
            await db.execute(
                select(Order.id).where(
                    Order.id == payload.order_id,
                    Order.tenant_id == tenant_id,
                    Order.branch_id == branch_id,
                )
            )
        ).scalar_one_or_none()
        if order is None:
            raise DomainError("order_not_found", "Order not found", status_code=404)
    if payload.kitchen_ticket_id is not None:
        ticket = (
            await db.execute(
                select(KitchenTicket.id).where(
                    KitchenTicket.id == payload.kitchen_ticket_id,
                    KitchenTicket.tenant_id == tenant_id,
                    KitchenTicket.branch_id == branch_id,
                )
            )
        ).scalar_one_or_none()
        if ticket is None:
            raise DomainError("ticket_not_found", "Ticket not found", status_code=404)


async def _first_active_printer_id(
    db: DbSession,
    *,
    tenant_id: UUID,
    branch_id: UUID,
    station_id: UUID | None,
) -> UUID | None:
    return (
        await db.execute(
            select(PrinterDevice.id)
            .where(
                PrinterDevice.tenant_id == tenant_id,
                PrinterDevice.branch_id == branch_id,
                PrinterDevice.is_active.is_(True),
                PrinterDevice.purpose == "PREPARATION",
                PrinterDevice.preparation_station_id == station_id,
            )
            .order_by(PrinterDevice.created_at)
            .limit(1)
        )
    ).scalar_one_or_none()


async def _cashier_printer_id(
    db: DbSession,
    *,
    tenant_id: UUID,
    branch_id: UUID,
) -> UUID | None:
    return (
        await db.execute(
            select(PrinterDevice.id)
            .where(
                PrinterDevice.tenant_id == tenant_id,
                PrinterDevice.branch_id == branch_id,
                PrinterDevice.is_active.is_(True),
                PrinterDevice.purpose == "CASHIER",
                PrinterDevice.preparation_station_id.is_(None),
            )
            .order_by(PrinterDevice.created_at)
            .limit(1)
        )
    ).scalar_one_or_none()


async def _resolve_print_defaults(
    db: DbSession,
    *,
    tenant_id: UUID,
    branch_id: UUID,
    payload: PrintJobCreate,
) -> tuple[UUID | None, UUID | None]:
    station_id = payload.preparation_station_id
    printer_device_id = payload.printer_device_id
    payload_type = str(payload.payload.get("type") or "").upper()
    if payload_type == "BILL":
        if station_id is not None:
            raise DomainError(
                "cashier_printer_station_not_allowed",
                "A bill cannot be routed to a preparation station",
                status_code=422,
            )
        if printer_device_id is not None:
            cashier_printer_id = (
                await db.execute(
                    select(PrinterDevice.id).where(
                        PrinterDevice.id == printer_device_id,
                        PrinterDevice.tenant_id == tenant_id,
                        PrinterDevice.branch_id == branch_id,
                        PrinterDevice.is_active.is_(True),
                        PrinterDevice.purpose == "CASHIER",
                        PrinterDevice.preparation_station_id.is_(None),
                    )
                )
            ).scalar_one_or_none()
            if cashier_printer_id is None:
                raise DomainError(
                    "cashier_printer_required",
                    "Bills must be routed to a cashier receipt printer",
                    status_code=422,
                )
            return None, printer_device_id
        cashier_printer_id = await _cashier_printer_id(
            db,
            tenant_id=tenant_id,
            branch_id=branch_id,
        )
        if cashier_printer_id is None:
            raise DomainError(
                "cashier_printer_not_configured",
                "No active cashier receipt printer is configured for this branch",
                status_code=409,
            )
        return station_id, cashier_printer_id
    if printer_device_id is not None:
        return station_id, printer_device_id
    if station_id is not None:
        return station_id, await _first_active_printer_id(
            db,
            tenant_id=tenant_id,
            branch_id=branch_id,
            station_id=station_id,
        )
    return station_id, printer_device_id


async def _build_bill_payload(
    db: DbSession,
    *,
    identity: Identity,
    order_id: UUID,
    kind: str,
    receipt: Receipt,
) -> dict[str, object]:
    order = await load_order(db, require_tenant(identity), order_id, lock=True)
    if order.branch_id != identity.branch_id:
        raise DomainError("order_not_found", "Order not found", status_code=404)
    if kind == "ORIGINAL":
        await mark_order_bill_requested(db, order=order)

    branch = await _scoped_branch(db, tenant_id=order.tenant_id, branch_id=order.branch_id)
    tenant = await db.get(Tenant, order.tenant_id)
    assert tenant is not None
    paid_total = sum(
        (payment.amount for payment in order.payments if payment.status == PaymentStatus.COMPLETED),
        Decimal("0.00"),
    )
    remaining = max(Decimal("0.00"), order.total - paid_total)
    issue_time = receipt.issued_at.isoformat()
    return {
        "type": "BILL",
        "stage": "CLOSING" if order.status == OrderStatus.PAID else "PRE_PAYMENT",
        "content_type": "application/vnd.dixora.receipt+json",
        "copies": 1,
        "is_reprint": kind == "REPRINT",
        "document": {
            "title": "HESAP ÖZETİ",
            "business_name": tenant.name,
            "branch_name": branch.name,
            "station_name": "KASA",
            "order_number": order_bill_reference(order.id),
            "receipt_number": receipt.daily_number,
            "business_date": receipt.business_date.isoformat(),
            "table_name": order.table_name,
            "waiter_name": identity.display_name,
            "submitted_at": issue_time,
            "currency": order.currency,
            "lines": [
                {
                    "name": item.product_name_snapshot,
                    "quantity": str(item.quantity),
                    "unit_price": str(item.unit_price),
                    "line_total": str(item.line_total),
                    "modifiers": [
                        (
                            f"{modifier.quantity}x {modifier.name_snapshot}"
                            if modifier.quantity > 1
                            else modifier.name_snapshot
                        )
                        for modifier in item.modifiers
                    ],
                    "note": item.note,
                    "complimentary": item.is_complimentary,
                }
                for item in order.items
                if item.status not in {OrderItemStatus.CANCELLED, OrderItemStatus.VOIDED}
            ],
            "footer": [
                f"FİŞ NO: {receipt.daily_number}",
                *(["TEKRAR BASKI"] if kind == "REPRINT" else []),
                f"Ara toplam: {order.subtotal}",
                f"İndirim: {order.discount_total}",
                f"Vergi: {order.tax_total}",
                f"Servis: {order.service_charge_amount}",
                f"Toplam: {order.total}",
                f"Ödenen: {paid_total}",
                f"Kalan: {remaining}",
            ],
        },
        "receipt": {
            "kind": kind,
            "title": "HESAP ÖZETİ",
            "business": {
                "name": tenant.name,
                "branch": branch.name,
                "address": branch.address,
                "phone": branch.phone,
            },
            "meta": {
                "reference": order_bill_reference(order.id),
                "dailyReceiptNumber": receipt.daily_number,
                "businessDate": receipt.business_date.isoformat(),
                "tableName": order.table_name,
                "guestName": order.customer_name,
                "staffName": identity.display_name,
                "issuedAt": issue_time,
            },
            "lines": [
                {
                    "name": item.product_name_snapshot,
                    "quantity": str(item.quantity),
                    "unitPrice": str(item.unit_price),
                    "lineTotal": str(item.line_total),
                    "modifiers": [
                        (
                            f"{modifier.quantity}x {modifier.name_snapshot}"
                            if modifier.quantity > 1
                            else modifier.name_snapshot
                        )
                        for modifier in item.modifiers
                    ],
                    "note": item.note,
                    "complimentary": item.is_complimentary,
                }
                for item in order.items
                if item.status not in {OrderItemStatus.CANCELLED, OrderItemStatus.VOIDED}
            ],
            "totals": {
                "subtotal": str(order.subtotal),
                "discount": str(order.discount_total),
                "tax": str(order.tax_total),
                "serviceChargeType": order.service_charge_type,
                "serviceChargeValue": str(order.service_charge_value),
                "serviceCharge": str(order.service_charge_amount),
                "total": str(order.total),
                "paid": str(paid_total),
                "remaining": str(remaining),
            },
            "payments": [
                {
                    "method": payment.method,
                    "amount": str(payment.amount),
                    "reference": payment.reference,
                }
                for payment in order.payments
                if payment.status == PaymentStatus.COMPLETED
            ],
            "footerNote": "Garson hesabınızı masanıza getirir.",
        },
    }


@router.post("/jobs", response_model=PrintJobOut, status_code=status.HTTP_201_CREATED)
async def create_print_job(
    payload: PrintJobCreate,
    identity: PrintManager,
    db: DbSession,
) -> PrintJobOut:
    tenant_id = require_tenant(identity)
    branch_id = require_branch(identity)
    existing = (
        await db.execute(
            select(PrintJob).where(
                PrintJob.tenant_id == tenant_id,
                PrintJob.idempotency_key == payload.idempotency_key,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return PrintJobOut.model_validate(existing)
    await _validate_print_references(
        db,
        tenant_id=tenant_id,
        branch_id=branch_id,
        payload=payload,
    )
    job_payload = payload.payload
    receipt: Receipt | None = None
    if payload.order_id is not None and str(payload.payload.get("type") or "").upper() == "BILL":
        branch = await _scoped_branch(db, tenant_id=tenant_id, branch_id=branch_id)
        receipt, _ = await allocate_order_receipt(
            db,
            tenant_id=tenant_id,
            branch=branch,
            order_id=payload.order_id,
            actor_user_id=identity.user_id,
        )
        if payload.kind.value == "REPRINT":
            receipt.reprint_count += 1
        job_payload = await _build_bill_payload(
            db,
            identity=identity,
            order_id=payload.order_id,
            kind=payload.kind.value,
            receipt=receipt,
        )
    preparation_station_id, printer_device_id = await _resolve_print_defaults(
        db,
        tenant_id=tenant_id,
        branch_id=branch_id,
        payload=payload,
    )
    job = PrintJob(
        tenant_id=tenant_id,
        branch_id=branch_id,
        preparation_station_id=preparation_station_id,
        printer_device_id=printer_device_id,
        order_id=payload.order_id,
        receipt_id=receipt.id if receipt is not None else None,
        kitchen_ticket_id=payload.kitchen_ticket_id,
        payload=job_payload,
        kind=payload.kind,
        idempotency_key=payload.idempotency_key,
    )
    db.add(job)
    await db.flush()
    add_audit_log(
        db,
        identity=identity,
        action="printing.job_created",
        resource_type="print_job",
        resource_id=job.id,
        new_value={"kind": job.kind.value},
    )
    await db.commit()
    return PrintJobOut.model_validate(job)


@router.get("/receipts", response_model=list[ReceiptHistoryOut])
async def list_receipts(
    identity: PrintReader,
    db: DbSession,
    branch_id: UUID | None = None,
    limit: int = Query(default=100, ge=1, le=300),
) -> list[ReceiptHistoryOut]:
    rows = (
        await db.execute(
            select(Receipt, Order, User.display_name, DiningTable.name)
            .join(Order, Order.id == Receipt.order_id)
            .outerjoin(User, User.id == Receipt.issued_by_user_id)
            .outerjoin(TableSession, TableSession.id == Order.table_session_id)
            .outerjoin(DiningTable, DiningTable.id == TableSession.table_id)
            .where(
                Receipt.tenant_id == require_tenant(identity),
                Receipt.branch_id == require_branch(identity, branch_id),
            )
            .order_by(Receipt.issued_at.desc())
            .limit(limit)
        )
    ).all()
    receipt_ids = [receipt.id for receipt, _, _, _ in rows]
    printed_receipt_ids = set(
        (
            await db.execute(
                select(PrintJob.receipt_id).where(
                    PrintJob.tenant_id == require_tenant(identity),
                    PrintJob.receipt_id.in_(receipt_ids),
                    PrintJob.status == PrintJobStatus.PRINTED,
                )
            )
        ).scalars()
    )
    return [
        ReceiptHistoryOut(
            **ReceiptOut.model_validate(receipt).model_dump(),
            table_name=table_name,
            total=order.total,
            currency=order.currency,
            cashier_name=cashier_name,
            order_status=order.status,
            print_status=(
                "REPRINTED"
                if receipt.reprint_count > 0
                else "PRINTED"
                if receipt.id in printed_receipt_ids
                else "QUEUED"
            ),
        )
        for receipt, order, cashier_name, table_name in rows
    ]


def _validate_bridge_key(settings: Settings, provided: str | None) -> None:
    expected = settings.print_bridge_key.get_secret_value()
    if provided is None or not secrets.compare_digest(provided, expected):
        raise DomainError(
            "invalid_bridge_key", "Print Bridge authentication failed", status_code=401
        )


def _bridge_token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def _authenticate_bridge(
    db: DbSession,
    settings: Settings,
    *,
    bridge_token: str | None,
    legacy_key: str | None,
    legacy_branch_id: UUID | None,
) -> PrintBridgeClient:
    if bridge_token:
        bridge = (
            await db.execute(
                select(PrintBridgeClient).where(
                    PrintBridgeClient.token_hash == _bridge_token_hash(bridge_token),
                    PrintBridgeClient.is_active.is_(True),
                )
            )
        ).scalar_one_or_none()
        if bridge is None:
            raise DomainError(
                "invalid_bridge_token", "Print Bridge authentication failed", status_code=401
            )
        return bridge
    # Compatibility is deliberately impossible in production. It exists only for the
    # checked-in mock bridge while development seed mode is explicitly enabled.
    if not settings.dev_seed_enabled or legacy_branch_id is None:
        raise DomainError(
            "bridge_token_required", "A scoped Print Bridge token is required", status_code=401
        )
    _validate_bridge_key(settings, legacy_key)
    bridge = (
        await db.execute(
            select(PrintBridgeClient).where(
                PrintBridgeClient.branch_id == legacy_branch_id,
                PrintBridgeClient.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if bridge is None:
        raise DomainError("bridge_not_found", "Print Bridge client not found", status_code=404)
    return bridge


@router.post("/bridges", response_model=PrintBridgeCreated, status_code=status.HTTP_201_CREATED)
async def create_bridge_client(
    payload: PrintBridgeCreate,
    identity: PrintManager,
    db: DbSession,
) -> PrintBridgeCreated:
    tenant_id = require_tenant(identity)
    branch_id = require_branch(identity, payload.branch_id)
    await _scoped_branch(db, tenant_id=tenant_id, branch_id=branch_id)
    raw_token = f"pb_{secrets.token_urlsafe(40)}"
    bridge = PrintBridgeClient(
        tenant_id=tenant_id,
        branch_id=branch_id,
        name=payload.name,
        token_hash=_bridge_token_hash(raw_token),
    )
    db.add(bridge)
    await db.flush()
    add_audit_log(
        db,
        identity=identity,
        action="printing.bridge_created",
        resource_type="print_bridge_client",
        resource_id=bridge.id,
        new_value={"name": bridge.name, "branch_id": str(branch_id)},
    )
    await db.commit()
    return PrintBridgeCreated(
        id=bridge.id,
        tenant_id=bridge.tenant_id,
        branch_id=bridge.branch_id,
        name=bridge.name,
        token=raw_token,
    )


@router.get("/bridges", response_model=list[PrintBridgeOut])
async def list_bridges(
    identity: PrintReader,
    db: DbSession,
    branch_id: UUID | None = None,
) -> list[PrintBridgeOut]:
    tenant_id = require_tenant(identity)
    scoped_branch_id = require_branch(identity, branch_id)
    bridges = (
        (
            await db.execute(
                select(PrintBridgeClient)
                .where(
                    PrintBridgeClient.tenant_id == tenant_id,
                    PrintBridgeClient.branch_id == scoped_branch_id,
                )
                .order_by(PrintBridgeClient.created_at)
            )
        )
        .scalars()
        .all()
    )
    bridge_ids = [bridge.id for bridge in bridges]
    mappings = (
        (
            await db.execute(
                select(PrintBridgePrinterMapping)
                .where(
                    PrintBridgePrinterMapping.tenant_id == tenant_id,
                    PrintBridgePrinterMapping.branch_id == scoped_branch_id,
                    PrintBridgePrinterMapping.bridge_id.in_(bridge_ids),
                )
                .order_by(PrintBridgePrinterMapping.created_at)
            )
        )
        .scalars()
        .all()
        if bridge_ids
        else []
    )
    mappings_by_bridge: dict[UUID, list[PrintBridgePrinterMapping]] = {}
    for mapping in mappings:
        mappings_by_bridge.setdefault(mapping.bridge_id, []).append(mapping)
    return [_bridge_out(bridge, mappings_by_bridge.get(bridge.id, [])) for bridge in bridges]


@router.put(
    "/bridges/{bridge_id}/printer-mappings/{printer_device_id}",
    response_model=PrintBridgePrinterMappingOut,
)
async def upsert_bridge_printer_mapping(
    bridge_id: UUID,
    printer_device_id: UUID,
    payload: PrintBridgePrinterMappingUpdate,
    identity: PrintManager,
    db: DbSession,
) -> PrintBridgePrinterMappingOut:
    """Bind a Dixora device to one discovered printer on one local bridge.

    The unique device mapping is intentional: a kitchen ticket must have one
    owner at the local spool boundary or two PCs could each print it after a
    lease recovery. Changing a mapping transfers that ownership explicitly.
    """
    tenant_id = require_tenant(identity)
    bridge = (
        await db.execute(
            select(PrintBridgeClient)
            .where(
                PrintBridgeClient.id == bridge_id,
                PrintBridgeClient.tenant_id == tenant_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if bridge is None:
        raise DomainError("bridge_not_found", "Print Bridge not found", status_code=404)
    require_record_branch(identity, bridge.branch_id)
    if not bridge.is_active:
        raise DomainError("bridge_inactive", "Print Bridge is inactive", status_code=409)
    device = (
        await db.execute(
            select(PrinterDevice).where(
                PrinterDevice.id == printer_device_id,
                PrinterDevice.tenant_id == tenant_id,
                PrinterDevice.branch_id == bridge.branch_id,
            )
        )
    ).scalar_one_or_none()
    if device is None:
        raise DomainError("printer_not_found", "Printer not found", status_code=404)
    local_printer_name = payload.local_printer_name.strip()
    available_names = {
        name.casefold(): name
        for name in bridge.printer_inventory
        if isinstance(name, str) and name.strip()
    }
    if not available_names:
        raise DomainError(
            "bridge_printer_inventory_unavailable",
            "Print Bridge has not reported its local printers yet",
            status_code=409,
        )
    canonical_name = available_names.get(local_printer_name.casefold())
    if canonical_name is None:
        raise DomainError(
            "local_printer_not_discovered",
            "The selected local printer is not reported by this Print Bridge",
            status_code=409,
        )
    mapping = (
        await db.execute(
            select(PrintBridgePrinterMapping)
            .where(
                PrintBridgePrinterMapping.printer_device_id == device.id,
                PrintBridgePrinterMapping.tenant_id == tenant_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    previous = (
        {
            "bridge_id": str(mapping.bridge_id),
            "local_printer_name": mapping.local_printer_name,
        }
        if mapping is not None
        else None
    )
    if mapping is None:
        mapping = PrintBridgePrinterMapping(
            tenant_id=tenant_id,
            branch_id=bridge.branch_id,
            bridge_id=bridge.id,
            printer_device_id=device.id,
            local_printer_name=canonical_name,
        )
        db.add(mapping)
        await db.flush()
    else:
        mapping.bridge_id = bridge.id
        mapping.branch_id = bridge.branch_id
        mapping.local_printer_name = canonical_name
    add_audit_log(
        db,
        identity=identity,
        action="printing.bridge_printer_mapped",
        resource_type="printer_device",
        resource_id=device.id,
        branch_id=bridge.branch_id,
        previous_value=previous,
        new_value={
            "bridge_id": str(bridge.id),
            "local_printer_name": canonical_name,
        },
    )
    await db.commit()
    return PrintBridgePrinterMappingOut.model_validate(mapping)


@router.delete(
    "/bridges/{bridge_id}/printer-mappings/{printer_device_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_bridge_printer_mapping(
    bridge_id: UUID,
    printer_device_id: UUID,
    identity: PrintManager,
    db: DbSession,
) -> None:
    tenant_id = require_tenant(identity)
    mapping = (
        await db.execute(
            select(PrintBridgePrinterMapping)
            .join(PrintBridgeClient, PrintBridgeClient.id == PrintBridgePrinterMapping.bridge_id)
            .where(
                PrintBridgePrinterMapping.tenant_id == tenant_id,
                PrintBridgePrinterMapping.bridge_id == bridge_id,
                PrintBridgePrinterMapping.printer_device_id == printer_device_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if mapping is None:
        raise DomainError("printer_mapping_not_found", "Printer mapping not found", status_code=404)
    require_record_branch(identity, mapping.branch_id)
    await db.delete(mapping)
    add_audit_log(
        db,
        identity=identity,
        action="printing.bridge_printer_unmapped",
        resource_type="printer_device",
        resource_id=printer_device_id,
        branch_id=mapping.branch_id,
        previous_value={
            "bridge_id": str(mapping.bridge_id),
            "local_printer_name": mapping.local_printer_name,
        },
    )
    await db.commit()


@router.post("/bridges/{bridge_id}/revoke", response_model=PrintBridgeOut)
async def revoke_bridge(
    bridge_id: UUID,
    identity: PrintManager,
    db: DbSession,
) -> PrintBridgeOut:
    """Cut a desktop agent off immediately — lost laptop, decommissioned till.

    Deactivating is enough to block every future request: `_authenticate_bridge`
    only accepts an `is_active` bridge, so a revoked token stops working on its
    very next call, mid-poll-loop, with no separate key-rotation step needed.
    """
    tenant_id = require_tenant(identity)
    bridge = (
        await db.execute(
            select(PrintBridgeClient).where(
                PrintBridgeClient.id == bridge_id,
                PrintBridgeClient.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if bridge is None:
        raise DomainError("bridge_not_found", "Print Bridge not found", status_code=404)
    require_record_branch(identity, bridge.branch_id)
    bridge.is_active = False
    bridge.revoked_at = datetime.now(UTC)
    add_audit_log(
        db,
        identity=identity,
        action="printing.bridge_revoked",
        resource_type="print_bridge_client",
        resource_id=bridge.id,
        new_value={"name": bridge.name},
    )
    await db.commit()
    return _bridge_out(bridge)


def _generate_enrollment_code() -> str:
    """A short code meant to be read off one screen and typed on another.

    Excludes visually ambiguous characters (0/O, 1/I) since a support call to
    re-issue a code because someone misread it defeats the point of a quick
    enrollment flow.
    """
    body = "".join(secrets.choice(_ENROLLMENT_CODE_ALPHABET) for _ in range(8))
    return f"{body[:4]}-{body[4:]}"


def _enrollment_code_hash(code: str) -> str:
    return hashlib.sha256(code.strip().upper().encode("utf-8")).hexdigest()


@router.post(
    "/bridges/enrollment-codes",
    response_model=PrintBridgeEnrollmentOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_enrollment_code(
    payload: PrintBridgeEnrollmentRequest,
    identity: PrintManager,
    db: DbSession,
) -> PrintBridgeEnrollmentOut:
    """Issue a code an operator reads off the panel and types into the agent.

    Nothing about the eventual bridge exists yet — no id, no token — so unlike
    a leaked bridge token, a leaked *unused* code is only a window of
    opportunity to enroll a bridge into this one branch, and it closes itself
    once it expires or is redeemed, whichever comes first.
    """
    tenant_id = require_tenant(identity)
    branch_id = require_branch(identity, payload.branch_id)
    await _scoped_branch(db, tenant_id=tenant_id, branch_id=branch_id)
    code = _generate_enrollment_code()
    expires_at = datetime.now(UTC) + timedelta(minutes=payload.ttl_minutes)
    record = PrintBridgeEnrollmentCode(
        tenant_id=tenant_id,
        branch_id=branch_id,
        created_by_user_id=identity.user_id,
        code_hash=_enrollment_code_hash(code),
        expires_at=expires_at,
    )
    db.add(record)
    add_audit_log(
        db,
        identity=identity,
        action="printing.enrollment_code_created",
        resource_type="print_bridge_enrollment_code",
        resource_id=record.id,
        new_value={"branch_id": str(branch_id), "expires_at": expires_at.isoformat()},
    )
    await db.commit()
    return PrintBridgeEnrollmentOut(code=code, expires_at=expires_at)


@router.post(
    "/bridge/enroll",
    response_model=PrintBridgeCreated,
    status_code=status.HTTP_201_CREATED,
)
async def enroll_bridge(payload: PrintBridgeEnrollRequest, db: DbSession) -> PrintBridgeCreated:
    """Redeem a one-time code for a real, scoped bridge credential.

    Deliberately takes no bearer credential of its own — a brand-new desktop
    agent has nothing to authenticate with yet. The short-lived, one-time code
    *is* the authentication for this single call.
    """
    code_hash = _enrollment_code_hash(payload.code)
    record = (
        await db.execute(
            select(PrintBridgeEnrollmentCode)
            .where(PrintBridgeEnrollmentCode.code_hash == code_hash)
            .with_for_update()
        )
    ).scalar_one_or_none()
    now = datetime.now(UTC)
    invalid = record is None or record.consumed_at is not None or as_utc(record.expires_at) <= now
    if invalid:
        raise DomainError(
            "invalid_enrollment_code",
            "This enrollment code is invalid or has expired",
            status_code=400,
        )
    assert record is not None  # narrowed by `invalid` above, for mypy

    existing_name = (
        await db.execute(
            select(PrintBridgeClient.id).where(
                PrintBridgeClient.tenant_id == record.tenant_id,
                PrintBridgeClient.branch_id == record.branch_id,
                PrintBridgeClient.name == payload.name,
            )
        )
    ).scalar_one_or_none()
    if existing_name is not None:
        raise DomainError(
            "bridge_name_taken",
            "A Print Bridge with this name is already enrolled on this branch",
            status_code=409,
        )

    raw_token = f"pb_{secrets.token_urlsafe(40)}"
    bridge = PrintBridgeClient(
        tenant_id=record.tenant_id,
        branch_id=record.branch_id,
        name=payload.name,
        token_hash=_bridge_token_hash(raw_token),
        platform=payload.platform,
        version=payload.version,
        last_seen_at=now,
    )
    db.add(bridge)
    await db.flush()
    record.consumed_at = now
    record.created_bridge_id = bridge.id
    add_audit_log(
        db,
        identity=None,
        tenant_id=bridge.tenant_id,
        branch_id=bridge.branch_id,
        action="printing.bridge_enrolled",
        resource_type="print_bridge_client",
        resource_id=bridge.id,
        new_value={"name": bridge.name, "platform": bridge.platform},
    )
    await db.commit()
    return PrintBridgeCreated(
        id=bridge.id,
        tenant_id=bridge.tenant_id,
        branch_id=bridge.branch_id,
        name=bridge.name,
        token=raw_token,
    )


@router.get(
    "/platform/bridges/summary",
    response_model=PlatformPrintBridgeSummary,
)
async def platform_bridge_summary(
    identity: PlatformHealthReader,
    db: DbSession,
) -> PlatformPrintBridgeSummary:
    """Rollup for the Super Admin screen — every tenant, not just this one.

    Print Bridge has no central process to probe any more; the only honest
    global signal is how many of the businesses' own local agents are
    currently checking in.
    """
    del identity  # authorization only; this view is intentionally cross-tenant
    total = (
        await db.execute(
            select(func.count(PrintBridgeClient.id)).where(PrintBridgeClient.is_active.is_(True))
        )
    ).scalar_one()
    cutoff = datetime.now(UTC) - timedelta(seconds=BRIDGE_ONLINE_WINDOW_SECONDS)
    online = (
        await db.execute(
            select(func.count(PrintBridgeClient.id)).where(
                PrintBridgeClient.is_active.is_(True),
                PrintBridgeClient.last_seen_at.is_not(None),
                PrintBridgeClient.last_seen_at >= cutoff,
            )
        )
    ).scalar_one()
    return PlatformPrintBridgeSummary(
        total_bridges=int(total),
        online_bridges=int(online),
        offline_bridges=int(total) - int(online),
    )


def _requested_printer_codes(value: str | None) -> set[str]:
    if value is None:
        raise DomainError(
            "printer_codes_required",
            "Print Bridge must declare its configured printer codes",
            status_code=422,
        )
    codes = {code.strip().upper() for code in value.split(",") if code.strip()}
    if not codes or len(codes) > 50 or any(len(code) > 80 for code in codes):
        raise DomainError(
            "invalid_printer_codes",
            "Print Bridge printer codes are invalid",
            status_code=422,
        )
    return codes


@router.post("/bridge/claim", response_model=PrintJobClaimOut | None)
async def claim_print_job(
    db: DbSession,
    branch_id: UUID | None = None,
    printer_codes: str | None = Query(default=None),
    bridge_token: str | None = Header(default=None, alias="X-Print-Bridge-Token"),
    bridge_key: str | None = Header(default=None, alias="X-Print-Bridge-Key"),
    settings: Settings = Depends(get_app_settings),
) -> PrintJobClaimOut | None:
    bridge = await _authenticate_bridge(
        db,
        settings,
        bridge_token=bridge_token,
        legacy_key=bridge_key,
        legacy_branch_id=branch_id,
    )
    # A scoped credential may omit printer codes: the server-side mapping is
    # the source of truth for its allowed devices. The old development key
    # still declares codes explicitly so the checked-in mock remains useful.
    requested_codes = _requested_printer_codes(printer_codes) if printer_codes else set()
    if not bridge_token and not requested_codes:
        raise DomainError(
            "printer_codes_required",
            "Print Bridge must declare its configured printer codes",
            status_code=422,
        )
    now = datetime.now(UTC)
    # Eligible to claim: the ordinary PENDING/FAILED pool, plus any job whose
    # lease has lapsed — a bridge that claimed it and then crashed or lost its
    # connection before acknowledging never gets to hold a job forever.
    lease_expired = PrintJob.lease_expires_at.is_not(None) & (PrintJob.lease_expires_at < now)
    base_predicates = [
        PrintJob.tenant_id == bridge.tenant_id,
        PrintJob.branch_id == bridge.branch_id,
        PrinterDevice.is_active.is_(True),
        or_(
            PrintJob.status.in_([PrintJobStatus.PENDING, PrintJobStatus.FAILED]),
            lease_expired,
        ),
        PrintJob.manual_retry_required.is_(False),
        PrintJob.attempt_count < 5,
    ]
    if requested_codes:
        base_predicates.append(PrinterDevice.code.in_(requested_codes))
    printer_join = (
        (PrinterDevice.id == PrintJob.printer_device_id)
        & (PrinterDevice.tenant_id == PrintJob.tenant_id)
        & (PrinterDevice.branch_id == PrintJob.branch_id)
    )
    if bridge_token:
        scoped_result = (
            await db.execute(
                select(
                    PrintJob,
                    PrinterDevice.code,
                    PrintBridgePrinterMapping.local_printer_name,
                )
                .join(PrinterDevice, printer_join)
                .join(
                    PrintBridgePrinterMapping,
                    (PrintBridgePrinterMapping.printer_device_id == PrinterDevice.id)
                    & (PrintBridgePrinterMapping.tenant_id == bridge.tenant_id)
                    & (PrintBridgePrinterMapping.branch_id == bridge.branch_id)
                    & (PrintBridgePrinterMapping.bridge_id == bridge.id),
                )
                .where(*base_predicates)
                .order_by(PrintJob.created_at)
                .with_for_update(of=PrintJob, skip_locked=True)
                .limit(1)
            )
        ).one_or_none()
        if scoped_result is None:
            return None
        job, printer_code, local_printer_name = scoped_result
    else:
        legacy_result = (
            await db.execute(
                select(PrintJob, PrinterDevice.code)
                .join(PrinterDevice, printer_join)
                .where(*base_predicates)
                .order_by(PrintJob.created_at)
                .with_for_update(of=PrintJob, skip_locked=True)
                .limit(1)
            )
        ).one_or_none()
        if legacy_result is None:
            return None
        job, printer_code = legacy_result
        local_printer_name = None
    job.status = PrintJobStatus.CLAIMED
    job.claimed_by_bridge_id = bridge.id
    job.claimed_at = now
    job.attempt_count += 1
    job.lease_expires_at = now + timedelta(seconds=PRINT_JOB_LEASE_SECONDS)
    bridge.last_seen_at = now
    await db.commit()
    return PrintJobClaimOut(
        **PrintJobOut.model_validate(job).model_dump(),
        printer_code=printer_code,
        local_printer_name=local_printer_name,
    )


@router.patch("/bridge/jobs/{job_id}", response_model=PrintJobOut)
async def update_bridge_job(
    job_id: UUID,
    payload: BridgeStatusUpdate,
    db: DbSession,
    branch_id: UUID | None = None,
    bridge_token: str | None = Header(default=None, alias="X-Print-Bridge-Token"),
    bridge_key: str | None = Header(default=None, alias="X-Print-Bridge-Key"),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    settings: Settings = Depends(get_app_settings),
) -> PrintJobOut:
    bridge = await _authenticate_bridge(
        db,
        settings,
        bridge_token=bridge_token,
        legacy_key=bridge_key,
        legacy_branch_id=branch_id,
    )
    if bridge_token and not (idempotency_key or "").strip():
        raise DomainError(
            "print_acknowledgement_key_required",
            "Scoped Print Bridge acknowledgements require an Idempotency-Key",
            status_code=422,
        )
    job = (
        await db.execute(
            select(PrintJob)
            .where(
                PrintJob.id == job_id,
                PrintJob.tenant_id == bridge.tenant_id,
                PrintJob.branch_id == bridge.branch_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if job is None:
        raise DomainError("print_job_not_found", "Print job not found", status_code=404)
    normalized_key = (idempotency_key or "").strip()
    if normalized_key:
        acknowledgement = (
            await db.execute(
                select(PrintJobAcknowledgement).where(
                    PrintJobAcknowledgement.tenant_id == bridge.tenant_id,
                    PrintJobAcknowledgement.idempotency_key == normalized_key,
                )
            )
        ).scalar_one_or_none()
        if acknowledgement is not None:
            if (
                acknowledgement.print_job_id != job.id
                or acknowledgement.bridge_id != bridge.id
                or acknowledgement.status != payload.status
            ):
                raise DomainError(
                    "print_acknowledgement_key_conflict",
                    "Print acknowledgement key cannot be reused for another transition",
                    status_code=409,
                )
            return PrintJobOut.model_validate(job)
    if job.claimed_by_bridge_id != bridge.id:
        raise DomainError("print_job_not_found", "Print job not found", status_code=404)
    if payload.attempt_count is not None and payload.attempt_count != job.attempt_count:
        raise DomainError(
            "stale_print_job_attempt",
            "Print job attempt no longer matches the current lease",
            status_code=409,
        )
    if bridge_token and payload.attempt_count is None:
        raise DomainError(
            "print_attempt_required",
            "Scoped Print Bridge acknowledgements require the claim attempt",
            status_code=422,
        )
    if payload.manual_retry_required and payload.status != PrintJobStatus.FAILED:
        raise DomainError(
            "invalid_manual_retry_flag",
            "Only a failed print can require a manual retry",
            status_code=422,
        )
    allowed = {
        PrintJobStatus.CLAIMED: {
            PrintJobStatus.SENT,
            PrintJobStatus.PRINTED,
            PrintJobStatus.FAILED,
        },
        PrintJobStatus.SENT: {PrintJobStatus.PRINTED, PrintJobStatus.FAILED},
        PrintJobStatus.FAILED: {PrintJobStatus.CLAIMED, PrintJobStatus.CANCELLED},
    }
    if payload.status != job.status and payload.status not in allowed.get(job.status, set()):
        raise DomainError(
            "invalid_print_transition", "Invalid print job transition", status_code=409
        )
    job.status = payload.status
    job.last_error = payload.error
    now = datetime.now(UTC)
    bridge.last_seen_at = now
    if payload.status == PrintJobStatus.SENT:
        job.manual_retry_required = False
        job.sent_at = now
        # The physical print itself still has to happen after this — extend
        # the lease rather than clearing it, so a bridge that goes quiet
        # between SENT and PRINTED is still recovered instead of stuck.
        job.lease_expires_at = now + timedelta(seconds=PRINT_JOB_LEASE_SECONDS)
    elif payload.status == PrintJobStatus.PRINTED:
        job.manual_retry_required = False
        job.printed_at = now
        job.last_error = None
        job.lease_expires_at = None
        job.print_result = payload.result
    elif payload.status in (PrintJobStatus.FAILED, PrintJobStatus.CANCELLED):
        job.lease_expires_at = None
        job.manual_retry_required = payload.manual_retry_required
    if normalized_key:
        db.add(
            PrintJobAcknowledgement(
                tenant_id=bridge.tenant_id,
                branch_id=bridge.branch_id,
                print_job_id=job.id,
                bridge_id=bridge.id,
                attempt_count=job.attempt_count,
                status=payload.status,
                idempotency_key=normalized_key,
            )
        )
    await db.commit()
    return PrintJobOut.model_validate(job)


@router.post("/bridge/heartbeat", response_model=BridgeHeartbeatOut)
async def bridge_heartbeat(
    payload: BridgeHeartbeat,
    db: DbSession,
    branch_id: UUID | None = None,
    bridge_token: str | None = Header(default=None, alias="X-Print-Bridge-Token"),
    bridge_key: str | None = Header(default=None, alias="X-Print-Bridge-Key"),
    settings: Settings = Depends(get_app_settings),
) -> BridgeHeartbeatOut:
    """A bridge with nothing to print still calls this, on its own cadence.

    Without it, an idle branch with no orders would look indistinguishable
    from a bridge that crashed hours ago — `last_seen_at` would simply stop
    moving the moment the queue ran dry, not the moment the agent actually
    stopped.
    """
    bridge = await _authenticate_bridge(
        db,
        settings,
        bridge_token=bridge_token,
        legacy_key=bridge_key,
        legacy_branch_id=branch_id,
    )
    now = datetime.now(UTC)
    bridge.last_seen_at = now
    if payload.platform:
        bridge.platform = payload.platform
    if payload.version:
        bridge.version = payload.version
    # Replaced wholesale rather than merged: this is the bridge's current,
    # complete view of what the OS reports, not a log of printers it has ever
    # seen. A printer unplugged since the last heartbeat should disappear.
    inventory_by_folded_name: dict[str, str] = {}
    for reported_name in payload.printers:
        local_name = reported_name.strip()
        if local_name:
            inventory_by_folded_name.setdefault(local_name.casefold(), local_name)
    # Keep the exact OS-reported spelling. CUPS printer names can be
    # case-sensitive, while the folded key only prevents duplicate inventory
    # rows from a noisy discovery command.
    bridge.printer_inventory = sorted(inventory_by_folded_name.values(), key=str.casefold)
    await db.commit()
    return BridgeHeartbeatOut(bridge_id=bridge.id, server_time=now)


@router.post("/bridge/mock-run")
async def run_mock_bridge(
    db: DbSession,
    branch_id: UUID | None = None,
    bridge_token: str | None = Header(default=None, alias="X-Print-Bridge-Token"),
    bridge_key: str | None = Header(default=None, alias="X-Print-Bridge-Key"),
    settings: Settings = Depends(get_app_settings),
) -> dict[str, int]:
    if not settings.dev_seed_enabled:
        raise DomainError("mock_bridge_disabled", "Mock bridge is disabled", status_code=403)
    bridge = await _authenticate_bridge(
        db,
        settings,
        bridge_token=bridge_token,
        legacy_key=bridge_key,
        legacy_branch_id=branch_id,
    )
    jobs = (
        (
            await db.execute(
                select(PrintJob).where(
                    PrintJob.tenant_id == bridge.tenant_id,
                    PrintJob.branch_id == bridge.branch_id,
                    PrintJob.status.in_([PrintJobStatus.PENDING, PrintJobStatus.FAILED]),
                    PrintJob.attempt_count < 5,
                )
            )
        )
        .scalars()
        .all()
    )
    now = datetime.now(UTC)
    for job in jobs:
        job.status = PrintJobStatus.PRINTED
        job.claimed_by_bridge_id = bridge.id
        job.claimed_at = job.claimed_at or now
        job.sent_at = now
        job.printed_at = now
        job.attempt_count += 1
        job.last_error = None
    bridge.last_seen_at = now
    await db.commit()
    return {"printed": len(jobs)}
