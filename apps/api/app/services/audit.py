from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import Identity
from app.models import AuditLog


def add_audit_log(
    db: AsyncSession,
    *,
    identity: Identity | None,
    action: str,
    resource_type: str,
    resource_id: UUID | str | None,
    tenant_id: UUID | None = None,
    branch_id: UUID | None = None,
    previous_value: dict[str, Any] | None = None,
    new_value: dict[str, Any] | None = None,
    reason: str | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> AuditLog:
    record = AuditLog(
        tenant_id=tenant_id
        if tenant_id is not None
        else (identity.tenant_id if identity else None),
        branch_id=branch_id
        if branch_id is not None
        else (identity.branch_id if identity else None),
        actor_user_id=identity.user_id if identity else None,
        actor_role=identity.role if identity else None,
        action=action,
        resource_type=resource_type,
        resource_id=str(resource_id) if resource_id else None,
        previous_value=previous_value,
        new_value=new_value,
        reason=reason,
        ip_address=ip_address,
        user_agent=user_agent,
    )
    db.add(record)
    return record
