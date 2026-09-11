from __future__ import annotations

import hashlib
from datetime import timedelta
from uuid import UUID

from fastapi import Request
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import Settings
from app.errors import DomainError
from app.models import AuditLog, Role, User, UserBranchMembership
from app.security import utcnow, verify_password
from app.services.audit import add_audit_log


def _credential_key(tenant_id: UUID, username: str) -> str:
    value = f"shift-pin:{tenant_id}:{username.strip().lower()}"
    return f"credential:{hashlib.sha256(value.encode()).hexdigest()}"


async def verify_staff_pin(
    db: AsyncSession,
    *,
    settings: Settings,
    request: Request,
    tenant_id: UUID,
    branch_id: UUID,
    username: str,
    pin: str,
    permission: str,
    explicit_branch_assignment: bool,
) -> User:
    """Reauthenticate an employee without ever persisting or returning their PIN."""
    key = _credential_key(tenant_id, username)
    ip_address = request.client.host if request.client else None
    since = utcnow() - timedelta(minutes=settings.login_rate_limit_window_minutes)
    failures = (
        await db.execute(
            select(func.count(AuditLog.id)).where(
                AuditLog.action == "auth.staff_pin_failed",
                AuditLog.reason == key,
                AuditLog.ip_address == ip_address,
                AuditLog.created_at >= since,
            )
        )
    ).scalar_one()
    if failures >= settings.login_rate_limit_attempts:
        raise DomainError(
            "login_rate_limited",
            "Too many login attempts. Please wait and try again.",
            status_code=429,
        )

    user = (
        await db.execute(
            select(User)
            .where(
                User.tenant_id == tenant_id,
                or_(
                    User.username == username.strip().lower(),
                    User.email == username.strip().lower(),
                ),
            )
            .options(selectinload(User.role).selectinload(Role.permissions))
        )
    ).scalar_one_or_none()
    valid_pin = bool(
        user and user.is_active and user.pin_hash and verify_password(pin, user.pin_hash)
    )
    if not valid_pin:
        add_audit_log(
            db,
            identity=None,
            tenant_id=tenant_id,
            branch_id=branch_id,
            action="auth.staff_pin_failed",
            resource_type="user",
            resource_id=user.id if user else None,
            reason=key,
            ip_address=ip_address,
            user_agent=request.headers.get("user-agent"),
        )
        await db.commit()
        raise DomainError("invalid_credentials", "Invalid username or PIN", status_code=401)

    assert user is not None
    permission_codes = {item.code for item in user.role.permissions}
    if permission not in permission_codes and "*" not in permission_codes:
        raise DomainError(
            "staff_permission_required",
            "This employee is not authorized for this operation",
            status_code=403,
        )

    assigned = user.branch_id == branch_id
    if not assigned:
        assigned = (
            await db.execute(
                select(UserBranchMembership.id).where(
                    UserBranchMembership.tenant_id == tenant_id,
                    UserBranchMembership.user_id == user.id,
                    UserBranchMembership.branch_id == branch_id,
                    UserBranchMembership.is_active.is_(True),
                )
            )
        ).scalar_one_or_none() is not None
    if not assigned and not (user.branch_id is None and not explicit_branch_assignment):
        raise DomainError(
            "staff_branch_forbidden",
            "This employee is not assigned to the selected branch",
            status_code=403,
        )
    return user
