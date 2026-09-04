from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import Settings
from app.errors import DomainError
from app.models import AuthSession, Branch, Role, Tenant, User, UserBranchMembership
from app.models.enums import TenantState
from app.schemas import TokenPair

password_hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=4)


# Tolerance for time claims (iat/nbf/exp).
#
# Without it a token was rejected as "not yet valid" whenever the verifying
# clock read even a fraction of a second behind the issuing one — which happens
# on any NTP correction, and across workers or hosts that are not perfectly in
# step. The failure looked like a random logout. Half a minute is far too small
# to matter against a 15-minute token, and iat is not a security control.
CLOCK_SKEW_LEEWAY = timedelta(seconds=30)


def utcnow() -> datetime:
    return datetime.now(UTC)


def as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


logger = logging.getLogger(__name__)


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return password_hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False
    except Exception:
        # Anything else — an argon2 memory failure, a corrupted parameter — is
        # not a wrong password. Returning False anyway would report it to the
        # user as "invalid credentials" and leave no trace to diagnose, which
        # is exactly how an intermittent infrastructure fault hides.
        logger.exception("auth.password_verify_failed")
        raise


def refresh_jti_hash(jti: str) -> str:
    return hashlib.sha256(jti.encode("utf-8")).hexdigest()


def generate_trusted_device_token() -> str:
    """Return a high-entropy credential suitable for one-time browser delivery."""
    return f"tdv_{secrets.token_urlsafe(32)}"


def trusted_device_token_hash(token: str) -> str:
    """Hash an opaque device credential before persistence or lookup."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _encode_token(
    settings: Settings,
    *,
    user: User,
    session_id: UUID,
    token_type: str,
    jti: str,
    expires_at: datetime,
    branch_id: UUID | None,
    family: UUID,
    remember_me: bool,
) -> str:
    now = utcnow()
    payload: dict[str, Any] = {
        "sub": str(user.id),
        "sid": str(session_id),
        "jti": jti,
        "typ": token_type,
        "iat": now,
        "nbf": now,
        "exp": expires_at,
        "tenant_id": str(user.tenant_id) if user.tenant_id else None,
        "branch_id": str(branch_id) if branch_id else None,
        "role": user.role.code,
        "is_super_admin": user.is_super_admin,
        "family": str(family),
        "remember_me": remember_me,
        "iss": "dixora-api",
        "aud": "dixora-app",
    }
    return jwt.encode(
        payload,
        settings.jwt_secret.get_secret_value(),
        algorithm=settings.jwt_algorithm,
    )


def decode_token(
    settings: Settings, token: str, expected_type: str | None = None
) -> dict[str, Any]:
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret.get_secret_value(),
            algorithms=[settings.jwt_algorithm],
            audience="dixora-app",
            issuer="dixora-api",
            leeway=CLOCK_SKEW_LEEWAY,
        )
    except jwt.ExpiredSignatureError as exc:
        raise DomainError("token_expired", "Token has expired", status_code=401) from exc
    except jwt.PyJWTError as exc:
        # The concrete PyJWT error is the only thing that distinguishes a
        # forged token from a clock or configuration fault.
        logger.warning(
            "auth.token_decode_failed error=%s detail=%s",
            type(exc).__name__,
            exc,
        )
        raise DomainError("invalid_token", "Token is invalid", status_code=401) from exc
    if expected_type and payload.get("typ") != expected_type:
        raise DomainError("invalid_token_type", "Unexpected token type", status_code=401)
    return payload


async def issue_token_pair(
    db: AsyncSession,
    settings: Settings,
    user: User,
    *,
    branch_id: UUID | None,
    device_name: str | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
    remember_me: bool = False,
) -> TokenPair:
    family = uuid4()
    refresh_jti = uuid4().hex
    refresh_lifetime = _refresh_lifetime(settings, remember_me=remember_me)
    refresh_expires = utcnow() + refresh_lifetime
    auth_session = AuthSession(
        tenant_id=user.tenant_id,
        user_id=user.id,
        token_family=family,
        refresh_jti_hash=refresh_jti_hash(refresh_jti),
        expires_at=refresh_expires,
        device_name=device_name,
        ip_address=ip_address,
        user_agent=user_agent,
    )
    db.add(auth_session)
    await db.flush()
    access_expires = utcnow() + timedelta(minutes=settings.access_token_minutes)
    access_token = _encode_token(
        settings,
        user=user,
        session_id=auth_session.id,
        token_type="access",
        jti=uuid4().hex,
        expires_at=access_expires,
        branch_id=branch_id,
        family=family,
        remember_me=remember_me,
    )
    refresh_token = _encode_token(
        settings,
        user=user,
        session_id=auth_session.id,
        token_type="refresh",
        jti=refresh_jti,
        expires_at=refresh_expires,
        branch_id=branch_id,
        family=family,
        remember_me=remember_me,
    )
    return TokenPair(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=settings.access_token_minutes * 60,
        refresh_expires_in=int(refresh_lifetime.total_seconds()),
        remember_me=remember_me,
    )


async def rotate_refresh_token(
    db: AsyncSession,
    settings: Settings,
    raw_token: str,
) -> tuple[TokenPair, User, UUID | None]:
    payload, auth_session, user = await _load_refresh_session(db, settings, raw_token)
    claimed_branch_id = _optional_uuid_claim(payload, "branch_id")
    branch_id = await _resolve_refresh_branch(db, user, claimed_branch_id)
    remember_me = payload.get("remember_me") is True
    tokens = _rotate_session_tokens(
        settings,
        auth_session=auth_session,
        user=user,
        branch_id=branch_id,
        remember_me=remember_me,
        rotate_family=False,
    )
    return tokens, user, branch_id


async def switch_refresh_token_branch(
    db: AsyncSession,
    settings: Settings,
    raw_token: str,
    branch_id: UUID,
) -> tuple[TokenPair, User, UUID]:
    payload, auth_session, user = await _load_refresh_session(db, settings, raw_token)
    if user.tenant_id is None:
        raise DomainError(
            "tenant_context_required",
            "A business context is required",
            status_code=400,
        )
    if user.branch_id is not None:
        # A branch-pinned user may still move between branches they have been
        # granted membership in — that is how one regional manager covers
        # several locations without gaining business-wide access.
        granted = (
            (
                await db.execute(
                    select(UserBranchMembership.branch_id).where(
                        UserBranchMembership.user_id == user.id,
                        UserBranchMembership.tenant_id == user.tenant_id,
                        UserBranchMembership.is_active.is_(True),
                    )
                )
            )
            .scalars()
            .all()
        )
        if branch_id not in {user.branch_id, *granted}:
            raise DomainError(
                "branch_switch_forbidden",
                "This account is restricted to its assigned branches",
                status_code=403,
            )

    selected_branch_id = await _resolve_refresh_branch(
        db,
        user,
        branch_id,
        allow_fallback=False,
        prefer_requested=True,
    )
    assert selected_branch_id is not None
    remember_me = payload.get("remember_me") is True
    tokens = _rotate_session_tokens(
        settings,
        auth_session=auth_session,
        user=user,
        branch_id=selected_branch_id,
        remember_me=remember_me,
        rotate_family=True,
    )
    return tokens, user, selected_branch_id


async def _load_refresh_session(
    db: AsyncSession,
    settings: Settings,
    raw_token: str,
) -> tuple[dict[str, Any], AuthSession, User]:
    payload = decode_token(settings, raw_token, "refresh")
    try:
        session_id = UUID(str(payload["sid"]))
        user_id = UUID(str(payload["sub"]))
        presented_jti = str(payload["jti"])
        family = UUID(str(payload["family"]))
        claimed_tenant_id = _optional_uuid_claim(payload, "tenant_id")
    except (KeyError, TypeError, ValueError) as exc:
        raise DomainError(
            "invalid_token", "Refresh token claims are invalid", status_code=401
        ) from exc

    auth_session = (
        await db.execute(
            select(AuthSession).where(AuthSession.id == session_id).with_for_update()
        )
    ).scalar_one_or_none()
    if (
        auth_session is None
        or auth_session.user_id != user_id
        or auth_session.token_family != family
        or auth_session.revoked_at is not None
        or as_utc(auth_session.expires_at) <= utcnow()
    ):
        raise DomainError("session_revoked", "Session is no longer active", status_code=401)

    if auth_session.refresh_jti_hash != refresh_jti_hash(presented_jti):
        auth_session.revoked_at = utcnow()
        await db.commit()
        raise DomainError(
            "refresh_token_reuse",
            "Refresh token reuse detected; session revoked",
            status_code=401,
        )

    user = (
        await db.execute(
            select(User)
            .where(User.id == user_id)
            .options(selectinload(User.role).selectinload(Role.permissions))
        )
    ).scalar_one_or_none()
    if user is None or not user.is_active:
        auth_session.revoked_at = utcnow()
        raise DomainError("account_inactive", "Account is inactive", status_code=401)
    if auth_session.tenant_id != user.tenant_id or claimed_tenant_id != user.tenant_id:
        auth_session.revoked_at = utcnow()
        raise DomainError(
            "invalid_tenant_context",
            "Tenant context is invalid",
            status_code=401,
        )

    if user.tenant_id is not None:
        tenant = await db.get(Tenant, user.tenant_id)
        if (
            tenant is None
            or not tenant.is_active
            or tenant.state
            in {
                TenantState.PAST_DUE,
                TenantState.SUSPENDED,
                TenantState.CANCELLED,
                TenantState.ARCHIVED,
            }
        ):
            raise DomainError("tenant_inactive", "Business is not active", status_code=403)

    return payload, auth_session, user


async def _resolve_refresh_branch(
    db: AsyncSession,
    user: User,
    requested_branch_id: UUID | None,
    *,
    allow_fallback: bool = True,
    prefer_requested: bool = False,
) -> UUID | None:
    """Pick the branch a refreshed session should carry.

    On login a pinned user always lands on their own branch, so a stale request
    cannot move them. `prefer_requested` is for the explicit switch flow, where
    the caller has already checked the target against the user's granted
    branches; only then does the request win over the primary branch.
    """
    if user.tenant_id is None:
        if requested_branch_id is not None:
            raise DomainError(
                "branch_forbidden", "Branch access is not allowed", status_code=403
            )
        return None

    if prefer_requested and requested_branch_id is not None:
        selected_branch_id: UUID | None = requested_branch_id
    else:
        selected_branch_id = user.branch_id or requested_branch_id
    if selected_branch_id is not None:
        selected_branch_id = (
            await db.execute(
                select(Branch.id).where(
                    Branch.id == selected_branch_id,
                    Branch.tenant_id == user.tenant_id,
                    Branch.is_active.is_(True),
                )
            )
        ).scalar_one_or_none()

    if selected_branch_id is None and allow_fallback and user.branch_id is None:
        selected_branch_id = (
            await db.execute(
                select(Branch.id)
                .where(Branch.tenant_id == user.tenant_id, Branch.is_active.is_(True))
                .order_by(Branch.created_at, Branch.id)
                .limit(1)
            )
        ).scalar_one_or_none()

    if selected_branch_id is None:
        raise DomainError(
            "branch_forbidden", "Branch access is not allowed", status_code=403
        )
    return selected_branch_id


def _rotate_session_tokens(
    settings: Settings,
    *,
    auth_session: AuthSession,
    user: User,
    branch_id: UUID | None,
    remember_me: bool,
    rotate_family: bool,
) -> TokenPair:
    if rotate_family:
        auth_session.token_family = uuid4()
    new_jti = uuid4().hex
    auth_session.refresh_jti_hash = refresh_jti_hash(new_jti)
    access_expires = utcnow() + timedelta(minutes=settings.access_token_minutes)
    refresh_lifetime = _refresh_lifetime(settings, remember_me=remember_me)
    refresh_expires = utcnow() + refresh_lifetime
    auth_session.expires_at = refresh_expires
    access_token = _encode_token(
        settings,
        user=user,
        session_id=auth_session.id,
        token_type="access",
        jti=uuid4().hex,
        expires_at=access_expires,
        branch_id=branch_id,
        family=auth_session.token_family,
        remember_me=remember_me,
    )
    refresh_token = _encode_token(
        settings,
        user=user,
        session_id=auth_session.id,
        token_type="refresh",
        jti=new_jti,
        expires_at=refresh_expires,
        branch_id=branch_id,
        family=auth_session.token_family,
        remember_me=remember_me,
    )
    return TokenPair(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=settings.access_token_minutes * 60,
        refresh_expires_in=int(refresh_lifetime.total_seconds()),
        remember_me=remember_me,
    )


def _optional_uuid_claim(payload: dict[str, Any], key: str) -> UUID | None:
    value = payload.get(key)
    if value is None:
        return None
    try:
        return UUID(str(value))
    except (TypeError, ValueError) as exc:
        raise DomainError(
            "invalid_token", "Refresh token claims are invalid", status_code=401
        ) from exc


def _refresh_lifetime(settings: Settings, *, remember_me: bool) -> timedelta:
    if remember_me:
        return timedelta(days=settings.refresh_token_days)
    return timedelta(hours=settings.session_refresh_token_hours)
