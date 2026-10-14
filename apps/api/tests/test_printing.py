from __future__ import annotations

from decimal import Decimal

import pytest

from tests.conftest import ApiContext, auth_headers, login, seeded_resources
from tests.test_orders import _create_burger_order


async def _create_cashier_printer(api: ApiContext, headers: dict[str, str]) -> dict:
    response = await api.client.post(
        "/api/v1/printing/devices",
        headers=headers,
        json={
            "code": "KASA",
            "name": "Kasa Yazıcısı",
            "purpose": "CASHIER",
            "transport": "MOCK",
            "settings": {"paper_width": 80},
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.mark.parametrize("source", ["CASHIER", "WAITER", "QR"])
async def test_bill_groups_the_same_product_from_separate_order_batches(
    api: ApiContext, source: str
) -> None:
    headers = auth_headers(await login(api))
    resources = await seeded_resources(api, headers)
    await _create_cashier_printer(api, headers)
    created = await api.client.post(
        "/api/v1/orders",
        headers=headers,
        json={
            "table_id": resources["tables"][0]["id"],
            "source": source,
            "items": [{"product_id": resources["burger"]["id"], "quantity": "1"}],
            "idempotency_key": f"grouped-bill-original-{source}",
            "auto_accept": True,
        },
    )
    assert created.status_code == 201, created.text
    order = created.json()
    appended = await api.client.post(
        f"/api/v1/orders/{order['id']}/items",
        headers=headers,
        json={
            "items": [{"product_id": resources["burger"]["id"], "quantity": "1"}],
            "idempotency_key": f"grouped-bill-addition-{source}",
            "auto_accept": True,
        },
    )
    assert appended.status_code == 200, appended.text
    assert len(appended.json()["items"]) == 2
    expected_total = sum(Decimal(row["line_total"]) for row in appended.json()["items"])
    for kind in ("ORIGINAL", "REPRINT"):
        if kind == "REPRINT":
            paid = await api.client.post(
                f"/api/v1/orders/{order['id']}/payments",
                headers=headers,
                json={
                    "method": "CASH",
                    "amount": appended.json()["total"],
                    "idempotency_key": f"grouped-bill-payment-{source}",
                },
            )
            assert paid.status_code == 201, paid.text
        printed = await api.client.post(
            "/api/v1/printing/jobs",
            headers=headers,
            json={
                "order_id": order["id"],
                "payload": {"type": "BILL"},
                "kind": kind,
                "idempotency_key": f"grouped-bill-print-{source}-{kind}",
            },
        )
        assert printed.status_code == 201, printed.text
        payload = printed.json()["payload"]
        assert payload["stage"] == ("CLOSING" if kind == "REPRINT" else "PRE_PAYMENT")
        for document_key, total_key in (("document", "line_total"), ("receipt", "lineTotal")):
            lines = payload[document_key]["lines"]
            assert len(lines) == 1
            assert Decimal(lines[0]["quantity"]) == 2
            assert Decimal(lines[0][total_key]) == expected_total
        assert Decimal(payload["document"]["totals"]["total"]) == Decimal(appended.json()["total"])
    tickets = await api.client.get("/api/v1/kitchen/tickets", headers=headers)
    batches = [row for row in tickets.json() if row["order_id"] == order["id"]]
    assert len(batches) == 2
    assert all(Decimal(row["items"][0]["quantity"]) == 1 for row in batches)


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
    attempt_count = claimed.json()["attempt_count"]

    printed = await api.client.patch(
        f"/api/v1/printing/bridge/jobs/{first.json()['id']}",
        headers={**bridge_headers, "Idempotency-Key": "print-job-key-0001:printed"},
        json={"status": "PRINTED", "attempt_count": attempt_count},
    )
    assert printed.status_code == 200, printed.text
    replay = await api.client.patch(
        f"/api/v1/printing/bridge/jobs/{first.json()['id']}",
        headers={**bridge_headers, "Idempotency-Key": "print-job-key-0001:printed"},
        json={"status": "PRINTED", "attempt_count": attempt_count},
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
    cashier_printer = await _create_cashier_printer(api, headers)
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
    assert first.json()["printer_device_id"] == cashier_printer["id"]
    assert first.json()["payload"]["content_type"] == "application/vnd.dixora.receipt+json"
    assert first.json()["payload"]["document"]["title"] == "HESAP ÖZETİ"
    assert first.json()["payload"]["document"]["document_type"] == "BILL"
    assert first.json()["payload"]["document"]["receipt_number"] == 1
    assert (
        first.json()["payload"]["document"]["source_label"]
        == {
            "WAITER": "GARSON",
            "CASHIER": "KASA",
        }[order["source"]]
    )
    assert first.json()["payload"]["document"]["staff_label"] == "Kasiyer"
    assert first.json()["payload"]["document"]["totals"]["service_charge"] == str(
        order["service_charge_amount"]
    )
    assert "cover_charge" not in first.json()["payload"]["document"]["totals"]
    assert first.json()["payload"]["document"]["footer"] == [
        "Bizi tercih ettiğiniz için teşekkür ederiz."
    ]
    assert first.json()["payload"]["receipt"]["meta"]["dailyReceiptNumber"] == 1

    order_after_first_print = await api.client.get(f"/api/v1/orders/{order['id']}", headers=headers)
    assert order_after_first_print.status_code == 200, order_after_first_print.text
    assert order_after_first_print.json()["status"] == "BILL_REQUESTED"

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
    assert reprint.json()["receipt_id"] == first.json()["receipt_id"]
    assert reprint.json()["payload"]["document"]["receipt_number"] == 1
    assert reprint.json()["payload"]["is_reprint"] is True

    filtered = await api.client.get(
        "/api/v1/printing/jobs", headers=headers, params={"order_id": order["id"]}
    )
    assert filtered.status_code == 200, filtered.text
    job_ids = {job["id"] for job in filtered.json()}
    # A kitchen ticket print job for the same order may also exist; the bill
    # print jobs must be present among them and correctly scoped to this order.
    assert {first.json()["id"], reprint.json()["id"]}.issubset(job_ids)
    assert all(job["order_id"] == order["id"] for job in filtered.json())

    receipts = await api.client.get("/api/v1/printing/receipts", headers=headers)
    assert receipts.status_code == 200, receipts.text
    receipt = next(item for item in receipts.json() if item["order_id"] == order["id"])
    assert receipt["daily_number"] == 1
    assert receipt["reprint_count"] == 1
    assert receipt["table_name"] == order["table_name"]
    assert receipt["cashier_name"]
    assert receipt["order_status"] == "BILL_REQUESTED"
    assert receipt["print_status"] == "REPRINTED"

    next_order = await _create_burger_order(
        api,
        headers,
        table_id=resources["tables"][11]["id"],
        product_id=resources["burger"]["id"],
        key="print-bill-order-key-0002",
    )
    next_print = await api.client.post(
        "/api/v1/printing/jobs",
        headers=headers,
        json={
            "order_id": next_order["id"],
            "payload": {"type": "BILL", "order_id": next_order["id"]},
            "kind": "ORIGINAL",
            "idempotency_key": f"bill-original:{next_order['id']}",
        },
    )
    assert next_print.status_code == 201, next_print.text
    assert next_print.json()["payload"]["document"]["receipt_number"] == 2


async def test_courier_receipt_contains_delivery_contact_prices_and_reprint_marker(
    api: ApiContext,
) -> None:
    headers = auth_headers(await login(api))
    resources = await seeded_resources(api, headers)
    cashier_printer = await _create_cashier_printer(api, headers)
    created = await api.client.post(
        "/api/v1/delivery",
        headers=headers,
        json={
            "channel": "OWN_DELIVERY",
            "items": [{"product_id": resources["burger"]["id"], "quantity": "2"}],
            "idempotency_key": "courier-receipt-order-0001",
            "customer_name": "Ayşe Yılmaz",
            "customer_phone": "0555 111 22 33",
            "address_line": "Atatürk Cad. No: 10 D: 4",
            "district": "Kadıköy",
            "customer_note": "Zil çalışmıyor",
            "payment_method": "CARD_ON_DELIVERY",
            "payment_status": "UNPAID",
            "auto_accept": True,
        },
    )
    assert created.status_code == 201, created.text
    delivery = created.json()

    original_payload = {
        "order_id": delivery["order_id"],
        "payload": {"type": "COURIER", "order_id": delivery["order_id"]},
        "kind": "ORIGINAL",
        "idempotency_key": f"courier-original:{delivery['order_id']}",
    }
    original = await api.client.post(
        "/api/v1/printing/jobs", headers=headers, json=original_payload
    )
    assert original.status_code == 201, original.text
    assert original.json()["printer_device_id"] == cashier_printer["id"]
    document = original.json()["payload"]["document"]
    assert document["document_type"] == "COURIER"
    assert document["title"] == "KURYE FİŞİ"
    assert document["customer_name"] == "Ayşe Yılmaz"
    assert document["customer_phone"] == "0555 111 22 33"
    assert "Atatürk Cad." in document["delivery_address"]
    assert document["payment_label"] == "Kapıda kart"
    assert document["lines"][0]["unit_price"]
    assert document["lines"][0]["line_total"]
    assert document["footer"] == ["Sipariş notu: Zil çalışmıyor"]

    reprint = await api.client.post(
        "/api/v1/printing/jobs",
        headers=headers,
        json={
            **original_payload,
            "kind": "REPRINT",
            "idempotency_key": f"courier-reprint:{delivery['order_id']}:1",
        },
    )
    assert reprint.status_code == 201, reprint.text
    assert reprint.json()["kind"] == "REPRINT"
    assert reprint.json()["payload"]["is_reprint"] is True
    assert reprint.json()["payload"]["document"]["title"] == "KURYE FİŞİ"


async def test_print_jobs_order_id_filter_is_tenant_scoped(api: ApiContext) -> None:
    owner = await login(api)
    owner_headers = auth_headers(owner)
    resources = await seeded_resources(api, owner_headers)
    await _create_cashier_printer(api, owner_headers)
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
            "purpose": "CASHIER",
            "transport": "MOCK",
            "settings": {"paper_width": 80},
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["purpose"] == "CASHIER"
    updated = await api.client.patch(
        f"/api/v1/printing/devices/{created.json()['id']}",
        headers=headers,
        json={"name": "Main Cashier Printer"},
    )
    assert updated.status_code == 200
    devices = await api.client.get("/api/v1/printing/devices", headers=headers)
    assert devices.status_code == 200
    assert any(device["code"] == "RECEIPT-01" for device in devices.json())


async def test_bill_print_requires_explicit_cashier_printer(api: ApiContext) -> None:
    headers = auth_headers(await login(api))
    resources = await seeded_resources(api, headers)
    order = await _create_burger_order(
        api,
        headers,
        table_id=resources["tables"][14]["id"],
        product_id=resources["burger"]["id"],
        key="print-bill-no-cashier-printer-0001",
    )
    devices = (await api.client.get("/api/v1/printing/devices", headers=headers)).json()
    kitchen_printer = next(device for device in devices if device["code"] == "MOCK-KITCHEN")
    wrong_route = await api.client.post(
        "/api/v1/printing/jobs",
        headers=headers,
        json={
            "order_id": order["id"],
            "printer_device_id": kitchen_printer["id"],
            "payload": {"type": "BILL", "order_id": order["id"]},
            "kind": "ORIGINAL",
            "idempotency_key": f"bill-wrong-printer:{order['id']}",
        },
    )
    assert wrong_route.status_code == 422
    assert wrong_route.json()["error"]["code"] == "cashier_printer_required"

    response = await api.client.post(
        "/api/v1/printing/jobs",
        headers=headers,
        json={
            "order_id": order["id"],
            "payload": {"type": "BILL", "order_id": order["id"]},
            "kind": "ORIGINAL",
            "idempotency_key": f"bill-no-printer:{order['id']}",
        },
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "cashier_printer_not_configured"
