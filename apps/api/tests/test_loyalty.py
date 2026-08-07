from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select

from app.models import LoyaltyLedgerEntry, LoyaltyRedemption
from app.models.enums import LoyaltyLedgerEntryType
from tests.conftest import ApiContext, auth_headers, login, seeded_resources


async def _configure_visit_program(
    api: ApiContext,
    headers: dict[str, str],
    *,
    branch_id: str,
    reward_product_id: str,
    threshold: int = 1,
    allow_multiple_same_day: bool = True,
) -> dict:
    response = await api.client.put(
        "/api/v1/loyalty/program",
        headers=headers,
        json={
            "name": "Dixora Müdavim",
            "is_active": True,
            "show_on_qr": True,
            "campaign_type": "VISIT_COUNT",
            "threshold": threshold,
            "branch_ids": [branch_id],
            "reward_product_id": reward_product_id,
            "minimum_order_amount": "1.00",
            "allow_multiple_same_day": allow_multiple_same_day,
            "reward_same_order": False,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _configure_product_program(
    api: ApiContext,
    headers: dict[str, str],
    *,
    branch_id: str,
    product_id: str,
) -> dict:
    response = await api.client.put(
        "/api/v1/loyalty/program",
        headers=headers,
        json={
            "name": "Kahve Kulübü",
            "is_active": True,
            "show_on_qr": True,
            "campaign_type": "PRODUCT_QUANTITY",
            "threshold": 1,
            "branch_ids": [branch_id],
            "qualifying_product_id": product_id,
            "reward_product_id": product_id,
            "minimum_order_amount": "1.00",
            "allow_multiple_same_day": True,
            "reward_same_order": False,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _enroll(
    api: ApiContext,
    *,
    business_slug: str,
    branch_slug: str,
    phone: str = "0532 555 22 11",
) -> dict:
    start = await api.client.post(
        f"/api/v1/loyalty/public/{business_slug}/{branch_slug}/verification/start",
        json={"phone": phone, "consent_accepted": True},
    )
    assert start.status_code == 200, start.text
    verification = start.json()
    assert verification["mode"] == "DEVELOPMENT"
    assert "SMS gönderilmedi" in verification["message"]
    enrolled = await api.client.post(
        f"/api/v1/loyalty/public/{business_slug}/{branch_slug}/enroll",
        json={
            "phone": phone,
            "verification_token": verification["verification_token"],
            "verification_code": verification["development_code"],
            "consent_accepted": True,
            "consent_text_version": "2026-08",
        },
    )
    assert enrolled.status_code == 201, enrolled.text
    result = enrolled.json()
    assert result["membership_code"] != result["referral_code"]
    return result


async def _create_order(
    api: ApiContext,
    headers: dict[str, str],
    *,
    table_id: str,
    product_id: str,
    key: str,
    quantity: str = "1",
) -> dict:
    response = await api.client.post(
        "/api/v1/orders",
        headers=headers,
        json={
            "table_id": table_id,
            "items": [{"product_id": product_id, "quantity": quantity}],
            "idempotency_key": key,
            "auto_accept": True,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def test_phone_verification_failed_codes_are_rate_limited(
    api: ApiContext,
) -> None:
    tokens = await login(api)
    headers = auth_headers(tokens)
    resources = await seeded_resources(api, headers)
    await _configure_visit_program(
        api,
        headers,
        branch_id=tokens["user"]["branch_id"],
        reward_product_id=resources["burger"]["id"],
    )
    started = await api.client.post(
        "/api/v1/loyalty/public/dixora-lab/merkez/verification/start",
        json={"phone": "0532 555 33 22", "consent_accepted": True},
    )
    assert started.status_code == 200
    verification_token = started.json()["verification_token"]
    payload = {
        "phone": "0532 555 33 22",
        "verification_token": verification_token,
        "verification_code": "000000",
        "consent_accepted": True,
        "consent_text_version": "2026-08",
    }

    for _ in range(api.settings.loyalty_verification_rate_limit_attempts):
        rejected = await api.client.post(
            "/api/v1/loyalty/public/dixora-lab/merkez/enroll",
            json=payload,
        )
        assert rejected.status_code == 401
        assert rejected.json()["error"]["code"] == "verification_invalid"

    limited = await api.client.post(
        "/api/v1/loyalty/public/dixora-lab/merkez/enroll",
        json=payload,
    )
    assert limited.status_code == 429
    assert limited.json()["error"]["code"] == "loyalty_verification_rate_limited"


async def test_phone_verification_challenge_is_single_use(api: ApiContext) -> None:
    tokens = await login(api)
    headers = auth_headers(tokens)
    resources = await seeded_resources(api, headers)
    await _configure_visit_program(
        api,
        headers,
        branch_id=tokens["user"]["branch_id"],
        reward_product_id=resources["burger"]["id"],
    )
    path = "/api/v1/loyalty/public/dixora-lab/merkez"
    started = await api.client.post(
        f"{path}/verification/start",
        json={"phone": "0532 555 66 77", "consent_accepted": True},
    )
    assert started.status_code == 200, started.text
    verification = started.json()
    payload = {
        "phone": "0532 555 66 77",
        "verification_token": verification["verification_token"],
        "verification_code": verification["development_code"],
        "consent_accepted": True,
        "consent_text_version": "2026-08",
    }

    enrolled = await api.client.post(f"{path}/enroll", json=payload)
    assert enrolled.status_code == 201, enrolled.text

    replayed = await api.client.post(f"{path}/enroll", json=payload)
    assert replayed.status_code == 401, replayed.text
    assert replayed.json()["error"]["code"] == "verification_consumed"


async def test_loyalty_program_defaults_off_and_rejects_cross_tenant_catalog_refs(
    api: ApiContext,
) -> None:
    tokens = await login(api)
    headers = auth_headers(tokens)
    empty = await api.client.get("/api/v1/loyalty/program", headers=headers)
    assert empty.status_code == 200
    assert empty.json() is None

    branches = (await api.client.get("/api/v1/branches", headers=headers)).json()
    invalid = await api.client.put(
        "/api/v1/loyalty/program",
        headers=headers,
        json={
            "name": "Geçersiz Program",
            "campaign_type": "VISIT_COUNT",
            "threshold": 5,
            "branch_ids": [branches[0]["id"]],
            "reward_product_id": "00000000-0000-0000-0000-000000000001",
        },
    )
    assert invalid.status_code == 404
    assert invalid.json()["error"]["code"] == "product_not_found"


async def test_paid_order_accrues_once_and_reward_redemption_is_idempotent(
    api: ApiContext,
) -> None:
    tokens = await login(api)
    headers = auth_headers(tokens)
    resources = await seeded_resources(api, headers)
    branches = (await api.client.get("/api/v1/branches", headers=headers)).json()
    branch = branches[0]
    burger = resources["burger"]
    await _configure_visit_program(
        api,
        headers,
        branch_id=branch["id"],
        reward_product_id=burger["id"],
    )
    enrollment = await _enroll(
        api,
        business_slug="dixora-lab",
        branch_slug=branch["slug"],
    )
    verification_path = (
        f"/api/v1/loyalty/public/dixora-lab/{branch['slug']}/verification/start"
    )
    for _ in range(4):
        allowed_verification = await api.client.post(
            verification_path,
            json={"phone": "0532 555 22 11", "consent_accepted": True},
        )
        assert allowed_verification.status_code == 200
    limited_verification = await api.client.post(
        verification_path,
        json={"phone": "0532 555 22 11", "consent_accepted": True},
    )
    assert limited_verification.status_code == 429
    assert (
        limited_verification.json()["error"]["code"]
        == "loyalty_verification_rate_limited"
    )

    order = await _create_order(
        api,
        headers,
        table_id=resources["tables"][7]["id"],
        product_id=burger["id"],
        key="loyalty-paid-order-0001",
    )
    attached = await api.client.post(
        f"/api/v1/loyalty/orders/{order['id']}/membership",
        headers=headers,
        json={"membership_code": enrollment["membership_code"]},
    )
    assert attached.status_code == 200, attached.text
    paid = await api.client.post(
        f"/api/v1/orders/{order['id']}/payments",
        headers=headers,
        json={
            "method": "CASH",
            "amount": order["total"],
            "idempotency_key": "loyalty-payment-0001",
        },
    )
    assert paid.status_code == 201, paid.text
    replay = await api.client.post(
        f"/api/v1/orders/{order['id']}/payments",
        headers=headers,
        json={
            "method": "CASH",
            "amount": order["total"],
            "idempotency_key": "loyalty-payment-0001",
        },
    )
    assert replay.status_code == 201

    public_status = await api.client.get(
        f"/api/v1/loyalty/public/dixora-lab/{branch['slug']}/status",
        headers={"X-Loyalty-Token": enrollment["membership_token"]},
    )
    assert public_status.status_code == 200, public_status.text
    state = public_status.json()
    assert Decimal(state["progress"]) == Decimal("1.000000")
    assert len(state["rewards"]) == 1
    assert "tenant_id" not in state
    reward_code = state["rewards"][0]["redemption_code"]

    reward_order = await _create_order(
        api,
        headers,
        table_id=resources["tables"][8]["id"],
        product_id=burger["id"],
        key="loyalty-reward-order-0001",
    )
    reward_attached = await api.client.post(
        f"/api/v1/loyalty/orders/{reward_order['id']}/membership",
        headers=headers,
        json={"membership_code": enrollment["membership_code"]},
    )
    assert reward_attached.status_code == 200, reward_attached.text
    other_enrollment = await _enroll(
        api,
        business_slug="dixora-lab",
        branch_slug=branch["slug"],
        phone="0533 444 11 22",
    )
    conflicting_membership = await api.client.post(
        f"/api/v1/loyalty/orders/{reward_order['id']}/membership",
        headers=headers,
        json={"membership_code": other_enrollment["membership_code"]},
    )
    assert conflicting_membership.status_code == 409
    assert conflicting_membership.json()["error"]["code"] == "order_membership_conflict"
    order_context = await api.client.get(
        f"/api/v1/loyalty/orders/{reward_order['id']}/context",
        headers=headers,
    )
    assert order_context.status_code == 200, order_context.text
    assert order_context.json()["membership_code"] == enrollment["membership_code"]
    assert order_context.json()["available_rewards"] == [
        {
            "redemption_code": reward_code,
            "description": f"{burger['name']} ikramı",
            "eligible_order_item_ids": [reward_order["items"][0]["id"]],
            "expires_at": None,
        }
    ]
    redemption_payload = {
        "order_id": reward_order["id"],
        "order_item_id": reward_order["items"][0]["id"],
        "idempotency_key": "loyalty-redemption-0001",
    }
    redeemed = await api.client.post(
        f"/api/v1/loyalty/rewards/{reward_code}/redeem",
        headers=headers,
        json=redemption_payload,
    )
    assert redeemed.status_code == 201, redeemed.text
    assert Decimal(redeemed.json()["amount"]) == Decimal(burger["selling_price"])
    redeemed_replay = await api.client.post(
        f"/api/v1/loyalty/rewards/{reward_code}/redeem",
        headers=headers,
        json=redemption_payload,
    )
    assert redeemed_replay.status_code == 201
    assert redeemed_replay.json()["id"] == redeemed.json()["id"]
    mismatched_replay = await api.client.post(
        f"/api/v1/loyalty/rewards/{reward_code}/redeem",
        headers=headers,
        json={
            "order_id": order["id"],
            "order_item_id": order["items"][0]["id"],
            "idempotency_key": redemption_payload["idempotency_key"],
        },
    )
    assert mismatched_replay.status_code == 409
    assert mismatched_replay.json()["error"]["code"] == "idempotency_conflict"

    settled = await api.client.get(
        f"/api/v1/orders/{reward_order['id']}", headers=headers
    )
    assert settled.status_code == 200
    assert settled.json()["status"] == "PAID"
    assert Decimal(settled.json()["total"]) == Decimal("0")
    cancellation = await api.client.post(
        f"/api/v1/orders/{reward_order['id']}/cancellation-requests",
        headers=headers,
        json={
            "order_item_id": reward_order["items"][0]["id"],
            "reason": "Müşteri ödüllü üründen vazgeçti",
        },
    )
    assert cancellation.status_code == 201, cancellation.text
    approved = await api.client.post(
        f"/api/v1/orders/cancellation-requests/{cancellation.json()['id']}/approve",
        headers=headers,
    )
    assert approved.status_code == 200, approved.text
    wallet_after_reversal = await api.client.get(
        f"/api/v1/loyalty/public/dixora-lab/{branch['slug']}/status",
        headers={"X-Loyalty-Token": enrollment["membership_token"]},
    )
    assert wallet_after_reversal.status_code == 200
    replacement_rewards = wallet_after_reversal.json()["rewards"]
    assert len(replacement_rewards) == 1
    assert replacement_rewards[0]["status"] == "AVAILABLE"
    assert replacement_rewards[0]["redemption_code"] != reward_code

    async with api.database.session_factory() as db:
        accrual_count = (
            await db.execute(
                select(func.count(LoyaltyLedgerEntry.id)).where(
                    LoyaltyLedgerEntry.order_id == UUID(order["id"]),
                    LoyaltyLedgerEntry.entry_type == LoyaltyLedgerEntryType.ACCRUAL,
                )
            )
        ).scalar_one()
        redemption_count = (
            await db.execute(
                select(func.count(LoyaltyRedemption.id)).where(
                    LoyaltyRedemption.order_id == UUID(reward_order["id"])
                )
            )
        ).scalar_one()
        redemption_status = (
            await db.execute(
                select(LoyaltyRedemption.status).where(
                    LoyaltyRedemption.order_id == UUID(reward_order["id"])
                )
            )
        ).scalar_one()
    assert accrual_count == 1
    assert redemption_count == 1
    assert redemption_status.value == "REVERSED"


async def test_loyalty_reversal_appends_once_without_deleting_accrual(
    api: ApiContext,
) -> None:
    tokens = await login(api)
    headers = auth_headers(tokens)
    resources = await seeded_resources(api, headers)
    branch = (await api.client.get("/api/v1/branches", headers=headers)).json()[0]
    burger = resources["burger"]
    await _configure_visit_program(
        api,
        headers,
        branch_id=branch["id"],
        reward_product_id=burger["id"],
    )
    enrollment = await _enroll(
        api,
        business_slug="dixora-lab",
        branch_slug=branch["slug"],
    )
    order = await _create_order(
        api,
        headers,
        table_id=resources["tables"][9]["id"],
        product_id=burger["id"],
        key="loyalty-reversal-order-0001",
    )
    await api.client.post(
        f"/api/v1/loyalty/orders/{order['id']}/membership",
        headers=headers,
        json={"membership_code": enrollment["membership_code"]},
    )
    await api.client.post(
        f"/api/v1/orders/{order['id']}/payments",
        headers=headers,
        json={
            "method": "CASH",
            "amount": order["total"],
            "idempotency_key": "loyalty-reversal-payment-0001",
        },
    )
    payload = {
        "idempotency_key": "loyalty-reversal-command-0001",
        "reason": "Ödeme dış sistemde iade edildi",
    }
    first = await api.client.post(
        f"/api/v1/loyalty/orders/{order['id']}/reverse",
        headers=headers,
        json=payload,
    )
    second = await api.client.post(
        f"/api/v1/loyalty/orders/{order['id']}/reverse",
        headers=headers,
        json=payload,
    )
    assert first.status_code == 200, first.text
    assert first.json()["reversed_programs"] == 1
    assert second.status_code == 200
    assert second.json()["reversed_programs"] == 0
    async with api.database.session_factory() as db:
        entries = (
            (
                await db.execute(
                    select(LoyaltyLedgerEntry).where(
                        LoyaltyLedgerEntry.order_id == UUID(order["id"])
                    )
                )
            )
            .scalars()
            .all()
        )
    assert {entry.entry_type for entry in entries} == {
        LoyaltyLedgerEntryType.ACCRUAL,
        LoyaltyLedgerEntryType.REVERSAL,
    }
    assert sum((entry.progress_delta for entry in entries), Decimal("0")) == Decimal("0")


async def test_product_progress_excludes_quantity_paid_with_a_loyalty_reward(
    api: ApiContext,
) -> None:
    tokens = await login(api)
    headers = auth_headers(tokens)
    resources = await seeded_resources(api, headers)
    branch = (await api.client.get("/api/v1/branches", headers=headers)).json()[0]
    burger = resources["burger"]
    await _configure_product_program(
        api,
        headers,
        branch_id=branch["id"],
        product_id=burger["id"],
    )
    enrollment = await _enroll(
        api,
        business_slug="dixora-lab",
        branch_slug=branch["slug"],
    )

    earning_order = await _create_order(
        api,
        headers,
        table_id=resources["tables"][7]["id"],
        product_id=burger["id"],
        key="loyalty-product-earning-order-0001",
    )
    await api.client.post(
        f"/api/v1/loyalty/orders/{earning_order['id']}/membership",
        headers=headers,
        json={"membership_code": enrollment["membership_code"]},
    )
    paid = await api.client.post(
        f"/api/v1/orders/{earning_order['id']}/payments",
        headers=headers,
        json={
            "method": "CASH",
            "amount": earning_order["total"],
            "idempotency_key": "loyalty-product-payment-0001",
        },
    )
    assert paid.status_code == 201, paid.text
    wallet = await api.client.get(
        f"/api/v1/loyalty/public/dixora-lab/{branch['slug']}/status",
        headers={"X-Loyalty-Token": enrollment["membership_token"]},
    )
    reward_code = wallet.json()["rewards"][0]["redemption_code"]

    mixed_order = await _create_order(
        api,
        headers,
        table_id=resources["tables"][8]["id"],
        product_id=burger["id"],
        quantity="2",
        key="loyalty-product-mixed-order-0001",
    )
    await api.client.post(
        f"/api/v1/loyalty/orders/{mixed_order['id']}/membership",
        headers=headers,
        json={"membership_code": enrollment["membership_code"]},
    )
    redeemed = await api.client.post(
        f"/api/v1/loyalty/rewards/{reward_code}/redeem",
        headers=headers,
        json={
            "order_id": mixed_order["id"],
            "order_item_id": mixed_order["items"][0]["id"],
            "idempotency_key": "loyalty-product-redemption-0001",
        },
    )
    assert redeemed.status_code == 201, redeemed.text
    repriced = await api.client.get(
        f"/api/v1/orders/{mixed_order['id']}", headers=headers
    )
    paid_mixed = await api.client.post(
        f"/api/v1/orders/{mixed_order['id']}/payments",
        headers=headers,
        json={
            "method": "CASH",
            "amount": repriced.json()["total"],
            "idempotency_key": "loyalty-product-payment-0002",
        },
    )
    assert paid_mixed.status_code == 201, paid_mixed.text
    final_wallet = await api.client.get(
        f"/api/v1/loyalty/public/dixora-lab/{branch['slug']}/status",
        headers={"X-Loyalty-Token": enrollment["membership_token"]},
    )
    assert final_wallet.status_code == 200
    assert Decimal(final_wallet.json()["progress"]) == Decimal("2")
    assert len(final_wallet.json()["rewards"]) == 2


async def test_visit_limit_ignores_a_prior_day_accrual_reversed_today(
    api: ApiContext,
) -> None:
    tokens = await login(api)
    headers = auth_headers(tokens)
    resources = await seeded_resources(api, headers)
    branch = (await api.client.get("/api/v1/branches", headers=headers)).json()[0]
    burger = resources["burger"]
    await _configure_visit_program(
        api,
        headers,
        branch_id=branch["id"],
        reward_product_id=burger["id"],
        threshold=10,
        allow_multiple_same_day=False,
    )
    enrollment = await _enroll(
        api,
        business_slug="dixora-lab",
        branch_slug=branch["slug"],
    )

    async def create_and_pay(table_index: int, suffix: str) -> dict:
        order = await _create_order(
            api,
            headers,
            table_id=resources["tables"][table_index]["id"],
            product_id=burger["id"],
            key=f"loyalty-daily-order-{suffix}",
        )
        attached = await api.client.post(
            f"/api/v1/loyalty/orders/{order['id']}/membership",
            headers=headers,
            json={"membership_code": enrollment["membership_code"]},
        )
        assert attached.status_code == 200, attached.text
        paid = await api.client.post(
            f"/api/v1/orders/{order['id']}/payments",
            headers=headers,
            json={
                "method": "CASH",
                "amount": order["total"],
                "idempotency_key": f"loyalty-daily-payment-{suffix}",
            },
        )
        assert paid.status_code == 201, paid.text
        return order

    old_order = await create_and_pay(7, "old")
    async with api.database.session_factory() as db:
        old_entry = (
            await db.execute(
                select(LoyaltyLedgerEntry).where(
                    LoyaltyLedgerEntry.order_id == UUID(old_order["id"]),
                    LoyaltyLedgerEntry.entry_type == LoyaltyLedgerEntryType.ACCRUAL,
                )
            )
        ).scalar_one()
        old_entry.created_at = datetime.now(UTC) - timedelta(days=1)
        await db.commit()

    reversed_response = await api.client.post(
        f"/api/v1/loyalty/orders/{old_order['id']}/reverse",
        headers=headers,
        json={
            "idempotency_key": "loyalty-daily-reversal-old",
            "reason": "Önceki gün ödemesi iade edildi",
        },
    )
    assert reversed_response.status_code == 200, reversed_response.text
    await create_and_pay(8, "today-first")
    await create_and_pay(9, "today-second")

    wallet = await api.client.get(
        f"/api/v1/loyalty/public/dixora-lab/{branch['slug']}/status",
        headers={"X-Loyalty-Token": enrollment["membership_token"]},
    )
    assert wallet.status_code == 200, wallet.text
    assert Decimal(wallet.json()["progress"]) == Decimal("1")
