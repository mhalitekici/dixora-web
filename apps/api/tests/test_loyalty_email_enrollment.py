from __future__ import annotations

from sqlalchemy import select

from app.models import LoyaltyCustomer, LoyaltyMembership
from app.services.loyalty_enrollment import business_code_prefix, generate_card_code
from tests.conftest import ApiContext, auth_headers, login, seeded_resources


def test_member_code_is_branded_and_unambiguous() -> None:
    """Staff read these off a phone and type them in, so no 0/O or 1/I/L."""
    prefix = business_code_prefix("Dixora Lab")
    assert prefix.isalpha() and len(prefix) == 3
    code = generate_card_code(prefix)
    assert code.startswith(prefix)
    assert not set(code) & set("01OIL")


async def _staff(api: ApiContext) -> dict[str, str]:
    """A signed-in cashier with a live loyalty programme on their branch."""
    headers = auth_headers(await login(api))
    resources = await seeded_resources(api, headers)
    response = await api.client.put(
        "/api/v1/loyalty/program",
        headers=headers,
        json={
            "name": "Dixora Müdavim",
            "is_active": True,
            "show_on_qr": False,
            "campaign_type": "VISIT_COUNT",
            "threshold": 5,
            "branch_ids": [resources["tables"][0]["branch_id"]],
            "reward_product_id": resources["burger"]["id"],
            "minimum_order_amount": "1.00",
            "allow_multiple_same_day": True,
            "reward_same_order": False,
        },
    )
    assert response.status_code == 200, response.text
    return headers


async def _enrol(api: ApiContext, headers: dict[str, str], email: str) -> dict:
    started = await api.client.post(
        "/api/v1/loyalty/enrollments/start",
        headers=headers,
        json={
            "first_name": "Ahmet",
            "last_name": "Yılmaz",
            "email": email,
            "birth_date": "1990-04-12",
        },
    )
    assert started.status_code == 201, started.text
    body = started.json()
    assert body["development_code"], "dev sender should expose the code for local testing"

    confirmed = await api.client.post(
        "/api/v1/loyalty/enrollments/confirm",
        headers=headers,
        json={"verification_id": body["verification_id"], "code": body["development_code"]},
    )
    assert confirmed.status_code == 200, confirmed.text
    return confirmed.json()


async def test_cashier_enrols_a_customer_by_email(api: ApiContext) -> None:
    headers = await _staff(api)
    result = await _enrol(api, headers, "ahmet@example.com")

    assert result["display_name"] == "Ahmet Yılmaz"
    assert result["email"] == "ahmet@example.com"
    assert result["member_code"]
    assert result["card_email_sent"] is True

    async with api.database.session_factory() as db:
        customer = (
            await db.execute(
                select(LoyaltyCustomer).where(
                    LoyaltyCustomer.email_normalized == "ahmet@example.com"
                )
            )
        ).scalar_one()
        # Enrolment no longer collects a phone number at all.
        assert customer.phone_normalized is None
        assert customer.first_name == "Ahmet"
        assert str(customer.birth_date) == "1990-04-12"


async def test_wrong_code_is_rejected_and_counted(api: ApiContext) -> None:
    headers = await _staff(api)
    started = await api.client.post(
        "/api/v1/loyalty/enrollments/start",
        headers=headers,
        json={"first_name": "Zeynep", "last_name": "Kaya", "email": "zeynep@example.com"},
    )
    assert started.status_code == 201, started.text

    response = await api.client.post(
        "/api/v1/loyalty/enrollments/confirm",
        headers=headers,
        json={"verification_id": started.json()["verification_id"], "code": "000000"},
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "loyalty_verification_invalid_code"

    # No customer is created from a failed verification.
    async with api.database.session_factory() as db:
        rows = (
            (
                await db.execute(
                    select(LoyaltyCustomer).where(
                        LoyaltyCustomer.email_normalized == "zeynep@example.com"
                    )
                )
            )
            .scalars()
            .all()
        )
        assert rows == []


async def test_a_verification_cannot_be_replayed(api: ApiContext) -> None:
    headers = await _staff(api)
    started = await api.client.post(
        "/api/v1/loyalty/enrollments/start",
        headers=headers,
        json={"first_name": "Mert", "last_name": "Demir", "email": "mert@example.com"},
    )
    body = started.json()
    payload = {"verification_id": body["verification_id"], "code": body["development_code"]}

    first = await api.client.post(
        "/api/v1/loyalty/enrollments/confirm", headers=headers, json=payload
    )
    assert first.status_code == 200, first.text

    replay = await api.client.post(
        "/api/v1/loyalty/enrollments/confirm", headers=headers, json=payload
    )
    assert replay.status_code == 409
    assert replay.json()["error"]["code"] == "loyalty_verification_used"


async def test_enrolling_the_same_email_twice_is_refused(api: ApiContext) -> None:
    headers = await _staff(api)
    first = await _enrol(api, headers, "tekrar@example.com")

    again = await api.client.post(
        "/api/v1/loyalty/enrollments/start",
        headers=headers,
        json={"first_name": "Ahmet", "last_name": "Yılmaz", "email": "tekrar@example.com"},
    )
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "loyalty_already_enrolled"
    # The response tells the cashier the existing card code so they can help.
    assert again.json()["error"]["details"]["member_code"] == first["member_code"]


async def test_member_codes_are_unique_within_a_business(api: ApiContext) -> None:
    headers = await _staff(api)
    codes = {
        (await _enrol(api, headers, f"musteri{index}@example.com"))["member_code"]
        for index in range(4)
    }
    assert len(codes) == 4

    async with api.database.session_factory() as db:
        stored = (
            (await db.execute(select(LoyaltyMembership.lookup_code))).scalars().all()
        )
        assert len(set(stored)) == len(stored)
