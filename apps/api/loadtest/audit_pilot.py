"""Read-only data consistency audit after pilot_load; validation database only."""

from __future__ import annotations

import argparse
import asyncio
import json
from decimal import Decimal
from pathlib import Path
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.engine import make_url

from app.config import get_settings
from app.db import Database
from app.models import Order, Payment, PrintJob, QrOrderRequest
from app.models.enums import PaymentStatus, PrintJobStatus


async def audit(result: Path) -> None:
    settings = get_settings()
    if (
        settings.environment != "development"
        or make_url(settings.database_url).database != "dixora_validation"
    ):
        raise RuntimeError("Only disposable validation data can be audited by this tool")
    summary = json.loads(await asyncio.to_thread(result.read_text, encoding="utf-8"))
    prefix = summary["run_id"]
    if not prefix.startswith("pilot-") or not prefix[6:].isalnum():
        raise ValueError("Invalid run identifier")
    database = Database(settings)
    try:
        async with database.session_factory() as db:
            qr_orders = select(QrOrderRequest.order_id).where(
                QrOrderRequest.idempotency_key.startswith(prefix + ":")
            )
            orders = (
                (
                    await db.execute(
                        select(Order).where(
                            or_(
                                Order.idempotency_key.startswith(prefix + ":"),
                                Order.id.in_(qr_orders),
                            )
                        )
                    )
                )
                .scalars()
                .all()
            )
            expected = {UUID(value) for value in summary["completed_order_ids"]}
            assert {order.id for order in orders} == expected, (
                "Unexpected/missing orders after replay"
            )
            assert len(expected) == len(summary["completed_order_ids"]), (
                "Repeated order in scenario results"
            )
            assert expected, "No orders were created; this is not a valid consistency test"
            payments = (
                (await db.execute(select(Payment).where(Payment.order_id.in_(expected))))
                .scalars()
                .all()
            )
            jobs = (
                (await db.execute(select(PrintJob).where(PrintJob.order_id.in_(expected))))
                .scalars()
                .all()
            )
            for order in orders:
                paid = [
                    p
                    for p in payments
                    if p.order_id == order.id and p.status == PaymentStatus.COMPLETED
                ]
                assert len(paid) == 1, "Payment replay created duplicate/missing payments"
                assert sum((p.amount for p in paid), Decimal("0.00")) == order.total
                routed = [job for job in jobs if job.order_id == order.id]
                assert len(routed) == 2, "Kitchen/bar routing created duplicate/missing jobs"
                assert all(job.status == PrintJobStatus.PRINTED for job in routed)
                assert all(
                    job.tenant_id == order.tenant_id and job.branch_id == order.branch_id
                    for job in routed
                )
            print(
                json.dumps(
                    {
                        "run_id": prefix,
                        "orders_verified": len(orders),
                        "payments_verified": len(payments),
                        "simulated_jobs_verified": len(jobs),
                        "physical_printing_verified": False,
                    }
                )
            )
    finally:
        await database.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("result", type=Path)
    asyncio.run(audit(parser.parse_args().result))
