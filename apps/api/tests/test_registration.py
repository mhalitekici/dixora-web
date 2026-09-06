from datetime import datetime

from sqlalchemy import select

from app.models import AuditLog, User
from tests.conftest import ApiContext


async def _register_business(api, payload: dict):
    """Sign up through the two-step, email-verified flow."""
    started = await api.client.post("/api/v1/registrations/start", json=payload)
    if started.status_code != 201:
        return started
    body = started.json()
    return await api.client.post(
        "/api/v1/registrations/confirm",
        json={"verification_id": body["verification_id"], "code": body["development_code"]},
    )


async def test_public_registration_creates_trial_business_and_owner(api: ApiContext) -> None:
    payload = {
        "business_name": "Kırmızı Masa Restoran",
        "business_type": "RESTAURANT",
        "owner_name": "Ayşe Yılmaz",
        "email": "ayse@kirmizimasa.test",
        "phone": "+90 555 000 11 22",
        "password": "Guvenli!Parola2026",
        "terms_accepted": True,
        "privacy_notice_acknowledged": True,
    }

    response = await _register_business(api, payload)
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
        "phone": "+90 555 000 11 22",
        "password": "Guvenli!Parola2026",
        "terms_accepted": True,
        "privacy_notice_acknowledged": True,
    }
    first = await _register_business(api, payload)
    second = await _register_business(
        api,
        {**payload, "owner_name": "İkinci Sahip", "email": "ikinci@yenimekan.test"},
    )

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["business_slug"] == "yeni-mekan"
    assert second.json()["business_slug"] == "yeni-mekan-2"


async def test_public_registration_requires_terms_acceptance(api: ApiContext) -> None:
    response = await api.client.post(
        "/api/v1/registrations/start",
        json={
            "business_name": "Eksik Onay",
            "business_type": "RESTAURANT",
            "owner_name": "Test Kullanıcı",
            "email": "test@eksikonay.test",
            "phone": "+90 555 000 11 22",
            "password": "Guvenli!Parola2026",
            "terms_accepted": False,
        },
    )

    assert response.status_code == 422


async def test_public_registration_requires_privacy_notice_acknowledgement(
    api: ApiContext,
) -> None:
    """KVKK aydınlatma metni is its own required checkbox, not bundled into terms."""
    response = await api.client.post(
        "/api/v1/registrations/start",
        json={
            "business_name": "Eksik KVKK",
            "business_type": "RESTAURANT",
            "owner_name": "Test Kullanıcı",
            "email": "test@eksikkvkk.test",
            "phone": "+90 555 000 11 22",
            "password": "Guvenli!Parola2026",
            "terms_accepted": True,
            "privacy_notice_acknowledged": False,
        },
    )

    assert response.status_code == 422


async def test_marketing_consent_defaults_to_off_and_is_never_required(
    api: ApiContext,
) -> None:
    """The optional checkbox must not block signup when it is left unticked."""
    payload = {
        "business_name": "Sessiz İşletme",
        "business_type": "CAFE",
        "owner_name": "Sessiz Sahip",
        "email": "sessiz@sessizisletme.test",
        "phone": "+90 555 000 11 22",
        "password": "Guvenli!Parola2026",
        "terms_accepted": True,
        "privacy_notice_acknowledged": True,
        # marketing_consent deliberately omitted, like an unticked checkbox.
    }

    response = await _register_business(api, payload)
    assert response.status_code == 201, response.text

    async with api.database.session_factory() as db:
        owner = (
            await db.execute(select(User).where(User.email == payload["email"]))
        ).scalar_one()
        assert owner.marketing_consent is False


async def test_marketing_consent_is_recorded_when_the_applicant_opts_in(
    api: ApiContext,
) -> None:
    payload = {
        "business_name": "Meraklı İşletme",
        "business_type": "CAFE",
        "owner_name": "Meraklı Sahip",
        "email": "merakli@meraklisletme.test",
        "phone": "+90 555 000 11 22",
        "password": "Guvenli!Parola2026",
        "terms_accepted": True,
        "privacy_notice_acknowledged": True,
        "privacy_notice_version": "2026-08-09-v1",
        "marketing_consent": True,
    }

    response = await _register_business(api, payload)
    assert response.status_code == 201, response.text

    async with api.database.session_factory() as db:
        owner = (
            await db.execute(select(User).where(User.email == payload["email"]))
        ).scalar_one()
        assert owner.marketing_consent is True

        entry = (
            await db.execute(
                select(AuditLog).where(
                    AuditLog.action == "registration.created",
                    AuditLog.resource_id == str(owner.tenant_id),
                )
            )
        ).scalar_one()
        assert entry.new_value["marketing_consent"] is True
        assert entry.new_value["privacy_notice_acknowledged"] is True
        assert entry.new_value["privacy_notice_version"] == "2026-08-09-v1"
