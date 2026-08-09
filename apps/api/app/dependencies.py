from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from typing import Annotated, cast
from uuid import UUID

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import Settings
from app.errors import DomainError
from app.models import AuthSession, Branch, Role, Tenant, User, UserBranchMembership
from app.security import as_utc, decode_token, utcnow
from app.services.subscriptions import enforce_trial_expiry, tenant_access_blocked

bearer_scheme = HTTPBearer(auto_error=False)


@dataclass(frozen=True, slots=True)
class Identity:
    user_id: UUID
    tenant_id: UUID | None
    branch_id: UUID | None
    role: str
    permissions: frozenset[str]
    is_super_admin: bool
    session_id: UUID
    token_family: UUID
    username: str
    display_name: str
    email: str | None
    # Every branch this user may act in, resolved server-side from their primary
    # branch plus membership rows. Never derived from anything the browser sends.
    accessible_branch_ids: frozenset[UUID] = frozenset()
    # True when the user spans the whole business (owners/administrators), which
    # is what lets them use the consolidated "all branches" views.
    has_all_branch_access: bool = False

    def can_access_branch(self, branch_id: UUID) -> bool:
        return branch_id in self.accessible_branch_ids


async def resolve_accessible_branches(
    db: AsyncSession, user: User
) -> tuple[frozenset[UUID], bool]:
    """Resolve which branches a user may operate in, from trusted DB state only.

    A user with no primary branch spans the entire business — this is the existing
    convention for owners and administrators. A user pinned to a branch is scoped
    to it, widened by any active membership rows.
    """
    if user.tenant_id is None:
        return frozenset(), False

    if user.branch_id is None:
        branch_ids = (
            (
                await db.execute(
                    select(Branch.id).where(Branch.tenant_id == user.tenant_id)
                )
            )
            .scalars()
            .all()
        )
        return frozenset(branch_ids), True

    membership_ids = (
        (
            await db.execute(
                select(UserBranchMembership.branch_id)
                .join(Branch, Branch.id == UserBranchMembership.branch_id)
                .where(
                    UserBranchMembership.user_id == user.id,
                    UserBranchMembership.tenant_id == user.tenant_id,
                    UserBranchMembership.is_active.is_(True),
                    Branch.tenant_id == user.tenant_id,
                )
            )
        )
        .scalars()
        .all()
    )
    return frozenset({user.branch_id, *membership_ids}), False


async def get_db(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.database.session() as session:
        yield session


def get_app_settings(request: Request) -> Settings:
    return cast(Settings, request.app.state.settings)


async def get_current_identity(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    db: Annotated[AsyncSession, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_app_settings)],
) -> Identity:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise DomainError("authentication_required", "Authentication required", status_code=401)
    payload = decode_token(settings, credentials.credentials, "access")
    try:
        user_id = UUID(payload["sub"])
        session_id = UUID(payload["sid"])
        claim_family = UUID(payload["family"])
        claim_tenant_id = UUID(payload["tenant_id"]) if payload.get("tenant_id") else None
        claim_branch_id = UUID(payload["branch_id"]) if payload.get("branch_id") else None
    except (KeyError, TypeError, ValueError) as exc:
        raise DomainError(
            "invalid_token", "Access token claims are invalid", status_code=401
        ) from exc

    result = await db.execute(
        select(User)
        .where(User.id == user_id)
        .options(selectinload(User.role).selectinload(Role.permissions))
    )
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise DomainError("account_inactive", "Account is inactive", status_code=401)
    if user.tenant_id != claim_tenant_id:
        raise DomainError("invalid_tenant_context", "Tenant context is invalid", status_code=401)

    session_result = await db.execute(select(AuthSession).where(AuthSession.id == session_id))
    auth_session = session_result.scalar_one_or_none()
    if (
        auth_session is None
        or auth_session.user_id != user.id
        or auth_session.tenant_id != user.tenant_id
        or auth_session.token_family != claim_family
        or auth_session.revoked_at is not None
        or as_utc(auth_session.expires_at) <= utcnow()
    ):
        raise DomainError("session_revoked", "Session is no longer active", status_code=401)

    if user.tenant_id is not None:
        tenant = await db.get(Tenant, user.tenant_id)
        if tenant is not None:
            await enforce_trial_expiry(db, tenant)
        if tenant_access_blocked(tenant):
            raise DomainError("tenant_inactive", "Business is not active", status_code=403)
        if claim_branch_id is not None:
            branch_result = await db.execute(
                select(Branch).where(
                    Branch.id == claim_branch_id,
                    Branch.tenant_id == user.tenant_id,
                    Branch.is_active.is_(True),
                )
            )
            if branch_result.scalar_one_or_none() is None:
                raise DomainError(
                    "branch_forbidden", "Branch access is not allowed", status_code=403
                )
        if user.branch_id is not None and claim_branch_id not in {None, user.branch_id}:
            raise DomainError("branch_forbidden", "Branch access is not allowed", status_code=403)

    permissions = frozenset(permission.code for permission in user.role.permissions)
    accessible_branch_ids, has_all_branch_access = await resolve_accessible_branches(db, user)
    return Identity(
        user_id=user.id,
        tenant_id=user.tenant_id,
        branch_id=claim_branch_id or user.branch_id,
        role=user.role.code,
        permissions=permissions,
        is_super_admin=user.is_super_admin,
        session_id=session_id,
        token_family=claim_family,
        username=user.username,
        display_name=user.display_name,
        email=user.email,
        accessible_branch_ids=accessible_branch_ids,
        has_all_branch_access=has_all_branch_access,
    )


CurrentIdentity = Annotated[Identity, Depends(get_current_identity)]
DbSession = Annotated[AsyncSession, Depends(get_db)]


def require_permissions(*required: str) -> Callable[[Identity], Awaitable[Identity]]:
    async def dependency(identity: CurrentIdentity) -> Identity:
        if identity.is_super_admin or "*" in identity.permissions:
            return identity
        missing = [permission for permission in required if permission not in identity.permissions]
        if missing:
            raise DomainError(
                "permission_denied",
                "You do not have permission to perform this action",
                status_code=403,
                details={"missing_permissions": missing},
            )
        return identity

    return dependency


def require_tenant(identity: Identity) -> UUID:
    if identity.tenant_id is None:
        raise DomainError(
            "tenant_context_required", "A business context is required", status_code=400
        )
    return identity.tenant_id


def require_branch(identity: Identity, requested: UUID | None = None) -> UUID:
    """Resolve the branch to operate on, enforcing server-side access.

    `requested` typically arrives from a query parameter or request body, so it is
    untrusted by definition: it is only honoured when the authenticated user has
    been granted that branch. Anything else is a 403, never a silent scope change.
    """
    branch_id = requested or identity.branch_id
    if branch_id is None:
        raise DomainError(
            "branch_context_required", "A branch context is required", status_code=400
        )
    if not identity.can_access_branch(branch_id):
        raise DomainError(
            "branch_forbidden",
            "You do not have access to this branch",
            status_code=403,
        )
    return branch_id
