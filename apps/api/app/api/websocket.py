from __future__ import annotations

import hashlib
from datetime import UTC
from uuid import UUID

import jwt
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from app.models import AuthSession, RealtimeTicket, Tenant, User
from app.security import as_utc, decode_token, utcnow

router = APIRouter(tags=["realtime"])


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
                select(User).where(
                    User.id == user_id,
                    User.tenant_id == tenant_id,
                    User.is_active.is_(True),
                )
            )
        ).scalar_one_or_none()
        auth_session = await db.get(AuthSession, session_id)
        tenant = await db.get(Tenant, tenant_id)
        if (
            user is None
            or auth_session is None
            or auth_session.user_id != user.id
            or auth_session.token_family != token_family
            or auth_session.revoked_at is not None
            or as_utc(auth_session.expires_at) <= utcnow()
            or tenant is None
            or not tenant.is_active
        ):
            await websocket.close(code=4401)
            return
        if ticket_id is not None:
            await db.commit()
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
            message = await websocket.receive_json()
            if message.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    finally:
        # Any exit path must deregister, otherwise a malformed frame leaks the
        # connection and, under Redis, keeps the tenant subscription alive.
        await hub.disconnect(tenant_id, branch_id, websocket)
