from __future__ import annotations

import asyncio
import hashlib
from datetime import UTC
from uuid import UUID

import jwt
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.models import AuthSession, RealtimeTicket, Role, Tenant, User
from app.rbac import effective_permission_codes
from app.security import as_utc, decode_token, utcnow
from app.services.branch_access import resolve_accessible_branches
from app.services.subscriptions import tenant_access_blocked

router = APIRouter(tags=["realtime"])
REVALIDATE_SECONDS = 15


@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    ticket: str | None = None,
    token: str | None = None,
) -> None:
    settings = websocket.app.state.settings
    try:
        if ticket:
            claims = jwt.decode(
                ticket,
                settings.jwt_secret.get_secret_value(),
                algorithms=[settings.jwt_algorithm],
                audience="dixora-realtime",
                issuer="dixora-api",
            )
            if claims.get("typ") != "realtime_ticket":
                raise ValueError("wrong ticket type")
            ticket_id = UUID(claims["ticket_id"])
            user_id = UUID(claims["sub"])
            session_id = UUID(claims["sid"])
            token_family = UUID(claims["family"])
            tenant_id = UUID(claims["tenant_id"])
            branch_id = UUID(claims["branch_id"]) if claims.get("branch_id") else None
            nonce_hash = hashlib.sha256(str(claims["jti"]).encode("utf-8")).hexdigest()
        elif token and settings.dev_seed_enabled:
            # Deprecated compatibility for local demo clients only.
            claims = decode_token(settings, token, "access")
            ticket_id = None
            nonce_hash = None
            user_id = UUID(claims["sub"])
            session_id = UUID(claims["sid"])
            token_family = UUID(claims["family"])
            tenant_id = UUID(claims["tenant_id"])
            branch_id = UUID(claims["branch_id"]) if claims.get("branch_id") else None
        else:
            raise ValueError("realtime ticket required")
    except Exception:
        await websocket.close(code=4401)
        return
    async with websocket.app.state.database.session_factory() as db:
        if ticket_id is not None:
            ticket_record = (
                await db.execute(
                    select(RealtimeTicket)
                    .where(
                        RealtimeTicket.id == ticket_id,
                        RealtimeTicket.tenant_id == tenant_id,
                        RealtimeTicket.user_id == user_id,
                        RealtimeTicket.auth_session_id == session_id,
                        RealtimeTicket.branch_id == branch_id,
                        RealtimeTicket.nonce_hash == nonce_hash,
                        RealtimeTicket.used_at.is_(None),
                    )
                    .with_for_update()
                )
            ).scalar_one_or_none()
            if ticket_record is None:
                await websocket.close(code=4401)
                return
            expires_at = ticket_record.expires_at
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=UTC)
            if expires_at <= utcnow():
                await websocket.close(code=4401)
                return
            ticket_record.used_at = utcnow()
        user = (
            await db.execute(
                select(User)
                .where(
                    User.id == user_id,
                    User.tenant_id == tenant_id,
                    User.is_active.is_(True),
                )
                .options(selectinload(User.role).selectinload(Role.permissions))
            )
        ).scalar_one_or_none()
        auth_session = await db.get(AuthSession, session_id)
        tenant = await db.get(Tenant, tenant_id)
        if (
            user is None
            or auth_session is None
            or auth_session.user_id != user.id
            or auth_session.tenant_id != tenant_id
            or auth_session.token_family != token_family
            or auth_session.revoked_at is not None
            or as_utc(auth_session.expires_at) <= utcnow()
            or tenant_access_blocked(tenant)
            or not user.role.is_active
        ):
            await websocket.close(code=4401)
            return
        accessible, all_branches = await resolve_accessible_branches(db, user)
        if (branch_id is None and not all_branches) or (
            branch_id is not None and branch_id not in accessible
        ):
            await websocket.close(code=4403)
            return
        role_snapshot = (user.role_id, effective_permission_codes(user.role))
        if ticket_id is not None:
            await db.commit()

    async def authorized() -> bool:
        # A fresh session avoids identity-map caches hiding account/grant changes.
        async with websocket.app.state.database.session_factory() as check_db:
            current = (
                await check_db.execute(
                    select(User)
                    .where(User.id == user_id, User.tenant_id == tenant_id)
                    .options(selectinload(User.role).selectinload(Role.permissions))
                )
            ).scalar_one_or_none()
            session = await check_db.get(AuthSession, session_id)
            business = await check_db.get(Tenant, tenant_id)
            if (
                current is None
                or not current.is_active
                or not current.role.is_active
                or session is None
                or session.user_id != user_id
                or session.tenant_id != tenant_id
                or session.token_family != token_family
                or session.revoked_at is not None
                or as_utc(session.expires_at) <= utcnow()
                or tenant_access_blocked(business)
                or (current.role_id, effective_permission_codes(current.role)) != role_snapshot
            ):
                return False
            grants, global_access = await resolve_accessible_branches(check_db, current)
            return global_access if branch_id is None else branch_id in grants

    # The delivery layer checks again before every outbound event, including Redis fan-out.
    websocket.state.authorize_realtime = authorized
    hub = websocket.app.state.realtime
    await hub.connect(tenant_id, branch_id, websocket)
    await websocket.send_json(
        {
            "type": "connection.ready",
            "tenant_id": str(tenant_id),
            "branch_id": str(branch_id) if branch_id else None,
            "refetch_required": True,
        }
    )
    try:
        while True:
            try:
                message = await asyncio.wait_for(
                    websocket.receive_json(), timeout=REVALIDATE_SECONDS
                )
            except TimeoutError:
                if not await authorized():
                    await websocket.close(code=4401)
                    break
                continue
            if not await authorized():
                await websocket.close(code=4401)
                break
            if message.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    finally:
        # Any exit path must deregister, otherwise a malformed frame leaks the
        # connection and, under Redis, keeps the tenant subscription alive.
        await hub.disconnect(tenant_id, branch_id, websocket)
