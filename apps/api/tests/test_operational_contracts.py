from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select

from app.models import CashierShift, Order, Payment, PrintBridgePrinterMapping, PrintJob, User
from app.models.enums import PaymentStatus, PrintJobStatus
from app.services.audit_display import safe_audit_value
from tests.conftest import ApiContext, auth_headers, login
from tests.test_reports import _seed_sales_analytics_data


def test_audit_display_redacts_nested_credentials_and_preserves_opening_cash() -> None:
    value = {
        "opening_cash": "100.00",
        "nested": {"credential": "private", "pin_hash": "private", "customer_phone": "555"},
    }
    assert safe_audit_value(value) == {
        "opening_cash": "100.00",
        "nested": {
            "credential": "[Gizlendi]",
            "pin_hash": "[Gizlendi]",
            "customer_phone": "[Gizlendi]",
        },
    }
    assert value["nested"]["credential"] == "private"


async def test_shift_history_paginates_past_one_hundred_and_filters_on_server(
    api: ApiContext,
) -> None:
    session = await login(api)
    headers = auth_headers(session)
    async with api.database.session_factory() as db:
        cashier = (
            await db.execute(select(User).where(User.username == "cashier@dixora.test"))
        ).scalar_one()
        from app.security import utcnow

        now = utcnow()
        for index in range(125):
            db.add(
                CashierShift(
                    tenant_id=cashier.tenant_id,
                    branch_id=cashier.branch_id,
                    user_id=cashier.id,
                    cashier_name=cashier.display_name,
                    status="CLOSED",
                    business_date=now.date(),
                    opened_at=now - timedelta(minutes=index),
                    closed_at=now,
                    opening_cash=Decimal("50.00"),
                )
            )
        await db.commit()
    query = {"limit": 50, "offset": 100, "status": "CLOSED"}
    result = await api.client.get("/api/v1/shifts/history", headers=headers, params=query)
    assert result.status_code == 200, result.text
    assert len(result.json()) == 25
    none = await api.client.get(
        "/api/v1/shifts/history", headers=headers, params={**query, "employee": "Olmayan çalışan"}
    )
    assert none.json() == []


async def test_refund_is_reported_on_refund_date_without_changing_sale_total(
    api: ApiContext,
) -> None:
    start, end = await _seed_sales_analytics_data(api)
    headers = auth_headers(await login(api))
    query = {"date_from": start.isoformat(), "date_to": end.isoformat()}
    before = (
        await api.client.get("/api/v1/reports/financial-summary", headers=headers, params=query)
    ).json()
    async with api.database.session_factory() as db:
        order = (
            await db.execute(
                select(Order).where(Order.idempotency_key == "reports-waiter-order-0001")
            )
        ).scalar_one()
        db.add(
            Payment(
                tenant_id=order.tenant_id,
                branch_id=order.branch_id,
                order_id=order.id,
                method="CASH",
                amount=Decimal("12.34"),
                status=PaymentStatus.REFUNDED,
                idempotency_key="past-sale-current-refund",
                created_at=start - timedelta(days=2),
                refunded_at=start + timedelta(minutes=5),
            )
        )
        await db.commit()
    after = (
        await api.client.get("/api/v1/reports/financial-summary", headers=headers, params=query)
    ).json()
    assert after["gross_sales"] == before["gross_sales"]
    assert Decimal(after["net_collections"]) == Decimal(before["net_collections"]) - Decimal(
        "12.34"
    )
    assert Decimal(after["refunds"]["CASH"]) == Decimal("12.34")


async def test_physical_confirmation_is_explicit_and_revocation_preserves_history(
    api: ApiContext,
) -> None:
    headers = auth_headers(await login(api))
    printer = await api.client.post(
        "/api/v1/printing/devices",
        headers=headers,
        json={
            "code": "ACCEPT-TEST",
            "name": "Kabul test yazıcısı",
            "purpose": "CASHIER",
            "transport": "MOCK",
        },
    )
    assert printer.status_code == 201, printer.text
    bridge = await api.client.post(
        "/api/v1/printing/bridges", headers=headers, json={"name": "Kabul bilgisayarı"}
    )
    assert bridge.status_code == 201, bridge.text
    job = await api.client.post(
        "/api/v1/printing/jobs",
        headers=headers,
        json={
            "printer_device_id": printer.json()["id"],
            "payload": {"type": "TEST"},
            "idempotency_key": "physical-acceptance-test",
        },
    )
    assert job.status_code == 201, job.text
    route = f"/api/v1/printing/jobs/{job.json()['id']}/physical-confirmation"
    assert (await api.client.post(route, headers=headers)).status_code == 409
    async with api.database.session_factory() as db:
        record = await db.get(PrintJob, UUID(job.json()["id"]))
        assert record is not None
        # Simulated spooler result. Physical output is never claimed by the test.
        record.status = PrintJobStatus.PRINTED
        record.claimed_by_bridge_id = UUID(bridge.json()["id"])
        db.add(
            PrintBridgePrinterMapping(
                tenant_id=record.tenant_id,
                branch_id=record.branch_id,
                bridge_id=record.claimed_by_bridge_id,
                printer_device_id=record.printer_device_id,
                local_printer_name="Simüle termal yazıcı",
            )
        )
        await db.commit()
    assert (await api.client.post(route, headers=headers)).status_code == 204
    proof = (await api.client.get("/api/v1/printing/physical-acceptance", headers=headers)).json()
    assert printer.json()["id"] in proof["confirmed_device_ids"]
    revoked = await api.client.post(
        f"/api/v1/printing/bridges/{bridge.json()['id']}/revoke", headers=headers
    )
    assert revoked.status_code == 200
    old_token = {"X-Print-Bridge-Token": bridge.json()["token"]}
    assert (
        await api.client.post("/api/v1/printing/bridge/claim", headers=old_token)
    ).status_code == 401
    async with api.database.session_factory() as db:
        assert await db.get(PrintJob, UUID(job.json()["id"])) is not None
        assert (
            await db.execute(
                select(PrintBridgePrinterMapping).where(
                    PrintBridgePrinterMapping.bridge_id == UUID(bridge.json()["id"])
                )
            )
        ).scalars().all() == []
    again = await api.client.post(
        "/api/v1/printing/bridges", headers=headers, json={"name": "Kabul bilgisayarı"}
    )
    assert again.status_code == 201, again.text
