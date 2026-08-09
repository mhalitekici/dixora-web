from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.config import Settings

_SAFE_DATABASE_URL = (
    "postgresql+asyncpg://dixora_prod:"
    "878e825a3cdb491eac0d9b73cb4057ef@database.internal:5432/dixora"
)


def test_production_rejects_demo_mode_and_placeholder_secrets() -> None:
    with pytest.raises(ValidationError):
        Settings(
            environment="production",
            jwt_secret="change-me-with-at-least-32-random-characters",
            print_bridge_key="change-me-local-print-bridge",
            dev_seed_enabled=True,
        )


def test_production_accepts_generated_secrets_and_safe_flags() -> None:
    settings = Settings(
        environment="production",
        database_url=_SAFE_DATABASE_URL,
        jwt_secret="2e786a9c9c9b446aa7f62d49aabde1d9d9ad2c66231248e1",
        print_bridge_key="62ef2ce5a75049cc923b8d1456bfe13cfb87ccac",
        s3_endpoint="https://objects.dixora.example",
        s3_access_key="dixora-production-media",
        s3_secret_key="1df4b2eb5fb9487485294e5cd5428be5f1c1982d",
        media_public_base_url="https://api.dixora.example/api/v1/media",
        dev_seed_enabled=False,
        auto_create_schema=False,
        cors_origins=["https://app.dixora.example"],
        loyalty_verification_provider="disabled",
        translation_provider="disabled",
    )
    assert settings.environment == "production"


def test_production_rejects_development_phone_verification() -> None:
    with pytest.raises(ValidationError):
        Settings(
            environment="production",
            database_url=_SAFE_DATABASE_URL,
            jwt_secret="2e786a9c9c9b446aa7f62d49aabde1d9d9ad2c66231248e1",
            print_bridge_key="62ef2ce5a75049cc923b8d1456bfe13cfb87ccac",
            s3_endpoint="https://objects.dixora.example",
            s3_access_key="dixora-production-media",
            s3_secret_key="1df4b2eb5fb9487485294e5cd5428be5f1c1982d",
            media_public_base_url="https://api.dixora.example/api/v1/media",
            dev_seed_enabled=False,
            auto_create_schema=False,
            cors_origins=["https://app.dixora.example"],
        )


def test_netgsm_provider_requires_complete_credentials() -> None:
    with pytest.raises(ValidationError):
        Settings(loyalty_verification_provider="netgsm")


def test_blank_optional_netgsm_environment_values_are_ignored() -> None:
    settings = Settings(
        netgsm_usercode=" ",
        netgsm_password="",
        netgsm_msgheader="",
    )

    assert settings.netgsm_usercode is None
    assert settings.netgsm_password is None
    assert settings.netgsm_msgheader is None


def test_production_rejects_local_media_credentials_and_public_http_url() -> None:
    with pytest.raises(ValidationError):
        Settings(
            environment="production",
            database_url=_SAFE_DATABASE_URL,
            jwt_secret="2e786a9c9c9b446aa7f62d49aabde1d9d9ad2c66231248e1",
            print_bridge_key="62ef2ce5a75049cc923b8d1456bfe13cfb87ccac",
            s3_endpoint="http://localhost:9000",
            s3_access_key="dixora",
            s3_secret_key="change-me-local-minio",
            media_public_base_url="http://localhost:8000/api/v1/media",
            dev_seed_enabled=False,
            auto_create_schema=False,
            cors_origins=["https://app.dixora.example"],
        )


@pytest.mark.parametrize(
    "database_url",
    [
        "sqlite+aiosqlite:///production.db",
        "postgresql+asyncpg://dixora:dixora@database.internal:5432/dixora",
        ("postgresql+asyncpg://dixora:change-me-local-postgres@database.internal:5432/dixora"),
    ],
)
def test_production_rejects_unsafe_database_configuration(database_url: str) -> None:
    with pytest.raises(ValidationError):
        Settings(
            environment="production",
            database_url=database_url,
            jwt_secret="2e786a9c9c9b446aa7f62d49aabde1d9d9ad2c66231248e1",
            print_bridge_key="62ef2ce5a75049cc923b8d1456bfe13cfb87ccac",
            s3_endpoint="https://objects.dixora.example",
            s3_access_key="dixora-production-media",
            s3_secret_key="1df4b2eb5fb9487485294e5cd5428be5f1c1982d",
            media_public_base_url="https://api.dixora.example/api/v1/media",
            dev_seed_enabled=False,
            auto_create_schema=False,
            cors_origins=["https://app.dixora.example"],
        )
