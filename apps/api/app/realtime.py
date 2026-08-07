from __future__ import annotations

import asyncio
from collections import defaultdict
from uuid import UUID

from fastapi import WebSocket


class RealtimeHub:
    """Process-local fan-out; Redis pub/sub can replace this adapter without changing routes."""

    def __init__(self) -> None:
        self._connections: dict[tuple[UUID, UUID | None], set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def connect(
        self,
        tenant_id: UUID,
        branch_id: UUID | None,
        websocket: WebSocket,
    ) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections[(tenant_id, branch_id)].add(websocket)

    async def disconnect(
        self,
        tenant_id: UUID,
        branch_id: UUID | None,
        websocket: WebSocket,
    ) -> None:
        async with self._lock:
            connections = self._connections.get((tenant_id, branch_id))
            if connections:
                connections.discard(websocket)
                if not connections:
                    self._connections.pop((tenant_id, branch_id), None)

    async def broadcast(
        self,
        tenant_id: UUID,
        branch_id: UUID | None,
        event: dict[str, object],
    ) -> None:
        async with self._lock:
            targets = list(self._connections.get((tenant_id, branch_id), set()))
            if branch_id is not None:
                targets.extend(self._connections.get((tenant_id, None), set()))
        stale: list[WebSocket] = []
        for websocket in targets:
            try:
                await websocket.send_json(event)
            except Exception:
                stale.append(websocket)
        for websocket in stale:
            await self.disconnect(tenant_id, branch_id, websocket)
