"""Locust load profile for Dixora, shaped like a real branch day.

Run against a disposable environment only — it creates orders and payments.

    pip install locust
    locust -f apps/api/loadtest/dixora_load.py --host http://127.0.0.1:8000

Headless, roughly "25 branches x 4 terminals":

    locust -f apps/api/loadtest/dixora_load.py --host http://127.0.0.1:8000 \
        --headless -u 100 -r 10 -t 5m --csv results/25-branches

Terminal mix per branch is about: 1 cashier, 1 kitchen display, 2 waiter
tablets. Scale `-u` as branches x terminals (10 branches = 40, 100 = 400).
Read p95/p99 from the CSV; do not infer capacity from a single run.

Tasks are tagged `read` and `write`. Against any environment whose data you
care about, run `--exclude-tags write` — the write path creates real orders,
payments and stock movements that are awkward to unwind.
"""

from __future__ import annotations

import os
import random
import uuid

from locust import HttpUser, between, tag, task

BUSINESS = os.environ.get("DIXORA_LOAD_BUSINESS", "dixora-lab")
USERNAME = os.environ.get("DIXORA_LOAD_USERNAME", "owner@dixora.test")
PASSWORD = os.environ.get("DIXORA_LOAD_PASSWORD", "DixoraLab!2026")
API = "/api/v1"


class DixoraTerminal(HttpUser):
    """One POS terminal: signs in once, then polls and occasionally orders."""

    # Terminals are hit constantly but not hammered; this mirrors the UI's
    # 5-10s refetch intervals plus human pauses.
    wait_time = between(3, 10)

    def on_start(self) -> None:
        response = self.client.post(
            f"{API}/auth/login",
            json={"business": BUSINESS, "username": USERNAME, "password": PASSWORD},
            name="auth: login",
        )
        if response.status_code != 200:
            self.environment.runner.quit()
            return
        body = response.json()
        self.client.headers.update({"Authorization": f"Bearer {body['access_token']}"})

        tables = self.client.get(f"{API}/tables", name="tables: list").json()
        products = self.client.get(
            f"{API}/catalog/products", name="catalog: products"
        ).json()
        self.tables = [item["id"] for item in tables] if isinstance(tables, list) else []
        self.products = [item["id"] for item in products.get("items", [])]

    @tag("read")
    @task(10)
    def poll_orders(self) -> None:
        self.client.get(f"{API}/orders?limit=25", name="orders: list")

    @tag("read")
    @task(8)
    def poll_tables(self) -> None:
        self.client.get(f"{API}/tables", name="tables: list")

    @tag("read")
    @task(6)
    def poll_kitchen(self) -> None:
        self.client.get(f"{API}/kitchen/tickets", name="kitchen: tickets")

    @tag("read")
    @task(3)
    def read_inventory(self) -> None:
        self.client.get(f"{API}/inventory/items", name="inventory: items")

    @tag("read")
    @task(2)
    def browse_public_menu(self) -> None:
        # Customer-facing QR traffic hits an unauthenticated endpoint.
        self.client.get(
            f"{API}/qr/public/{BUSINESS}/merkez", name="qr: public menu"
        )

    @tag("write")
    @task(1)
    def create_order(self) -> None:
        """The write path, including inventory locking."""
        if not self.tables or not self.products:
            return
        self.client.post(
            f"{API}/orders",
            json={
                "table_id": random.choice(self.tables),
                "items": [
                    {"product_id": random.choice(self.products), "quantity": "1"}
                ],
                "idempotency_key": f"load-{uuid.uuid4().hex}",
                "auto_accept": True,
            },
            name="orders: create",
        )


class ContentionTerminal(HttpUser):
    """Hammers one table/product pair to expose inventory lock contention.

    Deliberately pathological: every user targets the same table and product, so
    they all serialise on the same locked rows. Keep the weight low — at parity
    with `DixoraTerminal` it dominates the run and makes the aggregate
    percentiles meaningless for capacity planning.
    """

    wait_time = between(0.5, 2)
    weight = 1
    # DixoraTerminal is the realistic shape; this class is a correctness probe.
    fixed_count = 5

    def on_start(self) -> None:
        response = self.client.post(
            f"{API}/auth/login",
            json={"business": BUSINESS, "username": USERNAME, "password": PASSWORD},
            name="auth: login",
        )
        if response.status_code != 200:
            self.environment.runner.quit()
            return
        self.client.headers.update(
            {"Authorization": f"Bearer {response.json()['access_token']}"}
        )
        tables = self.client.get(f"{API}/tables", name="tables: list").json()
        products = self.client.get(
            f"{API}/catalog/products", name="catalog: products"
        ).json()
        self.table = tables[0]["id"] if tables else None
        items = products.get("items", [])
        self.product = items[0]["id"] if items else None

    @tag("write")
    @task
    def concurrent_same_stock_order(self) -> None:
        if not self.table or not self.product:
            return
        self.client.post(
            f"{API}/orders",
            json={
                "table_id": self.table,
                "items": [{"product_id": self.product, "quantity": "1"}],
                "idempotency_key": f"contention-{uuid.uuid4().hex}",
                "auto_accept": True,
            },
            name="orders: create (same stock)",
        )
