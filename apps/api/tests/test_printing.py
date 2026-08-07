from __future__ import annotations

from tests.conftest import ApiContext, auth_headers, login


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
