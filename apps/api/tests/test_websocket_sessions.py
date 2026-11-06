from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest
from fastapi import WebSocket
from sqlalchemy import select

from app.api.websocket import websocket_endpoint
from app.models import AuthSession, Branch, User
from tests.conftest import ApiContext, auth_headers, login


@pytest.mark.parametrize("change", ["logout", "disabled", "role", "branch", "family", "idle"])
async def test_open_socket_rechecks_authorization_before_delivery(
    api: ApiContext, change: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    if change == "idle":
        monkeypatch.setattr("app.api.websocket.REVALIDATE_SECONDS", 0.02)
    session = await login(api, username="cashier@dixora.test")
    ticket_response = await api.client.post(
        "/api/v1/auth/realtime-ticket", headers=auth_headers(session)
    )
    incoming: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
    outgoing: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
    socket = WebSocket(
        {"type": "websocket", "app": api.app, "path": "/api/v1/ws"},
        incoming.get,
        outgoing.put,
    )
    await incoming.put({"type": "websocket.connect"})
    task = asyncio.create_task(websocket_endpoint(socket, ticket=ticket_response.json()["ticket"]))
    try:
        assert (await asyncio.wait_for(outgoing.get(), 3))["type"] == "websocket.accept"
        ready = json.loads((await asyncio.wait_for(outgoing.get(), 3))["text"])
        assert ready["type"] == "connection.ready"
        async with api.database.session_factory() as db:
            user = (
                await db.execute(select(User).where(User.username == "cashier@dixora.test"))
            ).scalar_one()
            auth_session = (
                await db.execute(select(AuthSession).where(AuthSession.user_id == user.id))
            ).scalar_one()
            if change == "disabled":
                user.is_active = False
            elif change == "role":
                user.role.is_active = False
            elif change == "branch":
                branch = await db.get(Branch, user.branch_id)
                assert branch is not None
                branch.is_active = False
            elif change == "family":
                from uuid import uuid4

                auth_session.token_family = uuid4()
            else:
                from app.security import utcnow

                auth_session.revoked_at = utcnow()
            tenant_id, branch_id = user.tenant_id, user.branch_id
            await db.commit()
        if change != "idle":
            await api.app.state.realtime.broadcast(tenant_id, branch_id, {"type": "order.updated"})
        closed = await asyncio.wait_for(outgoing.get(), 3)
        assert closed["type"] == "websocket.close", closed
        assert closed["code"] == 4401
        assert outgoing.empty(), "an event escaped after revocation"
    finally:
        await incoming.put({"type": "websocket.disconnect", "code": 1000})
        await asyncio.wait_for(task, 3)


async def test_realtime_ticket_is_consumed_once(api: ApiContext) -> None:
    session = await login(api)
    response = await api.client.post("/api/v1/auth/realtime-ticket", headers=auth_headers(session))
    ticket = response.json()["ticket"]
    for attempt in range(2):
        incoming: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        outgoing: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        socket = WebSocket(
            {"type": "websocket", "app": api.app, "path": "/api/v1/ws"},
            incoming.get,
            outgoing.put,
        )
        await incoming.put({"type": "websocket.connect"})
        await incoming.put({"type": "websocket.disconnect", "code": 1000})
        await websocket_endpoint(socket, ticket=ticket)
        first = await outgoing.get()
        assert first["type"] == ("websocket.accept" if attempt == 0 else "websocket.close")
