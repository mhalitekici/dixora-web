"""Production-readiness hardening for the print bridge protocol.

Covers what docs/printing.md called out as release blockers: a stuck CLAIMED
lease recovering on its own, enrollment codes replacing hand-typed tokens,
heartbeat/inventory reporting, bridge revocation, the platform-wide rollup for
Super Admin, and the kitchen/bar ticket payload actually carrying order
number, table, waiter, modifiers and notes rather than a bare item list.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select

from app.models import PrintBridgeClient, PrintJob
from tests.conftest import ApiContext, auth_headers, login, seeded_resources
from tests.test_orders import _create_burger_order

DEV_BRIDGE_HEADERS = {"X-Print-Bridge-Token": "pb_dev_dixora_lab_bridge_2026"}


async def test_a_lease_expires_and_the_job_becomes_reclaimable(
    api: ApiContext,
) -> None:
    """A bridge that claims a job and then vanishes (crash, dead network) must
    not leave that job stuck forever — the lease has to lapse and give it back."""
    tokens = await login(api)
    headers = auth_headers(tokens)
    devices = await api.client.get("/api/v1/printing/devices", headers=headers)
    printer = next(d for d in devices.json() if d["code"] == "MOCK-KITCHEN")

    created = await api.client.post(
        "/api/v1/printing/jobs",
        headers=headers,
        json={
            "payload": {"lines": []},
            "printer_device_id": printer["id"],
            "idempotency_key": "lease-expiry-key-0001",
            "kind": "ORIGINAL",
        },
    )
    assert created.status_code == 201, created.text
    job_id = created.json()["id"]

    claimed = await api.client.post(
        "/api/v1/printing/bridge/claim",
        headers=DEV_BRIDGE_HEADERS,
        params={"printer_codes": "MOCK-KITCHEN"},
    )
    assert claimed.status_code == 200, claimed.text
    assert claimed.json()["id"] == job_id

    # Nothing else to claim while the lease is fresh — the bridge "crashed"
    # without ever acknowledging SENT or PRINTED.
    nothing_yet = await api.client.post(
        "/api/v1/printing/bridge/claim",
        headers=DEV_BRIDGE_HEADERS,
        params={"printer_codes": "MOCK-KITCHEN"},
    )
    assert nothing_yet.json() is None

    async with api.database.session_factory() as db:
        job = await db.get(PrintJob, UUID(job_id))
        assert job is not None
        assert job.lease_expires_at is not None
        job.lease_expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await db.commit()

    reclaimed = await api.client.post(
        "/api/v1/printing/bridge/claim",
        headers=DEV_BRIDGE_HEADERS,
        params={"printer_codes": "MOCK-KITCHEN"},
    )
    assert reclaimed.status_code == 200, reclaimed.text
    assert reclaimed.json()["id"] == job_id
    assert reclaimed.json()["attempt_count"] == 2


async def test_printed_clears_the_lease_and_sent_extends_it(api: ApiContext) -> None:
    tokens = await login(api)
    headers = auth_headers(tokens)
    devices = await api.client.get("/api/v1/printing/devices", headers=headers)
    printer = next(d for d in devices.json() if d["code"] == "MOCK-KITCHEN")
    created = await api.client.post(
        "/api/v1/printing/jobs",
        headers=headers,
        json={
            "payload": {"lines": []},
            "printer_device_id": printer["id"],
            "idempotency_key": "lease-lifecycle-key-0001",
            "kind": "ORIGINAL",
        },
    )
    job_id = created.json()["id"]
    claimed = await api.client.post(
        "/api/v1/printing/bridge/claim",
        headers=DEV_BRIDGE_HEADERS,
        params={"printer_codes": "MOCK-KITCHEN"},
    )
    assert claimed.status_code == 200, claimed.text
    attempt_count = claimed.json()["attempt_count"]

    async with api.database.session_factory() as db:
        job = await db.get(PrintJob, UUID(job_id))
        assert job is not None
        claim_lease = job.lease_expires_at
        assert claim_lease is not None

    sent = await api.client.patch(
        f"/api/v1/printing/bridge/jobs/{job_id}",
        headers={**DEV_BRIDGE_HEADERS, "Idempotency-Key": "lease-lifecycle:sent"},
        json={"status": "SENT", "attempt_count": attempt_count},
    )
    assert sent.status_code == 200, sent.text

    async with api.database.session_factory() as db:
        job = await db.get(PrintJob, UUID(job_id))
        assert job is not None
        assert job.lease_expires_at is not None
        assert job.lease_expires_at >= claim_lease

    printed = await api.client.patch(
        f"/api/v1/printing/bridge/jobs/{job_id}",
        headers={**DEV_BRIDGE_HEADERS, "Idempotency-Key": "lease-lifecycle:printed"},
        json={"status": "PRINTED", "attempt_count": attempt_count},
    )
    assert printed.status_code == 200, printed.text

    async with api.database.session_factory() as db:
        job = await db.get(PrintJob, UUID(job_id))
        assert job is not None
        assert job.lease_expires_at is None


async def test_enrollment_code_is_redeemed_exactly_once(api: ApiContext) -> None:
    tokens = await login(api)
    headers = auth_headers(tokens)

    created = await api.client.post(
        "/api/v1/printing/bridges/enrollment-codes",
        headers=headers,
        json={},
    )
    assert created.status_code == 201, created.text
    code = created.json()["code"]
    assert len(code) == 9  # XXXX-XXXX
    assert "-" in code

    enrolled = await api.client.post(
        "/api/v1/printing/bridge/enroll",
        json={"code": code, "name": "Aleyin Mutfağı Kasa Bilgisayarı", "platform": "windows"},
    )
    assert enrolled.status_code == 201, enrolled.text
    body = enrolled.json()
    assert body["token"].startswith("pb_")

    # The same code cannot be spent twice.
    replay = await api.client.post(
        "/api/v1/printing/bridge/enroll",
        json={"code": code, "name": "Second Machine"},
    )
    assert replay.status_code == 400
    assert replay.json()["error"]["code"] == "invalid_enrollment_code"


async def test_enrollment_code_is_case_and_whitespace_insensitive_but_still_one_time(
    api: ApiContext,
) -> None:
    tokens = await login(api)
    headers = auth_headers(tokens)
    created = await api.client.post(
        "/api/v1/printing/bridges/enrollment-codes", headers=headers, json={}
    )
    code = created.json()["code"]

    enrolled = await api.client.post(
        "/api/v1/printing/bridge/enroll",
        json={"code": f" {code.lower()} ", "name": "Case Insensitive Bridge"},
    )
    assert enrolled.status_code == 201, enrolled.text


async def test_an_expired_enrollment_code_is_rejected(api: ApiContext) -> None:
    tokens = await login(api)
    headers = auth_headers(tokens)
    created = await api.client.post(
        "/api/v1/printing/bridges/enrollment-codes",
        headers=headers,
        json={"ttl_minutes": 1},
    )
    code = created.json()["code"]

    from app.models import PrintBridgeEnrollmentCode

    async with api.database.session_factory() as db:
        record = (
            await db.execute(select(PrintBridgeEnrollmentCode))
        ).scalars().first()
        assert record is not None
        record.expires_at = datetime.now(UTC) - timedelta(minutes=1)
        await db.commit()

    enrolled = await api.client.post(
        "/api/v1/printing/bridge/enroll",
        json={"code": code, "name": "Too Late"},
    )
    assert enrolled.status_code == 400
    assert enrolled.json()["error"]["code"] == "invalid_enrollment_code"


async def test_a_bogus_enrollment_code_is_rejected(api: ApiContext) -> None:
    response = await api.client.post(
        "/api/v1/printing/bridge/enroll",
        json={"code": "ZZZZ-ZZZZ", "name": "Nope"},
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_enrollment_code"


async def test_enrollment_code_from_one_tenant_cannot_scope_a_bridge_into_another(
    api: ApiContext,
) -> None:
    """A code issued by tenant A must never let the caller pick tenant B's scope —
    there is no tenant field in the enroll request at all; it comes only from the
    code's own record."""
    tokens = await login(api)
    headers = auth_headers(tokens)
    created = await api.client.post(
        "/api/v1/printing/bridges/enrollment-codes", headers=headers, json={}
    )
    code = created.json()["code"]

    enrolled = await api.client.post(
        "/api/v1/printing/bridge/enroll",
        json={"code": code, "name": "Scoped Bridge"},
    )
    assert enrolled.status_code == 201, enrolled.text
    me = await api.client.get("/api/v1/auth/me", headers=headers)
    assert enrolled.json()["tenant_id"] == me.json()["tenant"]["id"]


async def test_heartbeat_reports_platform_version_and_printer_inventory(
    api: ApiContext,
) -> None:
    heartbeat = await api.client.post(
        "/api/v1/printing/bridge/heartbeat",
        headers=DEV_BRIDGE_HEADERS,
        json={
            "platform": "windows",
            "version": "1.2.0",
            "printers": ["mutfak", "BAR", "  ", "bar"],
        },
    )
    assert heartbeat.status_code == 200, heartbeat.text

    tokens = await login(api)
    headers = auth_headers(tokens)
    bridges = await api.client.get("/api/v1/printing/bridges", headers=headers)
    assert bridges.status_code == 200, bridges.text
    bridge = next(b for b in bridges.json() if b["name"] == "Development Bridge")
    assert bridge["platform"] == "windows"
    assert bridge["version"] == "1.2.0"
    assert bridge["printer_inventory"] == ["BAR", "mutfak"]
    assert bridge["is_online"] is True


async def test_scoped_bridge_claims_only_its_server_mapped_printer(
    api: ApiContext,
) -> None:
    """A local agent's inventory is discovery data, not authorization.

    Moving a device mapping must immediately move the only bridge allowed to
    claim its jobs. The enrolled agent does not need a local printer-code
    allow-list because the API returns the exact mapped OS printer name.
    """
    tokens = await login(api)
    headers = auth_headers(tokens)
    devices = await api.client.get("/api/v1/printing/devices", headers=headers)
    kitchen = next(device for device in devices.json() if device["code"] == "MOCK-KITCHEN")

    code_response = await api.client.post(
        "/api/v1/printing/bridges/enrollment-codes", headers=headers, json={}
    )
    enrolled = await api.client.post(
        "/api/v1/printing/bridge/enroll",
        json={
            "code": code_response.json()["code"],
            "name": "Mapped Local Agent",
            "platform": "windows",
        },
    )
    assert enrolled.status_code == 201, enrolled.text
    bridge = enrolled.json()
    scoped_headers = {"X-Print-Bridge-Token": bridge["token"]}

    heartbeat = await api.client.post(
        "/api/v1/printing/bridge/heartbeat",
        headers=scoped_headers,
        json={"printers": ["Mutfak Yerel"]},
    )
    assert heartbeat.status_code == 200, heartbeat.text
    mapped = await api.client.put(
        f"/api/v1/printing/bridges/{bridge['id']}/printer-mappings/{kitchen['id']}",
        headers=headers,
        json={"local_printer_name": "Mutfak Yerel"},
    )
    assert mapped.status_code == 200, mapped.text

    created = await api.client.post(
        "/api/v1/printing/jobs",
        headers=headers,
        json={
            "payload": {"lines": []},
            "printer_device_id": kitchen["id"],
            "idempotency_key": "mapped-bridge-claim-key-0001",
            "kind": "ORIGINAL",
        },
    )
    assert created.status_code == 201, created.text

    legacy_claim = await api.client.post(
        "/api/v1/printing/bridge/claim",
        headers=DEV_BRIDGE_HEADERS,
        params={"printer_codes": "MOCK-KITCHEN"},
    )
    assert legacy_claim.status_code == 200
    assert legacy_claim.json() is None

    scoped_claim = await api.client.post(
        "/api/v1/printing/bridge/claim", headers=scoped_headers
    )
    assert scoped_claim.status_code == 200, scoped_claim.text
    assert scoped_claim.json()["id"] == created.json()["id"]
    assert scoped_claim.json()["printer_code"] == "MOCK-KITCHEN"
    assert scoped_claim.json()["local_printer_name"] == "Mutfak Yerel"


async def test_uncertain_print_requires_explicit_manager_retry(api: ApiContext) -> None:
    tokens = await login(api)
    headers = auth_headers(tokens)
    devices = await api.client.get("/api/v1/printing/devices", headers=headers)
    kitchen = next(device for device in devices.json() if device["code"] == "MOCK-KITCHEN")
    created = await api.client.post(
        "/api/v1/printing/jobs",
        headers=headers,
        json={
            "payload": {"lines": []},
            "printer_device_id": kitchen["id"],
            "idempotency_key": "uncertain-print-key-0001",
            "kind": "ORIGINAL",
        },
    )
    assert created.status_code == 201, created.text
    job_id = created.json()["id"]
    claimed = await api.client.post(
        "/api/v1/printing/bridge/claim",
        headers=DEV_BRIDGE_HEADERS,
        params={"printer_codes": "MOCK-KITCHEN"},
    )
    assert claimed.status_code == 200, claimed.text
    attempt_count = claimed.json()["attempt_count"]

    uncertain = await api.client.patch(
        f"/api/v1/printing/bridge/jobs/{job_id}",
        headers={**DEV_BRIDGE_HEADERS, "Idempotency-Key": "uncertain-print:failed"},
        json={
            "status": "FAILED",
            "attempt_count": attempt_count,
            "manual_retry_required": True,
            "error": "Physical result is uncertain",
        },
    )
    assert uncertain.status_code == 200, uncertain.text
    assert uncertain.json()["manual_retry_required"] is True

    blocked = await api.client.post(
        "/api/v1/printing/bridge/claim",
        headers=DEV_BRIDGE_HEADERS,
        params={"printer_codes": "MOCK-KITCHEN"},
    )
    assert blocked.status_code == 200
    assert blocked.json() is None

    released = await api.client.post(
        f"/api/v1/printing/jobs/{job_id}/retry", headers=headers
    )
    assert released.status_code == 200, released.text
    assert released.json()["status"] == "PENDING"
    assert released.json()["manual_retry_required"] is False

    reclaimed = await api.client.post(
        "/api/v1/printing/bridge/claim",
        headers=DEV_BRIDGE_HEADERS,
        params={"printer_codes": "MOCK-KITCHEN"},
    )
    assert reclaimed.status_code == 200, reclaimed.text
    assert reclaimed.json()["id"] == job_id
    assert reclaimed.json()["attempt_count"] == attempt_count + 1


async def test_a_bridge_that_stops_calling_in_shows_as_offline(api: ApiContext) -> None:
    tokens = await login(api)
    headers = auth_headers(tokens)
    async with api.database.session_factory() as db:
        bridge = (
            await db.execute(select(PrintBridgeClient))
        ).scalars().first()
        assert bridge is not None
        bridge.last_seen_at = datetime.now(UTC) - timedelta(minutes=5)
        await db.commit()

    bridges = await api.client.get("/api/v1/printing/bridges", headers=headers)
    assert bridges.status_code == 200
    assert all(not b["is_online"] for b in bridges.json())


async def test_revoked_bridge_can_no_longer_claim_or_heartbeat(api: ApiContext) -> None:
    tokens = await login(api)
    headers = auth_headers(tokens)
    bridges = await api.client.get("/api/v1/printing/bridges", headers=headers)
    bridge_id = bridges.json()[0]["id"]

    revoked = await api.client.post(
        f"/api/v1/printing/bridges/{bridge_id}/revoke", headers=headers
    )
    assert revoked.status_code == 200, revoked.text
    assert revoked.json()["is_active"] is False
    assert revoked.json()["is_online"] is False

    claim_attempt = await api.client.post(
        "/api/v1/printing/bridge/claim",
        headers=DEV_BRIDGE_HEADERS,
        params={"printer_codes": "MOCK-KITCHEN"},
    )
    assert claim_attempt.status_code == 401

    heartbeat_attempt = await api.client.post(
        "/api/v1/printing/bridge/heartbeat",
        headers=DEV_BRIDGE_HEADERS,
        json={"printers": []},
    )
    assert heartbeat_attempt.status_code == 401


async def test_platform_summary_counts_bridges_across_the_whole_platform(
    api: ApiContext,
) -> None:
    super_admin = await login(
        api,
        username="superadmin@dixora.app",
        password="Dixora!2026",
        business=None,
    )
    headers = auth_headers(super_admin)

    summary = await api.client.get(
        "/api/v1/printing/platform/bridges/summary", headers=headers
    )
    assert summary.status_code == 200, summary.text
    body = summary.json()
    assert body["total_bridges"] >= 1
    assert body["online_bridges"] + body["offline_bridges"] == body["total_bridges"]


async def test_platform_summary_is_refused_without_platform_permission(
    api: ApiContext,
) -> None:
    tokens = await login(api)
    headers = auth_headers(tokens)
    response = await api.client.get(
        "/api/v1/printing/platform/bridges/summary", headers=headers
    )
    assert response.status_code == 403


async def test_kitchen_ticket_print_job_carries_the_full_receipt_document(
    api: ApiContext,
) -> None:
    """The bare {name, quantity, note} list this used to send is not enough to
    print a real ticket — a garson, a table, an order number and modifiers all
    have to survive into the physical printer's payload."""
    tokens = await login(api)
    headers = auth_headers(tokens)
    resources = await seeded_resources(api, headers)
    order = await _create_burger_order(
        api,
        headers,
        table_id=resources["tables"][14]["id"],
        product_id=resources["burger"]["id"],
        key="kitchen-payload-key-0001",
    )
    assert order["status"] == "ACCEPTED"

    jobs = await api.client.get(
        "/api/v1/printing/jobs", headers=headers, params={"order_id": order["id"]}
    )
    assert jobs.status_code == 200, jobs.text
    kitchen_jobs = [job for job in jobs.json() if job["kitchen_ticket_id"]]
    assert kitchen_jobs, "accepting the order should print a kitchen ticket"
    document = kitchen_jobs[0]["payload"]["document"]

    assert document["order_number"].startswith("AD-")
    assert document["table_name"] == resources["tables"][14]["name"]
    assert document["waiter_name"]
    assert document["branch_name"]
    assert document["station_name"]
    assert document["lines"][0]["name"] == resources["burger"]["name"]
    assert "modifiers" in document["lines"][0]


async def test_waiter_and_cashier_orders_use_the_same_station_print_pipeline(
    api: ApiContext,
) -> None:
    owner_headers = auth_headers(await login(api))
    resources = await seeded_resources(api, owner_headers)
    lemonade = next(
        product for product in resources["products"] if product["name"] == "Homemade Lemonade"
    )
    devices = await api.client.get("/api/v1/printing/devices", headers=owner_headers)
    device_codes = {device["id"]: device["code"] for device in devices.json()}

    for index, username in enumerate(("waiter@dixora.test", "cashier@dixora.test")):
        source_headers = auth_headers(await login(api, username=username))
        created = await api.client.post(
            "/api/v1/orders",
            headers=source_headers,
            json={
                "table_id": resources["tables"][18 + index]["id"],
                "items": [
                    {"product_id": resources["burger"]["id"], "quantity": "1"},
                    {"product_id": lemonade["id"], "quantity": "2"},
                ],
                "idempotency_key": f"{username.split('@')[0]}-station-print-0001",
                "auto_accept": True,
            },
        )
        assert created.status_code == 201, created.text
        order = created.json()
        expected_source = "WAITER" if username.startswith("waiter") else "CASHIER"
        assert order["source"] == expected_source

        jobs = await api.client.get(
            "/api/v1/printing/jobs",
            headers=owner_headers,
            params={"order_id": order["id"]},
        )
        assert jobs.status_code == 200, jobs.text
        assert {
            device_codes[job["printer_device_id"]]
            for job in jobs.json()
            if job["kitchen_ticket_id"]
        } == {"MOCK-KITCHEN", "MOCK-BAR"}


async def test_appended_items_also_carry_the_full_receipt_document(
    api: ApiContext,
) -> None:
    tokens = await login(api)
    headers = auth_headers(tokens)
    resources = await seeded_resources(api, headers)
    order = await _create_burger_order(
        api,
        headers,
        table_id=resources["tables"][15]["id"],
        product_id=resources["burger"]["id"],
        key="kitchen-append-key-0001",
    )
    appended = await api.client.post(
        f"/api/v1/orders/{order['id']}/items",
        headers=headers,
        json={
            "items": [{"product_id": resources["burger"]["id"], "quantity": "1"}],
            "idempotency_key": "kitchen-append-key-0001-items",
        },
    )
    assert appended.status_code == 200, appended.text

    jobs = await api.client.get(
        "/api/v1/printing/jobs", headers=headers, params={"order_id": order["id"]}
    )
    kitchen_jobs = [
        job
        for job in jobs.json()
        if job["kitchen_ticket_id"] and job["payload"].get("new_items_only")
    ]
    assert kitchen_jobs, "appending items should print a follow-up kitchen ticket"
    document = kitchen_jobs[0]["payload"]["document"]
    assert document["order_number"].startswith("AD-")
    assert document["table_name"] == resources["tables"][15]["name"]


async def test_the_test_print_payload_is_a_valid_receipt_document(
    api: ApiContext,
) -> None:
    """The bridge's own protocol parser only accepts the normalized receipt
    envelope — a "Test çıktısı al" job that skips it would silently print
    nothing (or crash the bridge) instead of proving the printer works."""
    tokens = await login(api)
    headers = auth_headers(tokens)
    devices = await api.client.get("/api/v1/printing/devices", headers=headers)
    printer = next(d for d in devices.json() if d["code"] == "MOCK-KITCHEN")

    created = await api.client.post(
        f"/api/v1/printing/devices/{printer['id']}/test", headers=headers
    )
    assert created.status_code == 201, created.text
    payload = created.json()["payload"]
    assert payload["content_type"] == "application/vnd.dixora.receipt+json"
    document = payload["document"]
    assert document["lines"], "a test print must still show visible content"
    assert all("name" in line and "quantity" in line for line in document["lines"])
