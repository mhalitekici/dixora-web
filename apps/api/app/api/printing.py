from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime
from decimal import Decimal
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, Query, status
from sqlalchemy import select

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
    KitchenTicket,
    Order,
    PreparationStation,
    PrintBridgeClient,
    PrinterDevice,
    PrintJob,
)
from app.models.enums import OrderStatus, PaymentStatus, PrintJobStatus
from app.schemas import (
    BridgeStatusUpdate,
    PrintBridgeCreate,
    PrintBridgeCreated,
    PrinterDeviceCreate,
    PrinterDeviceOut,
    PrinterDeviceUpdate,
    PrintJobClaimOut,
    PrintJobCreate,
    PrintJobOut,
)
from app.services.audit import add_audit_log
from app.services.orders import (
    load_order,
    mark_order_bill_requested,
    order_bill_reference,
)

router = APIRouter(prefix="/printing", tags=["printing"])
PrintReader = Annotated[Identity, Depends(require_permissions("printing.read"))]
PrintManager = Annotated[Identity, Depends(require_permissions("printing.manage"))]


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
        new_value={"code": device.code, "transport": device.transport},
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
    previous = {
        "name": device.name,
        "is_active": device.is_active,
        "transport": device.transport,
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
    now = datetime.now(UTC)
    test_id = uuid4()
    job = PrintJob(
        tenant_id=tenant_id,
        branch_id=device.branch_id,
        preparation_station_id=device.preparation_station_id,
        printer_device_id=device.id,
        payload={
            "document_type": "PRINTER_TEST",
            "test_id": str(test_id),
            "printer_code": device.code,
            "printer_name": device.name,
            "generated_at": now.isoformat(),
            "lines": ["DIXORA YAZICI TESTİ", device.name, "Bağlantı işi başarıyla kuyruğa alındı."],
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
                PrinterDevice.preparation_station_id == station_id,
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
    if printer_device_id is not None:
        return station_id, printer_device_id
    if station_id is not None:
        return station_id, await _first_active_printer_id(
            db,
            tenant_id=tenant_id,
            branch_id=branch_id,
            station_id=station_id,
        )

    payload_type = str(payload.payload.get("type") or "").upper()
    if payload_type == "BILL":
        general_printer_id = await _first_active_printer_id(
            db,
            tenant_id=tenant_id,
            branch_id=branch_id,
            station_id=None,
        )
        if general_printer_id is not None:
            return station_id, general_printer_id
        return station_id, (
            await db.execute(
                select(PrinterDevice.id)
                .where(
                    PrinterDevice.tenant_id == tenant_id,
                    PrinterDevice.branch_id == branch_id,
                    PrinterDevice.is_active.is_(True),
                )
                .order_by(PrinterDevice.created_at)
                .limit(1)
            )
        ).scalar_one_or_none()
    return station_id, printer_device_id


async def _build_bill_payload(
    db: DbSession,
    *,
    identity: Identity,
    order_id: UUID,
    kind: str,
) -> dict[str, object]:
    order = await load_order(db, require_tenant(identity), order_id, lock=True)
    if order.branch_id != identity.branch_id:
        raise DomainError("order_not_found", "Order not found", status_code=404)
    if kind == "ORIGINAL":
        await mark_order_bill_requested(db, order=order)

    branch = await _scoped_branch(db, tenant_id=order.tenant_id, branch_id=order.branch_id)
    paid_total = sum(
        (
            payment.amount
            for payment in order.payments
            if payment.status == PaymentStatus.COMPLETED
        ),
        Decimal("0.00"),
    )
    remaining = max(Decimal("0.00"), order.total - paid_total)
    issue_time = datetime.now(UTC).isoformat()
    return {
        "type": "BILL",
        "stage": "CLOSING" if order.status == OrderStatus.PAID else "PRE_PAYMENT",
        "content_type": "application/vnd.dixora.receipt+json",
        "copies": 1,
        "is_reprint": kind == "REPRINT",
        "document": {
            "title": "MUSTERI BILGI FISI",
            "branch_name": branch.name,
            "station_name": "KASA",
            "order_number": order_bill_reference(order.id),
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
                }
                for item in order.items
            ],
            "footer": [
                f"Ara toplam: {order.subtotal}",
                f"Indirim: {order.discount_total}",
                f"Vergi: {order.tax_total}",
                f"Toplam: {order.total}",
                f"Odenen: {paid_total}",
                f"Kalan: {remaining}",
            ],
        },
        "receipt": {
            "kind": kind,
            "title": "MUSTERI BILGI FISI",
            "business": {
                "name": branch.name,
                "branch": branch.name,
                "address": branch.address,
                "phone": branch.phone,
            },
            "meta": {
                "reference": order_bill_reference(order.id),
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
                }
                for item in order.items
            ],
            "totals": {
                "subtotal": str(order.subtotal),
                "discount": str(order.discount_total),
                "tax": str(order.tax_total),
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
            "footerNote": "Odeme icin kasaya yoneliniz.",
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
    if payload.order_id is not None and str(payload.payload.get("type") or "").upper() == "BILL":
        job_payload = await _build_bill_payload(
            db,
            identity=identity,
            order_id=payload.order_id,
            kind=payload.kind.value,
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
    requested_codes = _requested_printer_codes(printer_codes)
    result = (
        await db.execute(
            select(PrintJob, PrinterDevice.code)
            .join(
                PrinterDevice,
                (PrinterDevice.id == PrintJob.printer_device_id)
                & (PrinterDevice.tenant_id == PrintJob.tenant_id)
                & (PrinterDevice.branch_id == PrintJob.branch_id),
            )
            .where(
                PrintJob.tenant_id == bridge.tenant_id,
                PrintJob.branch_id == bridge.branch_id,
                PrinterDevice.is_active.is_(True),
                PrinterDevice.code.in_(requested_codes),
                PrintJob.status.in_([PrintJobStatus.PENDING, PrintJobStatus.FAILED]),
                PrintJob.attempt_count < 5,
            )
            .order_by(PrintJob.created_at)
            .with_for_update(of=PrintJob, skip_locked=True)
            .limit(1)
        )
    ).one_or_none()
    if result is None:
        return None
    job, printer_code = result
    job.status = PrintJobStatus.CLAIMED
    job.claimed_by_bridge_id = bridge.id
    job.claimed_at = datetime.now(UTC)
    job.attempt_count += 1
    bridge.last_seen_at = job.claimed_at
    await db.commit()
    return PrintJobClaimOut(
        **PrintJobOut.model_validate(job).model_dump(),
        printer_code=printer_code,
    )


@router.patch("/bridge/jobs/{job_id}", response_model=PrintJobOut)
async def update_bridge_job(
    job_id: UUID,
    payload: BridgeStatusUpdate,
    db: DbSession,
    branch_id: UUID | None = None,
    bridge_token: str | None = Header(default=None, alias="X-Print-Bridge-Token"),
    bridge_key: str | None = Header(default=None, alias="X-Print-Bridge-Key"),
    settings: Settings = Depends(get_app_settings),
) -> PrintJobOut:
    bridge = await _authenticate_bridge(
        db,
        settings,
        bridge_token=bridge_token,
        legacy_key=bridge_key,
        legacy_branch_id=branch_id,
    )
    job = (
        await db.execute(
            select(PrintJob)
            .where(
                PrintJob.id == job_id,
                PrintJob.tenant_id == bridge.tenant_id,
                PrintJob.branch_id == bridge.branch_id,
                PrintJob.claimed_by_bridge_id == bridge.id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if job is None:
        raise DomainError("print_job_not_found", "Print job not found", status_code=404)
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
        job.sent_at = now
    elif payload.status == PrintJobStatus.PRINTED:
        job.printed_at = now
        job.last_error = None
    await db.commit()
    return PrintJobOut.model_validate(job)


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
