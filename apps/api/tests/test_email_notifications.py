from __future__ import annotations

import asyncio
import re
from datetime import timedelta
from typing import Any
from uuid import UUID

import httpx
import pytest
from sqlalchemy import select

from app.models import (
    Campaign,
    EmailNotification,
    LoyaltyCustomer,
    LoyaltyReward,
    Tenant,
)
from app.models.enums import LoyaltyRewardStatus
from app.security import utcnow
from app.services import email_notifications
from app.services.email import DevelopmentEmailSender, OutgoingEmail, ResendEmailSender
from tests.conftest import ApiContext, auth_headers, login, seeded_resources


class RecordingSender(DevelopmentEmailSender):
    def __init__(self) -> None:
        self.messages: list[OutgoingEmail] = []
        self.fail = False
        self.delivered = asyncio.Event()

    async def send(self, message: OutgoingEmail) -> None:
        if self.fail:
            raise RuntimeError("temporary provider failure")
        self.messages.append(message)
        self.delivered.set()


@pytest.fixture
def sender(monkeypatch: pytest.MonkeyPatch) -> RecordingSender:
    recorder = RecordingSender()
    monkeypatch.setattr(email_notifications, "get_email_sender", lambda _: recorder)
    return recorder


async def setup_program(api: ApiContext) -> tuple[dict[str, str], dict[str, Any], str]:
    headers = auth_headers(await login(api))
    resources = await seeded_resources(api, headers)
    branch_id = resources["tables"][0]["branch_id"]
    response = await api.client.put(
        "/api/v1/loyalty/program",
        headers=headers,
        json={
            "name": "Kahve Kulübü",
            "is_active": True,
            "campaign_type": "VISIT_COUNT",
            "threshold": 1,
            "branch_ids": [branch_id],
            "reward_product_id": resources["burger"]["id"],
            "minimum_order_amount": "1.00",
            "allow_multiple_same_day": True,
            "reward_same_order": False,
        },
    )
    assert response.status_code == 200, response.text
    return headers, resources, branch_id


async def enroll(
    api: ApiContext, headers: dict[str, str], email: str, *, consent: bool = True
) -> str:
    response = await api.client.post(
        "/api/v1/loyalty/enrollments/start",
        headers=headers,
        json={
            "first_name": "Ayşe",
            "last_name": "Yılmaz",
            "email": email,
            "marketing_email_consent": consent,
        },
    )
    assert response.status_code == 201, response.text
    verification = response.json()
    confirmed = await api.client.post(
        "/api/v1/loyalty/enrollments/confirm",
        headers=headers,
        json={
            "verification_id": verification["verification_id"],
            "code": verification["development_code"],
        },
    )
    assert confirmed.status_code == 200, confirmed.text
    return str(confirmed.json()["member_code"])


def campaign_input(branch_id: str, product_id: str, *, active: bool = True) -> dict[str, Any]:
    return {
        "name": "Kahve ikramı",
        "is_active": active,
        "branch_ids": [branch_id],
        "buy_product_id": product_id,
        "reward_product_id": product_id,
        "reward_kind": "FREE_ITEM",
    }


async def process(api: ApiContext) -> tuple[int, int]:
    async with api.database.session_factory() as db:
        return await email_notifications.process_email_notifications(db, api.settings)


async def test_campaign_announcement_targets_consented_members_and_sends_once(
    api: ApiContext, sender: RecordingSender
) -> None:
    headers, resources, branch_id = await setup_program(api)
    await enroll(api, headers, "yes@example.com")
    await enroll(api, headers, "no@example.com", consent=False)
    payload = campaign_input(branch_id, resources["burger"]["id"])
    response = await api.client.post("/api/v1/campaigns", headers=headers, json=payload)
    assert response.status_code == 201, response.text
    campaign = response.json()
    assert campaign["email_notification_status"] == "PENDING"
    assert campaign["email_notification_recipients"] == 1

    # Repeated queuing of this publication cannot duplicate a recipient.
    async with api.database.session_factory() as db:
        stored = await db.get(Campaign, UUID(campaign["id"]))
        assert stored is not None
        assert await email_notifications.queue_campaign_announcements(db, campaign=stored) == 0
    assert await process(api) == (1, 0)
    assert await process(api) == (0, 0)
    assert [message.to for message in sender.messages] == ["yes@example.com"]
    assert "Kahve ikramı" in sender.messages[0].subject
    assert sender.messages[0].idempotency_key
    listing = await api.client.get("/api/v1/campaigns", headers=headers)
    assert listing.json()[0]["email_notification_status"] == "SENT"


async def test_draft_activation_and_editing_do_not_duplicate_announcements(
    api: ApiContext, sender: RecordingSender
) -> None:
    headers, resources, branch_id = await setup_program(api)
    await enroll(api, headers, "member@example.com")
    payload = campaign_input(branch_id, resources["burger"]["id"], active=False)
    created = await api.client.post("/api/v1/campaigns", headers=headers, json=payload)
    campaign = created.json()
    assert campaign["email_notification_status"] == "NOT_REQUESTED"
    assert await process(api) == (0, 0)
    path = f"/api/v1/campaigns/{campaign['id']}"
    payload["is_active"] = True
    activated = await api.client.put(path, headers=headers, json=payload)
    assert activated.status_code == 200, activated.text
    assert activated.json()["email_notification_recipients"] == 1
    assert await process(api) == (1, 0)
    payload["name"] = "Güncel kampanya adı"
    updated = await api.client.put(path, headers=headers, json=payload)
    assert updated.status_code == 200
    assert await process(api) == (0, 0)
    # Switching notifications off and on must not resend this publication.
    payload["notify_loyalty_members"] = False
    assert (await api.client.put(path, headers=headers, json=payload)).status_code == 200
    payload["notify_loyalty_members"] = True
    assert (await api.client.put(path, headers=headers, json=payload)).status_code == 200
    assert await process(api) == (0, 0)
    assert len(sender.messages) == 1


async def test_enabling_notifications_for_active_campaign_queues_members(
    api: ApiContext, sender: RecordingSender
) -> None:
    headers, resources, branch_id = await setup_program(api)
    await enroll(api, headers, "member@example.com")
    payload = campaign_input(branch_id, resources["burger"]["id"])
    payload["notify_loyalty_members"] = False
    campaign = (await api.client.post("/api/v1/campaigns", headers=headers, json=payload)).json()
    assert await process(api) == (0, 0)
    payload["notify_loyalty_members"] = True
    updated = await api.client.put(
        f"/api/v1/campaigns/{campaign['id']}", headers=headers, json=payload
    )
    assert updated.status_code == 200
    assert await process(api) == (1, 0)


async def test_campaign_without_eligible_members_is_not_stuck_pending(api: ApiContext) -> None:
    headers, resources, branch_id = await setup_program(api)
    await enroll(api, headers, "no@example.com", consent=False)
    response = await api.client.post(
        "/api/v1/campaigns",
        headers=headers,
        json=campaign_input(branch_id, resources["burger"]["id"]),
    )
    assert response.status_code == 201
    assert response.json()["email_notification_status"] == "NO_RECIPIENTS"
    assert response.json()["email_notification_recipients"] == 0


@pytest.mark.parametrize("cancel", ["campaign", "consent"])
async def test_outdated_campaign_notifications_are_cancelled_before_send(
    api: ApiContext, sender: RecordingSender, cancel: str
) -> None:
    headers, resources, branch_id = await setup_program(api)
    await enroll(api, headers, "member@example.com")
    response = await api.client.post(
        "/api/v1/campaigns",
        headers=headers,
        json=campaign_input(branch_id, resources["burger"]["id"]),
    )
    if cancel == "campaign":
        await api.client.delete(f"/api/v1/campaigns/{response.json()['id']}", headers=headers)
    else:
        async with api.database.session_factory() as db:
            customer = await db.scalar(select(LoyaltyCustomer))
            assert customer is not None
            customer.marketing_email_consent = False
            await db.commit()
    assert await process(api) == (0, 0)
    assert sender.messages == []
    overview = (await api.client.get("/api/v1/notifications", headers=headers)).json()
    assert overview["counts"]["CANCELLED"] == 1


async def earn_reward(api: ApiContext, headers: dict[str, str], resources: dict[str, Any]) -> None:
    member_code = await enroll(api, headers, "reward@example.com", consent=False)
    created = await api.client.post(
        "/api/v1/orders",
        headers=headers,
        json={
            "table_id": resources["tables"][7]["id"],
            "items": [{"product_id": resources["burger"]["id"], "quantity": "1"}],
            "idempotency_key": "notification-order-0001",
            "auto_accept": True,
        },
    )
    assert created.status_code == 201, created.text
    order = created.json()
    attached = await api.client.post(
        f"/api/v1/loyalty/orders/{order['id']}/membership",
        headers=headers,
        json={"membership_code": member_code},
    )
    assert attached.status_code == 200, attached.text
    payment = {"method": "CASH", "amount": order["total"], "idempotency_key": "notify-pay-0001"}
    for _ in range(2):
        response = await api.client.post(
            f"/api/v1/orders/{order['id']}/payments", headers=headers, json=payment
        )
        assert response.status_code == 201, response.text


async def test_earned_reward_sends_personal_reminder_without_marketing_consent(
    api: ApiContext, sender: RecordingSender
) -> None:
    headers, resources, _ = await setup_program(api)
    await earn_reward(api, headers, resources)
    async with api.database.session_factory() as db:
        reward = await db.scalar(select(LoyaltyReward))
        assert reward is not None
        assert not await email_notifications.queue_reward_notification(db, reward=reward)
    assert await process(api) == (1, 0)
    assert await process(api) == (0, 0)
    assert len(sender.messages) == 1
    message = sender.messages[0]
    assert message.to == "reward@example.com"
    assert f"1 ücretsiz {resources['burger']['name']}" in message.subject
    assert "İkramınızı almayı unutmayın" in message.text_body
    assert "Doğrulama kodu:" in message.text_body
    assert message.html_body and "İkramınızı almayı unutmayın" in message.html_body
    code_match = re.search(r"Doğrulama kodu: (\d{6})", message.text_body)
    assert code_match is not None
    order_response = await api.client.post(
        "/api/v1/orders",
        headers=headers,
        json={
            "table_id": resources["tables"][8]["id"],
            "items": [{"product_id": resources["burger"]["id"], "quantity": "1"}],
            "auto_accept": True,
            "idempotency_key": "notification-redeem-order-0001",
        },
    )
    assert order_response.status_code == 201, order_response.text
    order = order_response.json()
    async with api.database.session_factory() as db:
        reward = await db.scalar(select(LoyaltyReward))
        assert reward is not None
        reward_code = reward.redemption_code
    code = code_match.group(1)
    payload = {
        "order_id": order["id"],
        "order_item_id": order["items"][0]["id"],
        "idempotency_key": "notification-redeem-0001",
        "verification_code": f"{(int(code[0]) + 1) % 10}{code[1:]}",
    }
    path = f"/api/v1/loyalty/rewards/{reward_code}/redeem"
    assert (await api.client.post(path, headers=headers, json=payload)).status_code == 400
    payload["verification_code"] = code
    redeemed = await api.client.post(path, headers=headers, json=payload)
    assert redeemed.status_code == 201, redeemed.text


@pytest.mark.parametrize("status", [LoyaltyRewardStatus.REDEEMED, LoyaltyRewardStatus.REVERSED])
async def test_used_or_reversed_reward_is_not_announced(
    api: ApiContext, sender: RecordingSender, status: LoyaltyRewardStatus
) -> None:
    headers, resources, _ = await setup_program(api)
    await earn_reward(api, headers, resources)
    async with api.database.session_factory() as db:
        reward = await db.scalar(select(LoyaltyReward))
        assert reward is not None
        reward.status = status
        await db.commit()
    assert await process(api) == (0, 0)
    assert sender.messages == []


async def test_failed_delivery_retries_and_stops_after_five_attempts(
    api: ApiContext, sender: RecordingSender
) -> None:
    headers, resources, branch_id = await setup_program(api)
    await enroll(api, headers, "member@example.com")
    await api.client.post(
        "/api/v1/campaigns",
        headers=headers,
        json=campaign_input(branch_id, resources["burger"]["id"]),
    )
    sender.fail = True
    assert await process(api) == (0, 1)
    assert await process(api) == (0, 0)  # Not due yet.
    for expected_attempt in range(2, 6):
        async with api.database.session_factory() as db:
            item = await db.scalar(select(EmailNotification))
            assert item is not None
            item.next_attempt_at = utcnow() - timedelta(seconds=1)
            await db.commit()
        assert await process(api) == (0, 1)
        async with api.database.session_factory() as db:
            item = await db.scalar(select(EmailNotification))
            assert item is not None and item.attempts == expected_attempt
    assert item.next_attempt_at is None
    sender.fail = False
    assert await process(api) == (0, 0)
    overview = (await api.client.get("/api/v1/notifications", headers=headers)).json()
    assert overview["items"][0]["retry_scheduled"] is False


async def test_worker_drains_queue_without_http_request(
    api: ApiContext, sender: RecordingSender
) -> None:
    headers, resources, branch_id = await setup_program(api)
    await enroll(api, headers, "member@example.com")
    await api.client.post(
        "/api/v1/campaigns",
        headers=headers,
        json=campaign_input(branch_id, resources["burger"]["id"]),
    )
    worker = asyncio.create_task(
        email_notifications.run_email_notification_worker(api.database, api.settings)
    )
    try:
        async with asyncio.timeout(3):
            await sender.delivered.wait()
    finally:
        worker.cancel()
        with pytest.raises(asyncio.CancelledError):
            await worker
    assert len(sender.messages) == 1


async def test_notification_overview_masks_contacts_and_isolates_tenants(api: ApiContext) -> None:
    headers, resources, branch_id = await setup_program(api)
    await enroll(api, headers, "private@example.com")
    await api.client.post(
        "/api/v1/campaigns",
        headers=headers,
        json=campaign_input(branch_id, resources["burger"]["id"]),
    )
    async with api.database.session_factory() as db:
        tenant = Tenant(name="Başka işletme", slug="other-business")
        db.add(tenant)
        await db.flush()
        customer = LoyaltyCustomer(tenant_id=tenant.id, email_normalized="other@example.com")
        db.add(customer)
        await db.flush()
        db.add(
            EmailNotification(
                tenant_id=tenant.id,
                customer_id=customer.id,
                notification_type="CAMPAIGN_ANNOUNCEMENT",
                recipient_email="other@example.com",
                idempotency_key="other-tenant-message",
                payload={"campaign_name": "Other tenant"},
            )
        )
        await db.commit()
    response = await api.client.get("/api/v1/notifications", headers=headers)
    assert response.status_code == 200, response.text
    overview = response.json()
    assert overview["counts"]["PENDING"] == 1
    assert len(overview["items"]) == 1
    assert "private@example.com" not in response.text
    assert "other@example.com" not in response.text
    assert "payload" not in overview["items"][0]
    cashier = auth_headers(await login(api, username="cashier@dixora.test"))
    assert (await api.client.get("/api/v1/notifications", headers=cashier)).status_code == 403


async def test_resend_passes_idempotency_key(
    monkeypatch: pytest.MonkeyPatch, api: ApiContext
) -> None:
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json={"id": "message-id"})

    client_type = httpx.AsyncClient
    monkeypatch.setattr(
        "app.services.email.httpx.AsyncClient",
        lambda **kwargs: client_type(transport=httpx.MockTransport(handler), **kwargs),
    )
    message = OutgoingEmail(
        to="test@example.com", subject="Ödül", text_body="Hazır", idempotency_key="reward:123"
    )
    await ResendEmailSender(api.settings).send(message)
    assert captured[0].headers["Idempotency-Key"] == "reward:123"
