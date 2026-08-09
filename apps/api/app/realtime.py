from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from collections import defaultdict
from typing import TYPE_CHECKING, Protocol
from uuid import UUID

from fastapi import WebSocket

if TYPE_CHECKING:
    from redis.asyncio import Redis
    from redis.asyncio.client import PubSub

logger = logging.getLogger(__name__)

# Per-tenant channel. Workers subscribe only to the tenants they actually serve,
# so one business's events are never carried into a worker that has none of its
# connections — the isolation holds at the transport, not just at delivery.
CHANNEL_PREFIX = "dixora:realtime:tenant:"


def tenant_channel(tenant_id: UUID) -> str:
    return f"{CHANNEL_PREFIX}{tenant_id}"


class RealtimeBroadcaster(Protocol):
    async def connect(
        self, tenant_id: UUID, branch_id: UUID | None, websocket: WebSocket
    ) -> None: ...

    async def disconnect(
        self, tenant_id: UUID, branch_id: UUID | None, websocket: WebSocket
    ) -> None: ...

    async def broadcast(
        self, tenant_id: UUID, branch_id: UUID | None, event: dict[str, object]
    ) -> None: ...


class RealtimeHub:
    """Process-local fan-out.

    Used directly in single-worker deployments and as the per-worker delivery
    layer underneath the Redis hub.
    """

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

    async def has_tenant_connections(self, tenant_id: UUID) -> bool:
        async with self._lock:
            return any(key[0] == tenant_id for key in self._connections)

    async def broadcast(
        self,
        tenant_id: UUID,
        branch_id: UUID | None,
        event: dict[str, object],
    ) -> None:
        async with self._lock:
            targets = list(self._connections.get((tenant_id, branch_id), set()))
            if branch_id is not None:
                # Business-wide listeners (no branch selected) also see branch events.
                targets.extend(self._connections.get((tenant_id, None), set()))
        stale: list[WebSocket] = []
        for websocket in targets:
            try:
                await websocket.send_json(event)
            except Exception:
                stale.append(websocket)
        for websocket in stale:
            await self.disconnect(tenant_id, branch_id, websocket)


class RedisRealtimeHub:
    """Cross-process fan-out over Redis pub/sub.

    Required as soon as the API runs more than one worker: a WebSocket lives in
    exactly one worker, but the request that should notify it may land in any of
    them. Every worker publishes to the tenant's channel and delivers whatever it
    receives to its own sockets, so routing semantics stay identical to the
    single-process hub.
    """

    def __init__(self, redis_url: str, *, poll_timeout: float = 1.0) -> None:
        self._redis_url = redis_url
        self._poll_timeout = poll_timeout
        self._local = RealtimeHub()
        self._redis: Redis | None = None
        self._pubsub: PubSub | None = None
        self._reader: asyncio.Task[None] | None = None
        self._subscribed: set[UUID] = set()
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        from redis.asyncio import Redis

        self._redis = Redis.from_url(self._redis_url, decode_responses=True)
        self._pubsub = self._redis.pubsub(ignore_subscribe_messages=True)
        self._reader = asyncio.create_task(self._read_loop())

    async def stop(self) -> None:
        if self._reader is not None:
            self._reader.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._reader
            self._reader = None
        if self._pubsub is not None:
            with contextlib.suppress(Exception):
                await self._pubsub.aclose()  # type: ignore[no-untyped-call]
            self._pubsub = None
        if self._redis is not None:
            with contextlib.suppress(Exception):
                await self._redis.aclose()
            self._redis = None

    async def connect(
        self, tenant_id: UUID, branch_id: UUID | None, websocket: WebSocket
    ) -> None:
        await self._local.connect(tenant_id, branch_id, websocket)
        async with self._lock:
            if tenant_id not in self._subscribed and self._pubsub is not None:
                await self._pubsub.subscribe(tenant_channel(tenant_id))
                self._subscribed.add(tenant_id)

    async def disconnect(
        self, tenant_id: UUID, branch_id: UUID | None, websocket: WebSocket
    ) -> None:
        await self._local.disconnect(tenant_id, branch_id, websocket)
        # Drop the subscription only once this worker has no sockets left for the
        # tenant, so a busy business never loses events mid-session.
        if await self._local.has_tenant_connections(tenant_id):
            return
        async with self._lock:
            if tenant_id in self._subscribed and self._pubsub is not None:
                with contextlib.suppress(Exception):
                    await self._pubsub.unsubscribe(tenant_channel(tenant_id))
                self._subscribed.discard(tenant_id)

    async def broadcast(
        self, tenant_id: UUID, branch_id: UUID | None, event: dict[str, object]
    ) -> None:
        payload = json.dumps(
            {
                "tenant_id": str(tenant_id),
                "branch_id": str(branch_id) if branch_id else None,
                "event": event,
            }
        )
        if self._redis is None:
            # No transport yet (or Redis down): still serve this worker's own
            # sockets rather than dropping the event entirely.
            await self._local.broadcast(tenant_id, branch_id, event)
            return
        try:
            await self._redis.publish(tenant_channel(tenant_id), payload)
        except Exception:
            logger.warning("realtime.publish_failed", exc_info=True)
            await self._local.broadcast(tenant_id, branch_id, event)

    async def _read_loop(self) -> None:
        while True:
            try:
                # redis-py raises if polled with no active subscription, so idle
                # workers (no connected clients yet) simply wait. Nothing is lost:
                # Redis buffers on the connection from the moment we subscribe.
                if self._pubsub is None or not self._subscribed:
                    await asyncio.sleep(self._poll_timeout)
                    continue
                message = await self._pubsub.get_message(
                    ignore_subscribe_messages=True, timeout=self._poll_timeout
                )
                if message is None or message.get("type") != "message":
                    continue
                await self._dispatch(message["data"])
            except asyncio.CancelledError:
                raise
            except Exception:
                # Never let a bad frame or a dropped Redis connection kill the
                # reader; the next poll re-establishes it.
                logger.warning("realtime.read_failed", exc_info=True)
                await asyncio.sleep(self._poll_timeout)

    async def _dispatch(self, raw: str | bytes) -> None:
        data = json.loads(raw)
        tenant_id = UUID(str(data["tenant_id"]))
        branch_raw = data.get("branch_id")
        branch_id = UUID(str(branch_raw)) if branch_raw else None
        event = data["event"]
        if not isinstance(event, dict):
            return
        await self._local.broadcast(tenant_id, branch_id, event)
