from __future__ import annotations

from decimal import Decimal
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from sqlalchemy import func, select

from app.models import Branch, Order, Payment, PrintJob
from tests.conftest import ApiContext, auth_headers, login, seeded_resources


async def _setup(api: ApiContext) -> tuple[dict, dict]:
    headers = auth_headers(await login(api))
    resources = await seeded_resources(api, headers)
    return headers, {
        "table_id": resources["tables"][0]["id"],
        "items": [{"product_id": resources["burger"]["id"], "quantity": "1"}],
        "idempotency_key": "reliability-order-0001",
        "auto_accept": False,
    }


async def test_order_replay_rejects_changed_content_and_does_not_duplicate(api: ApiContext) -> None:
    headers, payload = await _setup(api)
    first = await api.client.post("/api/v1/orders", headers=headers, json=payload)
    assert first.status_code == 201, first.text
    again = await api.client.post("/api/v1/orders", headers=headers, json=payload)
    assert again.json()["id"] == first.json()["id"]
    changed = {**payload, "items": [{**payload["items"][0], "quantity": "2"}]}
    conflict = await api.client.post("/api/v1/orders", headers=headers, json=changed)
    assert conflict.status_code == 409, conflict.text
    assert conflict.json()["error"]["code"] == "idempotency_conflict"


async def test_post_order_replays_the_append_even_after_the_account_is_paid(
    api: ApiContext,
) -> None:
    headers, payload = await _setup(api)
    first = await api.client.post("/api/v1/orders", headers=headers, json=payload)
    appended = {**payload, "idempotency_key": "reliability-append-0001"}
    response = await api.client.post("/api/v1/orders", headers=headers, json=appended)
    assert response.status_code == 201, response.text
    assert response.json()["id"] == first.json()["id"]
    paid = await api.client.post(
        f"/api/v1/orders/{first.json()['id']}/payments",
        headers=headers,
        json={
            "method": "CASH",
            "amount": response.json()["total"],
            "idempotency_key": "reliability-settle-0001",
        },
    )
    assert paid.status_code == 201, paid.text
    replay = await api.client.post("/api/v1/orders", headers=headers, json=appended)
    assert replay.status_code == 201, replay.text
    assert replay.json()["id"] == first.json()["id"]
    async with api.database.session_factory() as db:
        assert (await db.execute(select(func.count(Order.id)))).scalar_one() == 1


@pytest.mark.parametrize("resource", ["orders", "printing/jobs"])
async def test_replay_does_not_return_another_branch_record(api: ApiContext, resource: str) -> None:
    headers, order_payload = await _setup(api)
    payload = (
        order_payload
        if resource == "orders"
        else {
            "payload": {"lines": []},
            "idempotency_key": "reliability-print-0001",
        }
    )
    created = await api.client.post(f"/api/v1/{resource}", headers=headers, json=payload)
    assert created.status_code == 201, created.text
    async with api.database.session_factory() as db:
        model = Order if resource == "orders" else PrintJob
        record = await db.get(model, UUID(created.json()["id"]))
        assert record is not None
        other = Branch(tenant_id=record.tenant_id, name="Other", slug="replay-other")
        db.add(other)
        await db.flush()
        record.branch_id = other.id
        await db.commit()
    cashier = auth_headers(await login(api, username="cashier@dixora.test"))
    replay = await api.client.post(f"/api/v1/{resource}", headers=cashier, json=payload)
    assert replay.status_code == 404, replay.text


@pytest.mark.parametrize("change", ["amount", "method", "reference", "order"])
async def test_payment_key_is_bound_to_order_and_content(api: ApiContext, change: str) -> None:
    headers, payload = await _setup(api)
    first = await api.client.post("/api/v1/orders", headers=headers, json=payload)
    order_id = first.json()["id"]
    payment = {
        "method": "CASH",
        "amount": "1.00",
        "reference": None,
        "idempotency_key": "reliability-payment-0001",
    }
    path = f"/api/v1/orders/{order_id}/payments"
    paid = await api.client.post(path, headers=headers, json=payment)
    assert paid.status_code == 201, paid.text
    replay = await api.client.post(path, headers=headers, json=payment)
    assert replay.json()["id"] == paid.json()["id"]
    if change == "order":
        another = await api.client.post(
            "/api/v1/orders",
            headers=headers,
            json={
                **payload,
                "table_id": None,
                "idempotency_key": "reliability-order-0002",
            },
        )
        path = f"/api/v1/orders/{another.json()['id']}/payments"
    else:
        payment[change] = {"amount": "2.00", "method": "CARD", "reference": "changed"}[change]
    rejected = await api.client.post(path, headers=headers, json=payment)
    assert rejected.status_code == 409, rejected.text
    async with api.database.session_factory() as db:
        assert (await db.execute(select(func.count(Payment.id)))).scalar_one() == 1


async def test_legacy_service_settings_do_not_charge_new_orders_or_rewrite_history(
    api: ApiContext,
) -> None:
    headers, payload = await _setup(api)
    async with api.database.session_factory() as db:
        branch = (await db.execute(select(Branch))).scalars().first()
        assert branch is not None
        branch.service_charge_enabled = True
        branch.service_charge_value = Decimal("10.00")
        await db.commit()
    created = await api.client.post("/api/v1/orders", headers=headers, json=payload)
    assert created.status_code == 201, created.text
    assert Decimal(created.json()["service_charge_amount"]) == 0
    async with api.database.session_factory() as db:
        order = await db.get(Order, UUID(created.json()["id"]))
        assert order is not None
        order.service_charge_type = "PERCENTAGE"
        order.service_charge_value = Decimal("10.00")
        order.service_charge_amount = Decimal("36.00")
        order.total = Decimal("396.00")
        await db.commit()
    read = await api.client.get(f"/api/v1/orders/{created.json()['id']}", headers=headers)
    assert read.json()["total"] == "396.00"
    assert read.json()["service_charge_amount"] == "36.00"


@pytest.mark.parametrize("dependency", ["database", "media_storage"])
async def test_readiness_detects_dependency_failure_but_liveness_stays_healthy(
    api: ApiContext,
    dependency: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(getattr(api.app.state, dependency), "ping", AsyncMock(return_value=False))
    response = await api.client.get("/ready")
    assert response.status_code == 503
    assert response.json()["status"] == "not_ready"
    assert (await api.client.get("/health")).status_code == 200


async def test_qr_replay_is_bound_to_the_authenticated_table_context(api: ApiContext) -> None:
    headers, _ = await _setup(api)
    resources = await seeded_resources(api, headers)
    first, second = resources["tables"][:2]
    path = "/api/v1/qr/public/dixora-lab/merkez"
    menu = await api.client.get(path, params={"table_token": first["qr_token"]})
    payload = {
        "table_token": first["qr_token"],
        "session_token": menu.json()["session_token"],
        "idempotency_key": "reliability-qr-table-0001",
        "items": [{"product_id": menu.json()["products"][0]["id"], "quantity": "1"}],
    }
    created = await api.client.post(path + "/requests", json=payload)
    assert created.status_code == 201, created.text
    changed = await api.client.post(
        path + "/requests",
        json={
            **payload,
            "items": [{**payload["items"][0], "quantity": "2"}],
        },
    )
    assert changed.status_code == 409, changed.text
    menu2 = await api.client.get(path, params={"table_token": second["qr_token"]})
    other = await api.client.post(
        path + "/requests",
        json={
            **payload,
            "table_token": second["qr_token"],
            "session_token": menu2.json()["session_token"],
        },
    )
    assert other.status_code == 404, other.text


async def test_frontend_reporting_requires_auth_and_rejects_arbitrary_customer_content(
    api: ApiContext,
) -> None:
    path = "/api/v1/diagnostics/frontend-errors"
    payload = {"kind": "react_boundary", "screen": "cashier", "digest": "safe-123"}
    assert (await api.client.post(path, json=payload)).status_code == 401
    headers = auth_headers(await login(api))
    accepted = await api.client.post(path, headers=headers, json=payload)
    assert accepted.status_code == 202, accepted.text
    rejected = await api.client.post(
        path,
        headers=headers,
        json={
            **payload,
            "message": "customer name, card or password must not be accepted",
        },
    )
    assert rejected.status_code == 422, rejected.text


async def test_print_queue_health_is_private_and_request_ids_cannot_carry_customer_text(
    api: ApiContext,
) -> None:
    assert (await api.client.get("/api/v1/printing/health")).status_code == 401
    headers = auth_headers(await login(api))
    report = await api.client.get("/api/v1/printing/health", headers=headers)
    assert report.status_code == 200, report.text
    assert report.json()["configured_bridges"] == 1
    health = await api.client.get("/health", headers={"X-Request-ID": "private@example.test"})
    value = health.headers["X-Request-ID"]
    assert value != "private@example.test" and len(value) == 32


async def test_new_printer_configuration_recovers_only_unattempted_station_jobs(
    api: ApiContext,
) -> None:
    from app.models import PrinterDevice

    headers, payload = await _setup(api)
    async with api.database.session_factory() as db:
        device = (
            await db.execute(select(PrinterDevice).where(PrinterDevice.code == "MOCK-KITCHEN"))
        ).scalar_one()
        device.is_active = False
        await db.commit()
    created = await api.client.post(
        "/api/v1/orders", headers=headers, json={**payload, "auto_accept": True}
    )
    assert created.status_code == 201, created.text
    async with api.database.session_factory() as db:
        job = (
            await db.execute(
                select(PrintJob).where(PrintJob.order_id == UUID(created.json()["id"]))
            )
        ).scalar_one()
        assert job.printer_device_id is None
        original_id = job.id
        device = (
            await db.execute(select(PrinterDevice).where(PrinterDevice.code == "MOCK-KITCHEN"))
        ).scalar_one()
        device.is_active = True
        await db.commit()
    claimed = await api.client.post(
        "/api/v1/printing/bridge/claim",
        headers={
            "X-Print-Bridge-Token": "pb_dev_dixora_lab_bridge_2026",
        },
    )
    assert claimed.status_code == 200, claimed.text
    assert claimed.json()["id"] == str(original_id)
    assert claimed.json()["attempt_count"] == 1
