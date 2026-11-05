from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import select

from app.dependencies import (
    DbSession,
    Identity,
    require_branch,
    require_permissions,
    require_tenant,
)
from app.errors import DomainError
from app.models import (
    AuditLog,
    PrintBridgeClient,
    PrintBridgePrinterMapping,
    PrinterDevice,
    PrintJob,
)
from app.models.enums import PrintJobStatus
from app.services.audit import add_audit_log

router = APIRouter(prefix="/printing", tags=["printing"])
Reader = Annotated[Identity, Depends(require_permissions("printing.read"))]
Manager = Annotated[Identity, Depends(require_permissions("printing.manage"))]


@router.get("/physical-acceptance")
async def physical_acceptance(
    identity: Reader, db: DbSession, branch_id: UUID | None = None
) -> dict[str, object]:
    branch = require_branch(identity, branch_id)
    devices = (
        (
            await db.execute(
                select(PrinterDevice.id).where(
                    PrinterDevice.tenant_id == require_tenant(identity),
                    PrinterDevice.branch_id == branch,
                    PrinterDevice.is_active.is_(True),
                )
            )
        )
        .scalars()
        .all()
    )
    mappings = (
        (
            await db.execute(
                select(PrintBridgePrinterMapping)
                .join(PrintBridgeClient)
                .where(
                    PrintBridgePrinterMapping.tenant_id == require_tenant(identity),
                    PrintBridgePrinterMapping.branch_id == branch,
                    PrintBridgeClient.is_active.is_(True),
                )
            )
        )
        .scalars()
        .all()
    )
    proofs = (
        (
            await db.execute(
                select(AuditLog.new_value).where(
                    AuditLog.tenant_id == require_tenant(identity),
                    AuditLog.branch_id == branch,
                    AuditLog.action == "printing.physical_confirmed",
                )
            )
        )
        .scalars()
        .all()
    )
    confirmed = {
        mapping.printer_device_id
        for mapping in mappings
        if any(
            proof
            and proof.get("mapping_id") == str(mapping.id)
            and proof.get("local_printer_name") == mapping.local_printer_name
            for proof in proofs
        )
    }
    return {
        "confirmed": bool(devices) and set(devices).issubset(confirmed),
        "confirmed_device_ids": sorted(str(value) for value in confirmed),
    }


@router.post("/jobs/{job_id}/physical-confirmation", status_code=204)
async def confirm_physical_output(job_id: UUID, identity: Manager, db: DbSession) -> None:
    job = (
        await db.execute(
            select(PrintJob)
            .where(
                PrintJob.id == job_id,
                PrintJob.tenant_id == require_tenant(identity),
                PrintJob.branch_id == require_branch(identity),
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if job is None:
        raise DomainError("print_job_not_found", "Baskı işi bulunamadı.", status_code=404)
    if job.status != PrintJobStatus.PRINTED or str(job.payload.get("type", "")).upper() != "TEST":
        raise DomainError(
            "physical_test_required",
            "Önce başarılı bir test çıktısı alın ve kağıdı kontrol edin.",
            status_code=409,
        )
    mapping = (
        await db.execute(
            select(PrintBridgePrinterMapping)
            .join(PrintBridgeClient)
            .where(
                PrintBridgePrinterMapping.tenant_id == job.tenant_id,
                PrintBridgePrinterMapping.branch_id == job.branch_id,
                PrintBridgePrinterMapping.printer_device_id == job.printer_device_id,
                PrintBridgePrinterMapping.bridge_id == job.claimed_by_bridge_id,
                PrintBridgeClient.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if mapping is None:
        raise DomainError(
            "printer_mapping_changed",
            "Yazıcı eşleştirmesi değişti. Yeni test çıktısı alın.",
            status_code=409,
        )
    add_audit_log(
        db,
        identity=identity,
        action="printing.physical_confirmed",
        resource_type="print_job",
        resource_id=job.id,
        new_value={
            "mapping_id": str(mapping.id),
            "local_printer_name": mapping.local_printer_name,
            "printer_device_id": str(mapping.printer_device_id),
            "operator_confirmed": True,
        },
    )
    await db.commit()
