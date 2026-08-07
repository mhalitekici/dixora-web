from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select

from app.dependencies import DbSession, Identity, require_permissions, require_tenant
from app.models import AuditLog

router = APIRouter(prefix="/audit-logs", tags=["audit"])
AuditReader = Annotated[Identity, Depends(require_permissions("audit.read"))]


@router.get("")
async def list_audit_logs(
    identity: AuditReader,
    db: DbSession,
    action: str | None = None,
    limit: int = Query(default=100, ge=1, le=250),
) -> list[dict[str, object]]:
    predicates = (
        []
        if identity.is_super_admin
        else [AuditLog.tenant_id == require_tenant(identity)]
    )
    if action:
        predicates.append(AuditLog.action == action)
    rows = (
        (
            await db.execute(
                select(AuditLog)
                .where(*predicates)
                .order_by(AuditLog.created_at.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return [
        {
            "id": str(item.id),
            "branch_id": str(item.branch_id) if item.branch_id else None,
            "actor_user_id": str(item.actor_user_id) if item.actor_user_id else None,
            "actor_role": item.actor_role,
            "action": item.action,
            "resource_type": item.resource_type,
            "resource_id": item.resource_id,
            "previous_value": item.previous_value,
            "new_value": item.new_value,
            "reason": item.reason,
            "timestamp": item.created_at.isoformat(),
        }
        for item in rows
    ]
