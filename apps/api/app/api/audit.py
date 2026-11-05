from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select

from app.dependencies import (
    DbSession,
    Identity,
    require_branch,
    require_permissions,
    require_tenant,
)
from app.models import AuditLog, Branch, DiningTable, Product, User
from app.services.audit_display import safe_audit_value

router = APIRouter(prefix="/audit-logs", tags=["audit"])
AuditReader = Annotated[Identity, Depends(require_permissions("audit.read"))]


@router.get("")
async def list_audit_logs(
    identity: AuditReader,
    db: DbSession,
    action: str | None = None,
    limit: int = Query(default=100, ge=1, le=250),
) -> list[dict[str, object]]:
    # A platform super admin has neither business nor branch context: scoping
    # them to one would leave the platform audit view permanently empty. Every
    # business user stays pinned to their own branch's trail.
    predicates = []
    if not identity.is_super_admin:
        predicates.append(AuditLog.tenant_id == require_tenant(identity))
        predicates.append(AuditLog.branch_id == require_branch(identity))
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
    user_ids = {row.actor_user_id for row in rows if row.actor_user_id}
    branch_ids = {row.branch_id for row in rows if row.branch_id}
    tenant_scope = {row.tenant_id for row in rows if row.tenant_id}
    actor_rows = (
        await db.execute(
            select(User.id, User.display_name).where(
                User.id.in_(user_ids), User.tenant_id.in_(tenant_scope)
            )
        )
    ).all()
    branch_rows = (
        await db.execute(
            select(Branch.id, Branch.name).where(
                Branch.id.in_(branch_ids), Branch.tenant_id.in_(tenant_scope)
            )
        )
    ).all()
    actors = {key: name for key, name in actor_rows}
    branches = {key: name for key, name in branch_rows}
    resources: dict[tuple[str, str], str] = {}
    for kind, model, field in (
        ("product", Product, Product.name),
        ("table", DiningTable, DiningTable.name),
        ("branch", Branch, Branch.name),
        ("user", User, User.display_name),
    ):
        ids = set()
        for row in rows:
            if row.resource_type == kind and row.resource_id:
                try:
                    ids.add(UUID(row.resource_id))
                except ValueError:
                    pass
        names = (
            await db.execute(
                select(model.id, field).where(model.id.in_(ids), model.tenant_id.in_(tenant_scope))
            )
        ).all()
        resources.update({(kind, str(key)): name for key, name in names})
    return [
        {
            "id": str(item.id),
            "branch_id": str(item.branch_id) if item.branch_id else None,
            "actor_user_id": str(item.actor_user_id) if item.actor_user_id else None,
            "actor_role": item.actor_role,
            "actor_name": actors.get(item.actor_user_id) if item.actor_user_id else None,
            "branch_name": branches.get(item.branch_id) if item.branch_id else None,
            "resource_name": resources.get((item.resource_type, item.resource_id or "")),
            "action": item.action,
            "resource_type": item.resource_type,
            "resource_id": item.resource_id,
            "previous_value": safe_audit_value(item.previous_value),
            "new_value": safe_audit_value(item.new_value),
            "reason": None if (item.reason or "").startswith("credential:") else item.reason,
            "timestamp": item.created_at.isoformat(),
        }
        for item in rows
    ]
