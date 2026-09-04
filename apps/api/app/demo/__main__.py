"""Command line entry point for the demo business.

    docker compose exec -T api python -m app.demo
    docker compose exec -T api python -m app.demo --reset
    docker compose exec -T api python -m app.demo --reset --days 30

Refuses to run outside a development environment: this writes a large, fictional
business and is not something that should ever land in a real deployment.
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from app.config import get_settings
from app.db import Database
from app.demo import data as D
from app.demo.runner import seed_demo


async def _run(*, history_days: int, seed: int, reset: bool, force: bool) -> int:
    settings = get_settings()
    if settings.environment == "production" and not force:
        print(
            "Demo verisi production ortamında oluşturulmaz. "
            "Gerçekten istiyorsanız --force ekleyin.",
            file=sys.stderr,
        )
        return 2

    database = Database(settings)
    try:
        async with database.session_factory() as session:
            report = await seed_demo(
                session, history_days=history_days, seed=seed, reset=reset
            )
            await session.commit()
    except RuntimeError as error:
        print(str(error), file=sys.stderr)
        return 1
    finally:
        await database.dispose()

    print(report.render())
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="app.demo",
        description=f"'{D.TENANT_NAME}' demo işletmesini oluşturur.",
    )
    parser.add_argument(
        "--days",
        type=int,
        default=D.DEFAULT_HISTORY_DAYS,
        help=f"Üretilecek geçmiş satış günü sayısı (varsayılan {D.DEFAULT_HISTORY_DAYS}).",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=20260828,
        help="Rastgelelik tohumu. Aynı tohum aynı veriyi üretir.",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Var olan demo işletmesini tüm verisiyle silip yeniden kurar.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Production ortam kontrolünü atlar.",
    )
    args = parser.parse_args(argv)
    if args.days < 1:
        parser.error("--days en az 1 olmalı")
    return asyncio.run(
        _run(history_days=args.days, seed=args.seed, reset=args.reset, force=args.force)
    )


if __name__ == "__main__":
    sys.exit(main())
