from __future__ import annotations

import asyncio
import contextlib
import json
from uuid import uuid4

from app.realtime import RealtimeHub, RedisRealtimeHub, tenant_channel


class FakeSocket:
    """Minimal stand-in for a connected WebSocket."""

    def __init__(self) -> None:
        self.sent: list[dict[str, object]] = []

    async def accept(self) -> None:
        return None

    async def send_json(self, payload: dict[str, object]) -> None:
        self.sent.append(payload)


async def test_events_never_cross_tenants() -> None:
    hub = RealtimeHub()
    tenant_a, tenant_b = uuid4(), uuid4()
    branch = uuid4()
    socket_a, socket_b = FakeSocket(), FakeSocket()

    await hub.connect(tenant_a, branch, socket_a)  # type: ignore[arg-type]
    await hub.connect(tenant_b, branch, socket_b)  # type: ignore[arg-type]

    await hub.broadcast(tenant_a, branch, {"type": "order.updated"})

    assert len(socket_a.sent) == 1
    assert socket_b.sent == [], "another business received an event"


async def test_events_never_cross_branches() -> None:
    hub = RealtimeHub()
    tenant = uuid4()
    branch_a, branch_b = uuid4(), uuid4()
    socket_a, socket_b = FakeSocket(), FakeSocket()

    await hub.connect(tenant, branch_a, socket_a)  # type: ignore[arg-type]
    await hub.connect(tenant, branch_b, socket_b)  # type: ignore[arg-type]

    await hub.broadcast(tenant, branch_a, {"type": "order.updated"})

    assert len(socket_a.sent) == 1
    assert socket_b.sent == [], "another branch received an event"


async def test_business_wide_listener_sees_branch_events() -> None:
    """An owner watching the whole business still receives per-branch events."""
    hub = RealtimeHub()
    tenant = uuid4()
    branch = uuid4()
    branch_socket, business_socket = FakeSocket(), FakeSocket()

    await hub.connect(tenant, branch, branch_socket)  # type: ignore[arg-type]
    await hub.connect(tenant, None, business_socket)  # type: ignore[arg-type]

    await hub.broadcast(tenant, branch, {"type": "order.updated"})

    assert len(branch_socket.sent) == 1
    assert len(business_socket.sent) == 1


async def test_redis_hub_publishes_to_a_tenant_scoped_channel() -> None:
    """The channel name itself carries the tenant, so workers never over-subscribe."""
    published: list[tuple[str, str]] = []

    class FakeRedis:
        async def publish(self, channel: str, payload: str) -> None:
            published.append((channel, payload))

    hub = RedisRealtimeHub("redis://unused")
    hub._redis = FakeRedis()  # type: ignore[assignment]

    tenant, branch = uuid4(), uuid4()
    await hub.broadcast(tenant, branch, {"type": "order.updated"})

    assert len(published) == 1
    channel, payload = published[0]
    assert channel == tenant_channel(tenant)
    body = json.loads(payload)
    assert body["tenant_id"] == str(tenant)
    assert body["branch_id"] == str(branch)
    assert body["event"] == {"type": "order.updated"}


async def test_redis_hub_delivers_received_events_to_local_sockets() -> None:
    """A message published by another worker reaches this worker's sockets."""
    hub = RedisRealtimeHub("redis://unused")
    tenant, branch = uuid4(), uuid4()
    socket = FakeSocket()
    await hub._local.connect(tenant, branch, socket)  # type: ignore[arg-type]

    await hub._dispatch(
        json.dumps(
            {
                "tenant_id": str(tenant),
                "branch_id": str(branch),
                "event": {"type": "order.updated", "order_id": "abc"},
            }
        )
    )

    assert socket.sent == [{"type": "order.updated", "order_id": "abc"}]


async def test_reader_does_not_poll_before_any_subscription() -> None:
    """redis-py raises if polled with no subscription, so an idle worker must wait.

    Regression test: the reader used to poll immediately on startup and spammed
    "pubsub connection not set" errors until the first client connected.
    """
    polled = False

    class ExplodingPubSub:
        async def get_message(self, **_: object) -> None:
            nonlocal polled
            polled = True
            raise RuntimeError("pubsub connection not set")

    hub = RedisRealtimeHub("redis://unused", poll_timeout=0.01)
    hub._pubsub = ExplodingPubSub()  # type: ignore[assignment]

    task = asyncio.create_task(hub._read_loop())
    await asyncio.sleep(0.05)
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task

    assert polled is False, "reader polled Redis with no active subscription"


async def test_redis_hub_falls_back_to_local_delivery_when_redis_is_down() -> None:
    """A Redis outage must not silently swallow this worker's own events."""

    class BrokenRedis:
        async def publish(self, channel: str, payload: str) -> None:
            raise ConnectionError("redis is down")

    hub = RedisRealtimeHub("redis://unused")
    hub._redis = BrokenRedis()  # type: ignore[assignment]
    tenant, branch = uuid4(), uuid4()
    socket = FakeSocket()
    await hub._local.connect(tenant, branch, socket)  # type: ignore[arg-type]

    await hub.broadcast(tenant, branch, {"type": "order.updated"})

    assert socket.sent == [{"type": "order.updated"}]
