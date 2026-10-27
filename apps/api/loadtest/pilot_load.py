"""150 staff sessions, 900 orders/hour (20% QR), 60 simulated printer agents.

Only loopback hosts and a disposable seed manifest are accepted. Simulated
PRINTED acknowledgements are load traffic, never physical-printer evidence.
"""

from __future__ import annotations

import argparse
import asyncio
import collections
import json
import math
import ssl
import time
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

import httpx

API = "/api/v1"


class Harness:
    def __init__(self, host: str):
        self.host = host
        self.samples: dict[str, list[float]] = collections.defaultdict(list)
        self.errors: collections.Counter[str] = collections.Counter()
        self.clients: list[httpx.AsyncClient] = []
        self.orders: list[str] = []
        self.printed: set[str] = set()
        self.run_id = f"pilot-{uuid4().hex}"
        # Creating 240 independent trust stores on the event loop can stall
        # the load generator itself. Reuse one context for all local clients.
        self.ssl_context = ssl.create_default_context()
        self.measurement_started_at: str | None = None

    def client(self, headers: dict | None = None) -> httpx.AsyncClient:
        client = httpx.AsyncClient(
            base_url=self.host,
            headers=headers,
            timeout=15,
            verify=self.ssl_context,
            trust_env=False,
        )
        self.clients.append(client)
        return client

    async def request(self, client, method, path, *, label, **kwargs):
        started = time.perf_counter()
        try:
            response = await client.request(method, path, **kwargs)
            response.raise_for_status()
            return response.json()
        except (httpx.HTTPError, ValueError) as exc:
            code = (
                str(exc.response.status_code)
                if isinstance(exc, httpx.HTTPStatusError)
                else type(exc).__name__
            )
            self.errors[f"{label}:{code}"] += 1
            raise RuntimeError(f"{label}:{code}") from None
        finally:
            self.samples[label].append((time.perf_counter() - started) * 1000)

    async def login(self, business, staff, password):
        client = self.client()
        payload = {"business": business, "username": staff["username"], "password": password}
        tokens = await self.request(
            client, "POST", API + "/auth/login", label="auth.login", json=payload
        )
        client.headers["Authorization"] = f"Bearer {tokens['access_token']}"
        return {
            **staff,
            "client": client,
            "refresh": tokens["refresh_token"],
            "refresh_at": time.monotonic() + 600,
        }

    async def refresh(self, staff):
        if time.monotonic() < staff["refresh_at"]:
            return
        # Each staff reader owns refresh; its other requests use the current
        # bearer until the refreshed one replaces it (well before expiry).
        tokens = await self.request(
            staff["client"],
            "POST",
            API + "/auth/refresh",
            label="auth.refresh",
            json={"refresh_token": staff["refresh"]},
        )
        staff["client"].headers["Authorization"] = f"Bearer {tokens['access_token']}"
        staff.update(refresh=tokens["refresh_token"], refresh_at=time.monotonic() + 600)

    async def reader(self, staff, until, offset):
        role = staff["role"]
        path = {
            "BUSINESS_OWNER": "/reports/sales-summary",
            "KITCHEN": "/kitchen/tickets",
            "CASHIER": "/shifts/current",
        }.get(role, "/tables")
        await asyncio.sleep(offset)
        while time.monotonic() < until:
            try:
                await self.refresh(staff)
                await self.request(staff["client"], "GET", API + path, label=f"read.{role}")
            except RuntimeError:
                pass
            await asyncio.sleep(5)

    async def producer(self, business, until, index, started):
        cashier = next(s for s in business["sessions"] if s["role"] == "CASHIER")
        client = cashier["client"]
        # 30 branches x one order every 120 seconds = 900/hour, including QR.
        due = started + index * 4
        sequence = index
        guest = self.client()
        while due < until:
            await asyncio.sleep(max(0, due - time.monotonic()))
            key = f"{self.run_id}:{index}:{sequence}"
            try:
                if sequence % 5 == 0:
                    menu_path = f"{API}/qr/public/{business['business']}/{business['branch']}"
                    menu = await self.request(
                        guest,
                        "GET",
                        menu_path,
                        label="qr.menu",
                        params={"table_token": business["table_token"]},
                    )
                    payload = {
                        "table_token": business["table_token"],
                        "session_token": menu["session_token"],
                        "idempotency_key": key,
                        "items": [
                            {"product_id": p["id"], "quantity": "1"} for p in menu["products"]
                        ],
                    }
                    first = await self.request(
                        guest, "POST", menu_path + "/requests", label="qr.create", json=payload
                    )
                    replay = await self.request(
                        guest, "POST", menu_path + "/requests", label="qr.replay", json=payload
                    )
                    assert first["reference"] == replay["reference"]
                    order = await self.request(
                        client,
                        "GET",
                        f"{API}/tables/{business['table_id']}/active-order",
                        label="orders.qr-result",
                    )
                else:
                    payload = {
                        "idempotency_key": key,
                        "auto_accept": True,
                        "items": [{"product_id": p, "quantity": "1"} for p in business["products"]],
                    }
                    order = await self.request(
                        client, "POST", API + "/orders", label="orders.create", json=payload
                    )
                    replay = await self.request(
                        client, "POST", API + "/orders", label="orders.replay", json=payload
                    )
                    assert order["id"] == replay["id"]
                assert order["tenant_id"] == business["tenant_id"]
                self.orders.append(order["id"])
                payment = {
                    "method": "CASH",
                    "amount": order["total"],
                    "idempotency_key": f"{self.run_id}:pay:{order['id']}",
                }
                path = f"{API}/orders/{order['id']}/payments"
                first = await self.request(
                    client, "POST", path, label="payment.create", json=payment
                )
                replay = await self.request(
                    client, "POST", path, label="payment.replay", json=payment
                )
                assert first["id"] == replay["id"]
                if order.get("table_session_id"):
                    table = await self.request(
                        client, "GET", f"{API}/tables/{business['table_id']}", label="table.read"
                    )
                    await self.request(
                        client,
                        "POST",
                        f"{API}/tables/{business['table_id']}/sessions/{order['table_session_id']}/close",
                        label="table.close",
                        json={"expected_table_version": table["version"]},
                    )
            except (RuntimeError, KeyError, AssertionError) as exc:
                self.errors[f"scenario:{type(exc).__name__}"] += 1
            sequence += 1
            due += 120

    async def printer(self, printer, until):
        client = self.client({"X-Print-Bridge-Token": printer["token"]})
        next_heartbeat = 0.0
        while time.monotonic() < until:
            try:
                if time.monotonic() >= next_heartbeat:
                    await self.request(
                        client,
                        "POST",
                        API + "/printing/bridge/heartbeat",
                        label="printer.heartbeat",
                        json={
                            "platform": "linux",
                            "version": "loadtest-simulation",
                            "printers": [printer["code"]],
                        },
                    )
                    next_heartbeat = time.monotonic() + 20
                job = await self.request(
                    client, "POST", API + "/printing/bridge/claim", label="printer.claim"
                )
                if job:
                    if job["id"] in self.printed:
                        self.errors["consistency:duplicate_simulated_dispatch"] += 1
                    self.printed.add(job["id"])
                    await asyncio.sleep(0.1)
                    for status in ("SENT", "PRINTED", "PRINTED"):
                        await self.request(
                            client,
                            "PATCH",
                            f"{API}/printing/bridge/jobs/{job['id']}",
                            label=f"printer.{status}",
                            headers={
                                "Idempotency-Key": (
                                    f"{self.run_id}:{job['id']}:{job['attempt_count']}:{status}"
                                )
                            },
                            json={"status": status, "attempt_count": job["attempt_count"]},
                        )
            except RuntimeError:
                pass
            await asyncio.sleep(2)

    def summary(self, seconds, businesses):
        def percentile(values, q):
            ordered = sorted(values)
            return round(ordered[max(0, math.ceil(len(ordered) * q) - 1)], 2)

        return {
            "run_id": self.run_id,
            "measurement_started_at": self.measurement_started_at,
            "measurement_finished_at": datetime.now(UTC).isoformat(),
            "duration_seconds": seconds,
            "businesses": businesses,
            "staff_sessions": businesses * 5,
            "simulated_printers": businesses * 2,
            "target_orders_per_hour": businesses * 30,
            "completed_order_ids": self.orders,
            "simulated_print_jobs": len(self.printed),
            "errors": dict(self.errors),
            "latency_ms": {
                key: {
                    "count": len(values),
                    "p50": percentile(values, 0.5),
                    "p95": percentile(values, 0.95),
                    "p99": percentile(values, 0.99),
                }
                for key, values in self.samples.items()
            },
            "capacity_validated": False,
        }


async def run(args):
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    businesses = manifest["businesses"]
    if not manifest.get("disposable") or len(businesses) != args.businesses:
        raise ValueError("Manifest must match the requested disposable business count")
    if len({b["tenant_id"] for b in businesses}) != len(businesses):
        raise ValueError(
            "Distinct tenants are required; duplicated credentials do not simulate branches"
        )
    if any(len(b["staff"]) != 5 or len(b["printers"]) != 2 for b in businesses):
        raise ValueError("Each business needs 5 distinct staff accounts and 2 printer agents")
    harness = Harness(args.host)
    try:
        for business in businesses:
            business["sessions"] = await asyncio.gather(
                *[
                    harness.login(business["business"], staff, manifest["password"])
                    for staff in business["staff"]
                ]
            )
            cashier = next(s for s in business["sessions"] if s["role"] == "CASHIER")
            existing = await harness.request(
                cashier["client"],
                "GET",
                API + "/shifts/current",
                label="warmup.shift",
            )
            if existing is None:
                await harness.request(
                    cashier["client"],
                    "POST",
                    API + "/shifts/open",
                    label="warmup.shift-open",
                    json={"username": cashier["username"], "pin": "1357", "opening_cash": "0.00"},
                )
        started = time.monotonic()
        harness.measurement_started_at = datetime.now(UTC).isoformat()
        until = started + args.seconds
        tasks = []
        for index, business in enumerate(businesses):
            tasks.append(harness.producer(business, until, index, started))
            tasks.extend(
                harness.reader(staff, until, index * 0.02) for staff in business["sessions"]
            )
            tasks.extend(harness.printer(printer, until + 5) for printer in business["printers"])
        outcomes = await asyncio.gather(*tasks, return_exceptions=True)
        harness.errors["task_failures"] += sum(
            isinstance(outcome, BaseException) for outcome in outcomes
        )
        if harness.errors["task_failures"] == 0:
            del harness.errors["task_failures"]
        args.output.write_text(
            json.dumps(harness.summary(args.seconds, len(businesses)), indent=2), encoding="utf-8"
        )
        return int(bool(harness.errors))
    finally:
        await asyncio.gather(*(client.aclose() for client in harness.clients))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="http://127.0.0.1:18000")
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--businesses", type=int, default=30)
    parser.add_argument("--seconds", type=int, default=3600)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if urlsplit(args.host).hostname not in {"127.0.0.1", "localhost", "::1"} or args.seconds < 1:
        parser.error("Only loopback disposable test targets and a positive duration are allowed")
    raise SystemExit(asyncio.run(run(args)))
