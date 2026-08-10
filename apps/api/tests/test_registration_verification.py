from __future__ import annotations

from sqlalchemy import func, select

from app.models import Tenant, User
from tests.conftest import ApiContext, auth_headers, login

SIGNUP = {
    "business_name": "Dozz Cafe",
    "business_type": "CAFE",
    "owner_name": "Halit Ekici",
    "email": "halit@dozzcafe.test",
    "phone": "+90 555 111 22 33",
    "password": "Str0ng-Signup-Pass!",
    "terms_accepted": True,
    "contract_version": "2026-08-09-v2",
}


async def test_business_is_only_created_after_the_email_is_verified(
    api: ApiContext,
) -> None:
    started = await api.client.post("/api/v1/registrations/start", json=SIGNUP)
    assert started.status_code == 201, started.text
    body = started.json()
    assert body["development_code"]

    # Nothing exists yet — an abandoned signup must leave no business behind.
    async with api.database.session_factory() as db:
        count = (
            await db.execute(
                select(func.count(Tenant.id)).where(Tenant.name == "Dozz Cafe")
            )
        ).scalar_one()
        assert count == 0

    confirmed = await api.client.post(
        "/api/v1/registrations/confirm",
        json={"verification_id": body["verification_id"], "code": body["development_code"]},
    )
    assert confirmed.status_code == 201, confirmed.text
    assert confirmed.json()["business_name"] == "Dozz Cafe"

    async with api.database.session_factory() as db:
        owner = (
            await db.execute(
                select(User).where(User.username == "halit@dozzcafe.test")
            )
        ).scalar_one()
        assert owner.phone == "+90 555 111 22 33"


async def test_a_wrong_code_creates_nothing(api: ApiContext) -> None:
    started = await api.client.post("/api/v1/registrations/start", json=SIGNUP)
    response = await api.client.post(
        "/api/v1/registrations/confirm",
        json={"verification_id": started.json()["verification_id"], "code": "000000"},
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "verification_invalid_code"

    async with api.database.session_factory() as db:
        count = (
            await db.execute(
                select(func.count(Tenant.id)).where(Tenant.name == "Dozz Cafe")
            )
        ).scalar_one()
        assert count == 0


async def test_a_confirmation_cannot_be_replayed(api: ApiContext) -> None:
    started = await api.client.post("/api/v1/registrations/start", json=SIGNUP)
    body = started.json()
    payload = {"verification_id": body["verification_id"], "code": body["development_code"]}

    first = await api.client.post("/api/v1/registrations/confirm", json=payload)
    assert first.status_code == 201, first.text

    replay = await api.client.post("/api/v1/registrations/confirm", json=payload)
    assert replay.status_code == 409
    assert replay.json()["error"]["code"] == "verification_used"


async def test_signup_requires_a_phone_number(api: ApiContext) -> None:
    payload = {key: value for key, value in SIGNUP.items() if key != "phone"}
    response = await api.client.post("/api/v1/registrations/start", json=payload)
    assert response.status_code == 422


async def test_an_existing_email_cannot_sign_up_again(api: ApiContext) -> None:
    response = await api.client.post(
        "/api/v1/registrations/start",
        json={**SIGNUP, "email": "owner@dixora.test"},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "email_already_registered"


async def test_onboarding_answers_round_trip(api: ApiContext) -> None:
    headers = auth_headers(await login(api))

    empty = await api.client.get("/api/v1/registrations/onboarding", headers=headers)
    assert empty.status_code == 200, empty.text
    assert empty.json()["completed"] is False

    saved = await api.client.put(
        "/api/v1/registrations/onboarding",
        headers=headers,
        json={
            "offers_delivery": True,
            "delivery_platforms": ["GETIR", "YEMEKSEPETI", "TRENDYOL_YEMEK"],
            "monthly_order_volume": "1000-5000",
            "table_count": 24,
            "heard_from": "instagram",
            "completed": True,
        },
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["delivery_platforms"] == [
        "GETIR",
        "YEMEKSEPETI",
        "TRENDYOL_YEMEK",
    ]
    assert saved.json()["completed"] is True

    reread = await api.client.get("/api/v1/registrations/onboarding", headers=headers)
    assert reread.json()["table_count"] == 24


async def test_unknown_delivery_platform_is_rejected(api: ApiContext) -> None:
    headers = auth_headers(await login(api))
    response = await api.client.put(
        "/api/v1/registrations/onboarding",
        headers=headers,
        json={"offers_delivery": True, "delivery_platforms": ["UBEREATS"]},
    )
    assert response.status_code == 422


async def test_signup_survives_an_email_used_by_several_businesses(
    api: ApiContext,
) -> None:
    """Usernames are unique per tenant, so one address can exist many times.

    Regression: the duplicate check used scalar_one_or_none(), which raised
    MultipleResultsFound and turned the signup form into a 500.
    """
    from sqlalchemy import select as sa_select

    from app.models import Role, User as UserModel

    async with api.database.session_factory() as db:
        template = (
            await db.execute(
                sa_select(UserModel).where(UserModel.username == "owner@dixora.test")
            )
        ).scalar_one()
        role = (await db.execute(sa_select(Role).where(Role.id == template.role_id))).scalar_one()
        # A second account on the same tenant carrying the same address.
        db.add(
            UserModel(
                tenant_id=template.tenant_id,
                branch_id=None,
                role_id=role.id,
                username="ikinci-hesap@dixora.test",
                email="paylasilan@example.test",
                display_name="İkinci Hesap",
                password_hash=template.password_hash,
            )
        )
        db.add(
            UserModel(
                tenant_id=template.tenant_id,
                branch_id=None,
                role_id=role.id,
                username="ucuncu-hesap@dixora.test",
                email="paylasilan@example.test",
                display_name="Üçüncü Hesap",
                password_hash=template.password_hash,
            )
        )
        await db.commit()

    response = await api.client.post(
        "/api/v1/registrations/start",
        json={**SIGNUP, "email": "paylasilan@example.test"},
    )
    # A clean conflict, never a 500.
    assert response.status_code == 409, response.text
    assert response.json()["error"]["code"] == "email_already_registered"


async def test_onboarding_captures_payment_and_meal_card_answers(
    api: ApiContext,
) -> None:
    """These answers decide which POS/marketplace integrations we build next."""
    headers = auth_headers(await login(api))
    saved = await api.client.put(
        "/api/v1/registrations/onboarding",
        headers=headers,
        json={
            "offers_delivery": True,
            "delivery_platforms": ["GETIR", "YEMEKSEPETI"],
            "payment_methods": ["CASH", "CARD", "MEAL_CARD"],
            "accepts_meal_cards": True,
            "meal_card_providers": ["MULTINET", "SODEXO"],
            "completed": True,
        },
    )
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["payment_methods"] == ["CASH", "CARD", "MEAL_CARD"]
    assert body["meal_card_providers"] == ["MULTINET", "SODEXO"]


async def test_meal_card_providers_are_dropped_when_not_accepted(
    api: ApiContext,
) -> None:
    """Saying "no meal cards" must not leave stale providers behind."""
    headers = auth_headers(await login(api))
    await api.client.put(
        "/api/v1/registrations/onboarding",
        headers=headers,
        json={"accepts_meal_cards": True, "meal_card_providers": ["MULTINET"]},
    )
    cleared = await api.client.put(
        "/api/v1/registrations/onboarding",
        headers=headers,
        json={"accepts_meal_cards": False, "meal_card_providers": ["MULTINET"]},
    )
    assert cleared.json()["meal_card_providers"] == []


async def test_unknown_meal_card_provider_is_rejected(api: ApiContext) -> None:
    headers = auth_headers(await login(api))
    response = await api.client.put(
        "/api/v1/registrations/onboarding",
        headers=headers,
        json={"accepts_meal_cards": True, "meal_card_providers": ["BILINMEYEN"]},
    )
    assert response.status_code == 422
