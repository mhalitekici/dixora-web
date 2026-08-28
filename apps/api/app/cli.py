"""Operational commands, meant to be run from the host's crontab.

    docker compose exec -T api python -m app.cli billing-run
    docker compose exec -T api python -m app.cli billing-run --date 2026-09-01

Billing is deliberately a command rather than a background thread inside the
API: with several workers running, an in-process scheduler would fire once per
worker, and the only thing stopping duplicate invoices would be a database
constraint doing cleanup after the fact.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import date, datetime

from app.config import get_settings
from app.db import Database
from app.services.billing import generate_invoices


async def _billing_run(on: date | None) -> int:
    settings = get_settings()
    database = Database(settings)
    try:
        async with database.session_factory() as db:
            invoices = await generate_invoices(db, on=on)
            await db.commit()
            total = sum(invoice.amount for invoice in invoices)
            for invoice in invoices:
                print(
                    f"{invoice.number} {invoice.period_start} "
                    f"{invoice.amount} {invoice.currency} "
                    f"branches={invoice.branch_count}"
                )
            print(f"issued {len(invoices)} invoice(s), total {total}")
    finally:
        await database.dispose()
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="app.cli")
    commands = parser.add_subparsers(dest="command", required=True)

    billing = commands.add_parser(
        "billing-run", help="Issue subscription invoices for a month."
    )
    billing.add_argument(
        "--date",
        help="Any day in the month to bill (YYYY-MM-DD). Defaults to today.",
    )

    args = parser.parse_args(argv)

    if args.command == "billing-run":
        on: date | None = None
        if args.date:
            try:
                on = datetime.strptime(args.date, "%Y-%m-%d").date()
            except ValueError:
                parser.error("--date must be YYYY-MM-DD")
        return asyncio.run(_billing_run(on))

    parser.error(f"unknown command: {args.command}")
    return 2


if __name__ == "__main__":
    sys.exit(main())
