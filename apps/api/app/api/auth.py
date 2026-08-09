from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import jwt
from fastapi import APIRouter, Depends, Request, status
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import Settings
from app.dependencies import (
    CurrentIdentity,
    DbSession,
    get_app_settings,
)
from app.errors import DomainError
from app.models import (
    AuditLog,
    AuthSession,
    Branch,
    RealtimeTicket,
    Role,
    Tenant,
    TrustedDevice,
    User,
)
from app.schemas import (
    AccessibleBranchesOut,
    AuthResponse,
    BranchSessionSummary,
    LoginRequest,
    LogoutRequest,
    MeOut,
    PinLoginRequest,
    RealtimeTicketOut,
    RefreshRequest,
    SelfPasswordChange,
    SwitchBranchRequest,
    TenantSessionSummary,
    TrustedDeviceEnrollment,
)
from app.security import (
    as_utc,
    decode_token,
    generate_trusted_device_token,
    hash_password,
    issue_token_pair,
    rotate_refresh_token,
    switch_refresh_token_branch,
    trusted_device_token_hash,
    utcnow,
    verify_password,
)
from app.services.audit import add_audit_log
from app.services.subscriptions import enforce_trial_expiry, tenant_access_blocked

router = APIRouter(prefix="/auth", tags=["authentication"])


def _credential_key(prefix: str, business: str | None, username: str) -> str:
    normalized = f"{prefix}:{business or '-'}:{username}".strip().lower()
    return f"credential:{hashlib.sha256(normalized.encode('utf-8')).hexdigest()}"


async def _enforce_login_rate_limit(
    db: AsyncSession,
    settings: Settings,
    *,
    action: str,
    credential_key: str,
    ip_address: str | None,
) -> None:
    window_started = utcnow() - timedelta(minutes=settings.login_rate_limit_window_minutes)
    failed_attempts = (
        await db.execute(
            select(func.count(AuditLog.id)).where(
                AuditLog.action == action,
                AuditLog.reason == credential_key,
                AuditLog.ip_address == ip_address,
                AuditLog.created_at >= window_started,
            )
        )
    ).scalar_one()
    if failed_attempts >= settings.login_rate_limit_attempts:
        raise DomainError(
            "login_rate_limited",
            "Too many login attempts. Please wait before trying again.",
            status_code=429,
            details={"retry_after_seconds": settings.login_rate_limit_window_minutes * 60},
        )


async def user_payload(
    db: AsyncSession,
    user: User,
    branch_id: UUID | None = None,
) -> MeOut:
    selected_branch_id = branch_id or user.branch_id
    tenant = await db.get(Tenant, user.tenant_id) if user.tenant_id else None
    branch = await db.get(Branch, selected_branch_id) if selected_branch_id else None
    return MeOut(
        id=user.id,
        tenant_id=user.tenant_id,
        branch_id=selected_branch_id,
        username=user.username,
        email=user.email,
        display_name=user.display_name,
        role=user.role.code,
        permissions=sorted(permission.code for permission in user.role.permissions),
        is_super_admin=user.is_super_admin,
        tenant=(
            TenantSessionSummary(
                id=tenant.id,
                name=tenant.name,
                slug=tenant.slug,
                state=tenant.state,
                is_active=tenant.is_active,
                default_currency=tenant.default_currency,
            )
            if tenant
            else None
        ),
        branch=(
            BranchSessionSummary(
                id=branch.id,
                name=branch.name,
                slug=branch.slug,
                timezone=branch.timezone,
                is_active=branch.is_active,
            )
            if branch
            else None
        ),
    )


async def _find_user(
    db: AsyncSession,
    *,
    business_slug: str | None,
    username: str,
) -> tuple[User | None, Tenant | None]:
    tenant: Tenant | None = None
    if business_slug:
        tenant = (
            await db.execute(select(Tenant).where(Tenant.slug == business_slug.lower()))
        ).scalar_one_or_none()
        if tenant is None:
            return None, None
        tenant_filter = User.tenant_id == tenant.id
    else:
        tenant_filter = User.tenant_id.is_(None)
    user = (
        await db.execute(
            select(User)
            .where(
                tenant_filter,
                or_(User.username == username.lower(), User.email == username.lower()),
            )
            .options(selectinload(User.role).selectinload(Role.permissions))
        )
    ).scalar_one_or_none()
    return user, tenant


async def _validate_branch(
    db: AsyncSession,
    user: User,
    branch_id: UUID | None,
) -> UUID | None:
    selected = branch_id or user.branch_id
    if user.tenant_id is None:
        return None
    if selected is None:
        selected = (
            await db.execute(
                select(Branch.id)
                .where(Branch.tenant_id == user.tenant_id, Branch.is_active.is_(True))
                .order_by(Branch.created_at)
                .limit(1)
            )
        ).scalar_one_or_none()
    if selected is None:
        raise DomainError("branch_required", "No active branch is available", status_code=403)
    branch = (
        await db.execute(
            select(Branch).where(
                Branch.id == selected,
                Branch.tenant_id == user.tenant_id,
                Branch.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if branch is None or (user.branch_id is not None and user.branch_id != branch.id):
        raise DomainError("branch_forbidden", "Branch access is not allowed", status_code=403)
    return branch.id


async def _enroll_trusted_device(
    db: AsyncSession,
    settings: Settings,
    *,
    user: User,
    branch_id: UUID,
    previous_token: str | None,
    ip_address: str | None,
    user_agent: str | None,
) -> TrustedDeviceEnrollment:
    tenant_id = user.tenant_id
    if tenant_id is None:
        raise DomainError(
            "tenant_context_required",
            "A business context is required",
            status_code=400,
        )
    now = utcnow()
    if previous_token:
        previous = (
            await db.execute(
                select(TrustedDevice).where(
                    TrustedDevice.tenant_id == tenant_id,
                    TrustedDevice.branch_id == branch_id,
                    TrustedDevice.credential_hash
                    == trusted_device_token_hash(previous_token),
                )
            )
        ).scalar_one_or_none()
        if previous is not None and previous.revoked_at is None:
            previous.revoked_at = now

    lifetime = timedelta(days=settings.trusted_device_days)
    raw_token = generate_trusted_device_token()
    trusted_device = TrustedDevice(
        tenant_id=tenant_id,
        branch_id=branch_id,
        created_by_user_id=user.id,
        credential_hash=trusted_device_token_hash(raw_token),
        expires_at=now + lifetime,
        user_agent=user_agent,
        last_ip_address=ip_address,
    )
    db.add(trusted_device)
    await db.flush()
    add_audit_log(
        db,
        identity=None,
        tenant_id=tenant_id,
        branch_id=branch_id,
        action="auth.trusted_device_enrolled",
        resource_type="trusted_device",
        resource_id=trusted_device.id,
        new_value={"created_by_user_id": str(user.id)},
        ip_address=ip_address,
        user_agent=user_agent,
    )
    return TrustedDeviceEnrollment(
        token=raw_token,
        expires_in=int(lifetime.total_seconds()),
    )


async def _audit_pin_failure(
    db: AsyncSession,
    *,
    credential_key: str,
    tenant_id: UUID | None,
    branch_id: UUID | None,
    user_id: UUID | None,
    ip_address: str | None,
    user_agent: str | None,
) -> None:
    add_audit_log(
        db,
        identity=None,
        tenant_id=tenant_id,
        branch_id=branch_id,
        action="auth.pin_login_failed",
        resource_type="user",
        resource_id=user_id,
        reason=credential_key,
        ip_address=ip_address,
        user_agent=user_agent,
    )
    await db.commit()


@router.post("/login", response_model=AuthResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    db: DbSession,
    settings: Settings = Depends(get_app_settings),
) -> AuthResponse:
    ip_address = request.client.host if request.client else None
    credential_key = _credential_key("password", payload.business, payload.username)
    await _enforce_login_rate_limit(
        db,
        settings,
        action="auth.login_failed",
        credential_key=credential_key,
        ip_address=ip_address,
    )
    user, tenant = await _find_user(
        db,
        business_slug=payload.business,
        username=payload.username,
    )
    if user is None or not verify_password(payload.password, user.password_hash):
        add_audit_log(
            db,
            identity=None,
            tenant_id=tenant.id if tenant else None,
            action="auth.login_failed",
            resource_type="user",
            resource_id=user.id if user else None,
            reason=credential_key,
            ip_address=ip_address,
            user_agent=request.headers.get("user-agent"),
        )
        await db.commit()
        raise DomainError("invalid_credentials", "Invalid login credentials", status_code=401)
    if tenant is not None:
        await enforce_trial_expiry(db, tenant)
    if not user.is_active or (tenant is not None and tenant_access_blocked(tenant)):
        raise DomainError("account_inactive", "Account or business is inactive", status_code=403)
    branch_id = await _validate_branch(db, user, payload.branch_id)
    tokens = await issue_token_pair(
        db,
        settings,
        user,
        branch_id=branch_id,
        device_name=payload.device_name,
        ip_address=ip_address,
        user_agent=request.headers.get("user-agent"),
        remember_me=payload.remember_me,
    )
    trusted_device = None
    if (
        settings.pin_login_enabled
        and payload.enroll_trusted_device
        and user.tenant_id is not None
        and branch_id is not None
    ):
        trusted_device = await _enroll_trusted_device(
            db,
            settings,
            user=user,
            branch_id=branch_id,
            previous_token=payload.trusted_device_token,
            ip_address=ip_address,
            user_agent=request.headers.get("user-agent"),
        )
    user.last_login_at = utcnow()
    add_audit_log(
        db,
        identity=None,
        tenant_id=user.tenant_id,
        branch_id=branch_id,
        action="auth.login",
        resource_type="user",
        resource_id=user.id,
        ip_address=ip_address,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()
    return AuthResponse(
        **tokens.model_dump(),
        user=await user_payload(db, user, branch_id),
        trusted_device=trusted_device,
    )


@router.post("/pin-login", response_model=AuthResponse)
async def pin_login(
    payload: PinLoginRequest,
    request: Request,
    db: DbSession,
    settings: Settings = Depends(get_app_settings),
) -> AuthResponse:
    if not settings.pin_login_enabled:
        raise DomainError("pin_login_disabled", "PIN login is disabled", status_code=403)
    ip_address = request.client.host if request.client else None
    credential_key = _credential_key("pin", payload.business_slug, payload.username)
    await _enforce_login_rate_limit(
        db,
        settings,
        action="auth.pin_login_failed",
        credential_key=credential_key,
        ip_address=ip_address,
    )
    tenant = (
        await db.execute(select(Tenant).where(Tenant.slug == payload.business_slug.lower()))
    ).scalar_one_or_none()
    if tenant is None:
        await _audit_pin_failure(
            db,
            credential_key=credential_key,
            tenant_id=None,
            branch_id=None,
            user_id=None,
            ip_address=ip_address,
            user_agent=request.headers.get("user-agent"),
        )
        raise DomainError("invalid_credentials", "Invalid login credentials", status_code=401)
    await enforce_trial_expiry(db, tenant)
    if tenant_access_blocked(tenant):
        raise DomainError("account_inactive", "Account or business is inactive", status_code=403)
    branch = (
        await db.execute(
            select(Branch).where(
                Branch.tenant_id == tenant.id,
                Branch.slug == payload.branch_slug.lower(),
                Branch.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if branch is None:
        await _audit_pin_failure(
            db,
            credential_key=credential_key,
            tenant_id=tenant.id,
            branch_id=None,
            user_id=None,
            ip_address=ip_address,
            user_agent=request.headers.get("user-agent"),
        )
        raise DomainError("invalid_credentials", "Invalid login credentials", status_code=401)
    if not payload.device_token:
        await _audit_pin_failure(
            db,
            credential_key=credential_key,
            tenant_id=tenant.id,
            branch_id=branch.id,
            user_id=None,
            ip_address=ip_address,
            user_agent=request.headers.get("user-agent"),
        )
        raise DomainError(
            "trusted_device_required",
            "This device must be authorized with a password login first",
            status_code=403,
        )
    trusted_device = (
        await db.execute(
            select(TrustedDevice).where(
                TrustedDevice.tenant_id == tenant.id,
                TrustedDevice.branch_id == branch.id,
                TrustedDevice.credential_hash
                == trusted_device_token_hash(payload.device_token),
            )
        )
    ).scalar_one_or_none()
    if (
        trusted_device is None
        or trusted_device.revoked_at is not None
        or as_utc(trusted_device.expires_at) <= utcnow()
    ):
        await _audit_pin_failure(
            db,
            credential_key=credential_key,
            tenant_id=tenant.id,
            branch_id=branch.id,
            user_id=None,
            ip_address=ip_address,
            user_agent=request.headers.get("user-agent"),
        )
        raise DomainError(
            "trusted_device_invalid",
            "This trusted-device credential is invalid or expired",
            status_code=403,
        )
    user = (
        await db.execute(
            select(User)
            .where(
                User.tenant_id == tenant.id,
                or_(
                    User.username == payload.username.lower(),
                    User.email == payload.username.lower(),
                ),
                User.is_active.is_(True),
            )
            .options(selectinload(User.role).selectinload(Role.permissions))
        )
    ).scalar_one_or_none()
    if user is None or user.pin_hash is None or not verify_password(payload.pin, user.pin_hash):
        await _audit_pin_failure(
            db,
            credential_key=credential_key,
            tenant_id=tenant.id,
            branch_id=branch.id,
            user_id=user.id if user else None,
            ip_address=ip_address,
            user_agent=request.headers.get("user-agent"),
        )
        raise DomainError("invalid_credentials", "Invalid login credentials", status_code=401)
    if user.branch_id is not None and user.branch_id != branch.id:
        raise DomainError("branch_forbidden", "Branch access is not allowed", status_code=403)
    tokens = await issue_token_pair(
        db,
        settings,
        user,
        branch_id=branch.id,
        device_name=f"trusted-device:{trusted_device.id}",
        ip_address=ip_address,
        user_agent=request.headers.get("user-agent"),
    )
    user.last_login_at = utcnow()
    trusted_device.last_used_at = utcnow()
    trusted_device.last_ip_address = ip_address
    add_audit_log(
        db,
        identity=None,
        tenant_id=tenant.id,
        branch_id=branch.id,
        action="auth.pin_login",
        resource_type="user",
        resource_id=user.id,
        new_value={"trusted_device_id": str(trusted_device.id)},
        ip_address=ip_address,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()
    return AuthResponse(
        **tokens.model_dump(),
        user=await user_payload(db, user, branch.id),
    )


@router.post("/refresh", response_model=AuthResponse)
async def refresh(
    payload: RefreshRequest,
    db: DbSession,
    settings: Settings = Depends(get_app_settings),
) -> AuthResponse:
    tokens, user, branch_id = await rotate_refresh_token(db, settings, payload.refresh_token)
    await db.commit()
    return AuthResponse(
        **tokens.model_dump(),
        user=await user_payload(db, user, branch_id),
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    payload: LogoutRequest,
    request: Request,
    db: DbSession,
    settings: Settings = Depends(get_app_settings),
) -> None:
    logout_session = await _find_logout_session(
        db,
        settings,
        refresh_token=payload.refresh_token,
        authorization=request.headers.get("authorization"),
    )
    if logout_session is None:
        return

    auth_session, claims = logout_session
    if auth_session.revoked_at is not None:
        return

    auth_session.revoked_at = datetime.now(UTC)
    audit_record = add_audit_log(
        db,
        identity=None,
        tenant_id=auth_session.tenant_id,
        branch_id=_optional_uuid_claim(claims, "branch_id"),
        action="auth.logout",
        resource_type="auth_session",
        resource_id=auth_session.id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    audit_record.actor_user_id = auth_session.user_id
    role = claims.get("role")
    audit_record.actor_role = role if isinstance(role, str) else None
    await db.commit()


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT)
async def change_own_password(
    payload: SelfPasswordChange,
    request: Request,
    identity: CurrentIdentity,
    db: DbSession,
) -> None:
    """Let a signed-in user rotate their own password.

    The current password is verified server-side (never trusted from the
    client), and every *other* session for this user is revoked so a stolen
    refresh token cannot outlive the rotation. The caller's own session is
    intentionally preserved so changing a password does not log you out of the
    terminal you are standing at.
    """
    user = (
        await db.execute(
            select(User)
            .where(User.id == identity.user_id)
            .options(selectinload(User.role).selectinload(Role.permissions))
        )
    ).scalar_one_or_none()
    if user is None or not user.is_active:
        raise DomainError("account_inactive", "Account is inactive", status_code=403)

    # Repeated wrong "current password" attempts are credential guessing against
    # an already-open session, so they are throttled like a login would be.
    ip_address = request.client.host if request.client else None
    credential_key = _credential_key("password-change", None, str(user.id))
    await _enforce_login_rate_limit(
        db,
        get_app_settings(request),
        action="user.password_change_failed",
        credential_key=credential_key,
        ip_address=ip_address,
    )

    if not verify_password(payload.current_password, user.password_hash):
        add_audit_log(
            db,
            identity=identity,
            action="user.password_change_failed",
            resource_type="user",
            resource_id=user.id,
            reason=credential_key,
            ip_address=ip_address,
            user_agent=request.headers.get("user-agent"),
        )
        await db.commit()
        raise DomainError(
            "invalid_current_password",
            "Mevcut şifreniz doğru değil.",
            status_code=400,
        )

    if verify_password(payload.new_password, user.password_hash):
        raise DomainError(
            "password_unchanged",
            "Yeni şifre mevcut şifreden farklı olmalı.",
            status_code=400,
        )

    user.password_hash = hash_password(payload.new_password)
    await db.execute(
        update(AuthSession)
        .where(
            AuthSession.user_id == user.id,
            AuthSession.id != identity.session_id,
            AuthSession.revoked_at.is_(None),
        )
        .values(revoked_at=datetime.now(UTC))
    )
    add_audit_log(
        db,
        identity=identity,
        action="user.password_changed",
        resource_type="user",
        resource_id=user.id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()


async def _find_logout_session(
    db: AsyncSession,
    settings: Settings,
    *,
    refresh_token: str | None,
    authorization: str | None,
) -> tuple[AuthSession, dict[str, object]] | None:
    candidates: list[tuple[str, str]] = []
    if refresh_token:
        candidates.append((refresh_token, "refresh"))

    bearer_token = _bearer_token(authorization)
    if bearer_token:
        candidates.append((bearer_token, "access"))

    for raw_token, token_type in candidates:
        try:
            claims = decode_token(settings, raw_token, token_type)
            session_id = UUID(str(claims["sid"]))
            user_id = UUID(str(claims["sub"]))
            family = UUID(str(claims["family"]))
        except (DomainError, KeyError, TypeError, ValueError):
            continue

        auth_session = (
            await db.execute(
                select(AuthSession)
                .where(AuthSession.id == session_id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if (
            auth_session is not None
            and auth_session.user_id == user_id
            and auth_session.token_family == family
        ):
            return auth_session, claims

    return None


def _bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, separator, token = authorization.partition(" ")
    if separator and scheme.lower() == "bearer" and token.strip():
        return token.strip()
    return None


def _optional_uuid_claim(claims: dict[str, object], key: str) -> UUID | None:
    value = claims.get(key)
    if not value:
        return None
    try:
        return UUID(str(value))
    except ValueError:
        return None


@router.get("/me", response_model=MeOut)
async def me(identity: CurrentIdentity, db: DbSession) -> MeOut:
    user = (
        await db.execute(
            select(User)
            .where(User.id == identity.user_id)
            .options(selectinload(User.role).selectinload(Role.permissions))
        )
    ).scalar_one()
    return await user_payload(db, user, identity.branch_id)


@router.get("/branches", response_model=AccessibleBranchesOut)
async def accessible_branches(
    identity: CurrentIdentity,
    db: DbSession,
) -> AccessibleBranchesOut:
    if identity.tenant_id is None:
        return AccessibleBranchesOut(
            branches=[],
            current_branch_id=None,
            can_switch=False,
        )

    user = await db.get(User, identity.user_id)
    if user is None or not user.is_active:
        raise DomainError("account_inactive", "Account is inactive", status_code=401)
    if user.tenant_id != identity.tenant_id:
        raise DomainError(
            "invalid_tenant_context",
            "Tenant context is invalid",
            status_code=401,
        )

    predicates = [
        Branch.tenant_id == identity.tenant_id,
        Branch.is_active.is_(True),
    ]
    if not identity.has_all_branch_access:
        # Offer exactly the branches this user may act in — their primary branch
        # plus any granted memberships — so the switcher can never present a
        # branch the API would then refuse.
        predicates.append(Branch.id.in_(identity.accessible_branch_ids))
    branches = (
        await db.execute(
            select(Branch).where(*predicates).order_by(Branch.name, Branch.id)
        )
    ).scalars().all()
    return AccessibleBranchesOut(
        branches=[
            BranchSessionSummary(
                id=branch.id,
                name=branch.name,
                slug=branch.slug,
                timezone=branch.timezone,
                is_active=branch.is_active,
            )
            for branch in branches
        ],
        current_branch_id=identity.branch_id,
        can_switch=user.branch_id is None and len(branches) > 1,
    )


@router.post("/switch-branch", response_model=AuthResponse)
async def switch_branch(
    payload: SwitchBranchRequest,
    request: Request,
    db: DbSession,
    settings: Settings = Depends(get_app_settings),
) -> AuthResponse:
    tokens, user, branch_id = await switch_refresh_token_branch(
        db,
        settings,
        payload.refresh_token,
        payload.branch_id,
    )
    audit_record = add_audit_log(
        db,
        identity=None,
        tenant_id=user.tenant_id,
        branch_id=branch_id,
        action="auth.branch_switched",
        resource_type="user",
        resource_id=user.id,
        new_value={"branch_id": str(branch_id)},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    audit_record.actor_user_id = user.id
    audit_record.actor_role = user.role.code
    await db.commit()
    return AuthResponse(
        **tokens.model_dump(),
        user=await user_payload(db, user, branch_id),
    )


@router.post("/realtime-ticket", response_model=RealtimeTicketOut)
async def create_realtime_ticket(
    identity: CurrentIdentity,
    db: DbSession,
    settings: Settings = Depends(get_app_settings),
) -> RealtimeTicketOut:
    if identity.tenant_id is None:
        raise DomainError(
            "tenant_context_required",
            "Realtime operations require a business context",
            status_code=400,
        )
    nonce = uuid4().hex
    expires_at = utcnow() + timedelta(seconds=60)
    record = RealtimeTicket(
        tenant_id=identity.tenant_id,
        branch_id=identity.branch_id,
        user_id=identity.user_id,
        auth_session_id=identity.session_id,
        nonce_hash=hashlib.sha256(nonce.encode("utf-8")).hexdigest(),
        expires_at=expires_at,
    )
    db.add(record)
    await db.flush()
    ticket = jwt.encode(
        {
            "typ": "realtime_ticket",
            "ticket_id": str(record.id),
            "sub": str(identity.user_id),
            "sid": str(identity.session_id),
            "family": str(identity.token_family),
            "tenant_id": str(identity.tenant_id),
            "branch_id": str(identity.branch_id) if identity.branch_id else None,
            "jti": nonce,
            "iat": utcnow(),
            "nbf": utcnow(),
            "exp": expires_at,
            "iss": "dixora-api",
            "aud": "dixora-realtime",
        },
        settings.jwt_secret.get_secret_value(),
        algorithm=settings.jwt_algorithm,
    )
    await db.commit()
    return RealtimeTicketOut(ticket=ticket)
