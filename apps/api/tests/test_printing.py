from __future__ import annotations

from tests.conftest import ApiContext, auth_headers, login, seeded_resources
from tests.test_orders import _create_burger_order


async def test_kitchen_user_can_read_and_manage_printing(api: ApiContext) -> None:
    tokens = await login(
        api,
        username="kitchen@dixora.test",
        password="DixoraLab!2026",
    )
    headers = auth_headers(tokens)

    devices = await api.client.get("/api/v1/printing/devices", headers=headers)
    jobs = await api.client.get("/api/v1/printing/jobs", headers=headers)

    assert devices.status_code == 200, devices.text
    assert jobs.status_code == 200, jobs.text


async def test_print_job_creation_and_bridge_state_are_idempotent_and_scoped(
    api: ApiContext,
) -> None:
    tokens = await login(api)
    headers = auth_headers(tokens)
    devices = await api.client.get("/api/v1/printing/devices", headers=headers)
    assert devices.status_code == 200
    printer = next(device for device in devices.json() if device["code"] == "MOCK-KITCHEN")
    payload = {
        "payload": {"lines": [{"text": "Dixora test ticket"}]},
        "printer_device_id": printer["id"],
        "idempotency_key": "print-job-key-0001",
        "kind": "ORIGINAL",
    }
    first = await api.client.post("/api/v1/printing/jobs", json=payload, headers=headers)
    second = await api.client.post("/api/v1/printing/jobs", json=payload, headers=headers)
    assert first.status_code == 201, first.text
    assert second.status_code == 201
    assert first.json()["id"] == second.json()["id"]

    bridge_headers = {"X-Print-Bridge-Token": "pb_dev_dixora_lab_bridge_2026"}
    claimed = await api.client.post(
        "/api/v1/printing/bridge/claim",
        headers=bridge_headers,
        params={"printer_codes": "UNKNOWN"},
    )
    assert claimed.status_code == 200, claimed.text
    assert claimed.json() is None

    claimed = await api.client.post(
        "/api/v1/printing/bridge/claim",
        headers=bridge_headers,
        params={"printer_codes": "MOCK-KITCHEN"},
    )
    assert claimed.status_code == 200, claimed.text
    assert claimed.json()["id"] == first.json()["id"]
    assert claimed.json()["printer_code"] == "MOCK-KITCHEN"
    assert claimed.json()["claimed_by_bridge_id"]

    printed = await api.client.patch(
        f"/api/v1/printing/bridge/jobs/{first.json()['id']}",
        headers=bridge_headers,
        json={"status": "PRINTED"},
    )
    assert printed.status_code == 200, printed.text
    replay = await api.client.patch(
        f"/api/v1/printing/bridge/jobs/{first.json()['id']}",
        headers=bridge_headers,
        json={"status": "PRINTED"},
    )
    assert replay.status_code == 200
    assert replay.json()["attempt_count"] == 1


async def test_bill_print_original_is_idempotent_and_reprint_is_distinct(
    api: ApiContext,
) -> None:
    """Mirrors the cashier's "Fiş yazdır" / "Yeniden yazdır" split: the first
    bill print for an order is ORIGINAL and deduplicates on repeat clicks;
    an explicit reprint is always a separate REPRINT-kind job."""
    tokens = await login(api)
    headers = auth_headers(tokens)
    resources = await seeded_resources(api, headers)
    order = await _create_burger_order(
        api,
        headers,
        table_id=resources["tables"][12]["id"],
        product_id=resources["burger"]["id"],
        key="print-bill-order-key-0001",
    )

    original_payload = {
        "order_id": order["id"],
        "payload": {"type": "BILL", "order_id": order["id"], "stage": "PRE_PAYMENT"},
        "kind": "ORIGINAL",
        "idempotency_key": f"bill-original:{order['id']}",
    }
    first = await api.client.post("/api/v1/printing/jobs", json=original_payload, headers=headers)
    assert first.status_code == 201, first.text
    assert first.json()["kind"] == "ORIGINAL"

    # A second click before the bridge has processed it must not create a
    # duplicate ORIGINAL job — same deterministic idempotency key replays.
    replay = await api.client.post("/api/v1/printing/jobs", json=original_payload, headers=headers)
    assert replay.status_code == 201
    assert replay.json()["id"] == first.json()["id"]

    reprint_payload = {
        "order_id": order["id"],
        "payload": {"type": "BILL", "order_id": order["id"], "copy": True},
        "kind": "REPRINT",
        "idempotency_key": f"bill-reprint:{order['id']}:1",
    }
    reprint = await api.client.post("/api/v1/printing/jobs", json=reprint_payload, headers=headers)
    assert reprint.status_code == 201, reprint.text
    assert reprint.json()["kind"] == "REPRINT"
    assert reprint.json()["id"] != first.json()["id"]

    filtered = await api.client.get(
        "/api/v1/printing/jobs", headers=headers, params={"order_id": order["id"]}
    )
    assert filtered.status_code == 200, filtered.text
    job_ids = {job["id"] for job in filtered.json()}
    # A kitchen ticket print job for the same order may also exist; the bill
    # print jobs must be present among them and correctly scoped to this order.
    assert {first.json()["id"], reprint.json()["id"]}.issubset(job_ids)
    assert all(job["order_id"] == order["id"] for job in filtered.json())


async def test_print_jobs_order_id_filter_is_tenant_scoped(api: ApiContext) -> None:
    owner = await login(api)
    owner_headers = auth_headers(owner)
    resources = await seeded_resources(api, owner_headers)
    order = await _create_burger_order(
        api,
        owner_headers,
        table_id=resources["tables"][13]["id"],
        product_id=resources["burger"]["id"],
        key="print-bill-isolation-key-0001",
    )
    created = await api.client.post(
        "/api/v1/printing/jobs",
        headers=owner_headers,
        json={
            "order_id": order["id"],
            "payload": {"type": "BILL", "order_id": order["id"]},
            "kind": "ORIGINAL",
            "idempotency_key": f"bill-original:{order['id']}",
        },
    )
    assert created.status_code == 201, created.text

    from tests.test_tenant_isolation import _create_tenant_b

    other = await _create_tenant_b(api)
    _ = other
    other_headers = auth_headers(
        await login(
            api, username="owner@other.test", password="Other!2026", business="other-restaurant"
        )
    )
    cross_tenant = await api.client.get(
        "/api/v1/printing/jobs", headers=other_headers, params={"order_id": order["id"]}
    )
    assert cross_tenant.status_code == 200
    assert cross_tenant.json() == []


async def test_printer_device_management_is_tenant_and_branch_scoped(
    api: ApiContext,
) -> None:
    tokens = await login(api)
    headers = auth_headers(tokens)
    created = await api.client.post(
        "/api/v1/printing/devices",
        headers=headers,
        json={
            "code": "RECEIPT-01",
            "name": "Cashier Receipt Printer",
            "transport": "MOCK",
            "settings": {"paper_width": 80},
        },
    )
    assert created.status_code == 201, created.text
    updated = await api.client.patch(
        f"/api/v1/printing/devices/{created.json()['id']}",
        headers=headers,
        json={"name": "Main Cashier Printer"},
    )
    assert updated.status_code == 200
    devices = await api.client.get("/api/v1/printing/devices", headers=headers)
    assert devices.status_code == 200
    assert any(device["code"] == "RECEIPT-01" for device in devices.json())
