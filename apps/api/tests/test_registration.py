from datetime import datetime

from tests.conftest import ApiContext


async def test_public_registration_creates_trial_business_and_owner(api: ApiContext) -> None:
    payload = {
        "business_name": "Kırmızı Masa Restoran",
        "business_type": "RESTAURANT",
        "owner_name": "Ayşe Yılmaz",
        "email": "ayse@kirmizimasa.test",
        "password": "Guvenli!Parola2026",
        "terms_accepted": True,
    }

    response = await api.client.post("/api/v1/registrations", json=payload)
    assert response.status_code == 201, response.text
    registration = response.json()
    assert registration["business_slug"] == "kirmizi-masa-restoran"
    assert registration["branch_slug"] == "merkez"
    assert registration["owner_username"] == payload["email"]
    assert datetime.fromisoformat(registration["trial_ends_at"]).tzinfo is not None

    login = await api.client.post(
        "/api/v1/auth/login",
        json={
            "business": registration["business_slug"],
            "username": payload["email"],
            "password": payload["password"],
        },
    )
    assert login.status_code == 200, login.text
    login_payload = login.json()
    assert login_payload["user"]["role"] == "BUSINESS_OWNER"
    assert login_payload["user"]["tenant"]["slug"] == registration["business_slug"]
    assert login_payload["user"]["branch"]["slug"] == "merkez"


async def test_public_registration_generates_unique_business_slug(api: ApiContext) -> None:
    payload = {
        "business_name": "Yeni Mekan",
        "business_type": "CAFE",
        "owner_name": "İlk Sahip",
        "email": "ilk@yenimekan.test",
        "password": "Guvenli!Parola2026",
        "terms_accepted": True,
    }
    first = await api.client.post("/api/v1/registrations", json=payload)
    second = await api.client.post(
        "/api/v1/registrations",
        json={**payload, "owner_name": "İkinci Sahip", "email": "ikinci@yenimekan.test"},
    )

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["business_slug"] == "yeni-mekan"
    assert second.json()["business_slug"] == "yeni-mekan-2"


async def test_public_registration_requires_terms_acceptance(api: ApiContext) -> None:
    response = await api.client.post(
        "/api/v1/registrations",
        json={
            "business_name": "Eksik Onay",
            "business_type": "RESTAURANT",
            "owner_name": "Test Kullanıcı",
            "email": "test@eksikonay.test",
            "password": "Guvenli!Parola2026",
            "terms_accepted": False,
        },
    )

    assert response.status_code == 422
