from __future__ import annotations

import hashlib
from decimal import Decimal

import pytest
from sqlalchemy import select

from app import seed as seed_module
from app.config import Settings
from app.models import PrintBridgeClient, SubscriptionFeature, SubscriptionPlan, User
from app.security import verify_password
from app.seed import DEVELOPMENT_PASSWORDS, seed_database
from tests.conftest import ApiContext


async def test_development_seed_cli_requires_explicit_opt_in(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = Settings(
        environment="development",
        database_url="sqlite+aiosqlite:///:memory:",
        jwt_secret="test-secret-that-is-at-least-thirty-two-characters",
        print_bridge_key="test-legacy-print-key-with-32-chars",
        dev_seed_enabled=False,
    )
    monkeypatch.setattr(seed_module, "get_settings", lambda: settings)

    with pytest.raises(RuntimeError, match="explicit opt-in"):
        await seed_module.run()


async def test_development_reseed_reconciles_documented_credentials(api: ApiContext) -> None:
    async with api.database.session_factory() as db:
        bridge = (
            await db.execute(
                select(PrintBridgeClient).where(
                    PrintBridgeClient.name == "Development Bridge"
                )
            )
        ).scalar_one()
        standard = (
            await db.execute(
                select(SubscriptionPlan).where(SubscriptionPlan.code == "STANDARD")
            )
        ).scalar_one()
        standard_feature = (
            await db.execute(
                select(SubscriptionFeature).where(
                    SubscriptionFeature.plan_id == standard.id
                )
            )
        ).scalars().first()
        owner = (
            await db.execute(select(User).where(User.username == "owner@dixora.test"))
        ).scalar_one()

        bridge.token_hash = "0" * 64
        bridge.is_active = False
        standard.monthly_price = Decimal("42.00")
        if standard_feature is not None:
            standard_feature.is_enabled = False
        owner.password_hash = "invalid-password-hash"
        owner.is_active = False
        await db.commit()

    async with api.database.session_factory() as db:
        await seed_database(db)

    async with api.database.session_factory() as db:
        bridge = (
            await db.execute(
                select(PrintBridgeClient).where(
                    PrintBridgeClient.name == "Development Bridge"
                )
            )
        ).scalar_one()
        standard = (
            await db.execute(
                select(SubscriptionPlan).where(SubscriptionPlan.code == "STANDARD")
            )
        ).scalar_one()
        standard_features = (
            await db.execute(
                select(SubscriptionFeature).where(
                    SubscriptionFeature.plan_id == standard.id
                )
            )
        ).scalars().all()
        owner = (
            await db.execute(select(User).where(User.username == "owner@dixora.test"))
        ).scalar_one()

        assert bridge.token_hash == hashlib.sha256(
            b"pb_dev_dixora_lab_bridge_2026"
        ).hexdigest()
        assert bridge.is_active is True
        assert standard.monthly_price == Decimal("1499.99")
        assert standard_features
        assert all(feature.is_enabled for feature in standard_features)
        assert owner.is_active is True
        assert verify_password(
            DEVELOPMENT_PASSWORDS["owner@dixora.test"], owner.password_hash
        )
