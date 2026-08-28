from __future__ import annotations

from functools import lru_cache
from typing import Literal, Self
from urllib.parse import SplitResult, urlsplit

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="DIXORA_",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "Dixora API"
    environment: Literal["development", "test", "staging", "production"] = "development"
    api_prefix: str = "/api/v1"
    database_url: str = "postgresql+asyncpg://dixora:dixora@localhost:5432/dixora"
    # Connection ceiling per worker is db_pool_size + db_max_overflow, so the
    # deployment total is (db_pool_size + db_max_overflow) x API_WORKERS. That
    # product MUST stay under PostgreSQL's max_connections or requests fail with
    # "sorry, too many clients already" — a load test at 400 concurrent users hit
    # exactly this. Defaults are sized for 4 workers against the default limit of
    # 100: 4 x (5 + 10) = 60, leaving headroom for migrations and psql sessions.
    db_pool_size: int = Field(default=5, ge=1, le=100)
    db_max_overflow: int = Field(default=10, ge=0, le=200)
    db_pool_timeout: float = Field(default=30.0, ge=1.0, le=300.0)
    # Recycle below typical proxy/database idle timeouts so pooled connections
    # are never handed out already dead.
    db_pool_recycle: int = Field(default=1800, ge=60, le=86_400)
    # Cross-process realtime fan-out. Without it the API is limited to a single
    # worker, because a WebSocket lives in exactly one process.
    redis_url: str | None = None
    # Error reporting. Absent DSN disables Sentry entirely, which is the normal
    # state for local development and tests.
    sentry_dsn: SecretStr | None = None
    sentry_release: str | None = Field(default=None, max_length=120)
    sentry_traces_sample_rate: float = Field(default=0.0, ge=0.0, le=1.0)
    jwt_secret: SecretStr = Field(
        default=SecretStr("development-only-change-this-secret-key"),
    )
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = Field(default=15, ge=1, le=1440)
    refresh_token_days: int = Field(default=30, ge=1, le=90)
    session_refresh_token_hours: int = Field(default=24, ge=1, le=168)
    login_rate_limit_attempts: int = Field(default=5, ge=1, le=100)
    login_rate_limit_window_minutes: int = Field(default=15, ge=1, le=1440)
    pin_login_enabled: bool = False
    trusted_device_days: int = Field(default=180, ge=1, le=365)
    loyalty_verification_rate_limit_attempts: int = Field(default=5, ge=1, le=100)
    loyalty_verification_rate_limit_window_minutes: int = Field(
        default=15, ge=1, le=1440
    )
    loyalty_verification_ip_rate_limit_attempts: int = Field(default=20, ge=1, le=1000)
    loyalty_verification_tenant_daily_limit: int = Field(default=1000, ge=1, le=100_000)
    loyalty_verification_provider: Literal["development", "netgsm", "disabled"] = (
        "development"
    )
    netgsm_usercode: str | None = Field(default=None, max_length=64)
    netgsm_password: SecretStr | None = None
    netgsm_msgheader: str | None = Field(default=None, min_length=3, max_length=11)
    netgsm_timeout_seconds: float = Field(default=8.0, ge=1.0, le=30.0)
    # Transactional email (loyalty enrolment codes, membership cards, business
    # registration verification). "development" only logs, and is rejected in
    # production so a customer is never left waiting for a code that was never
    # actually sent.
    email_provider: Literal["development", "resend", "smtp", "disabled"] = "development"
    email_from: str = Field(default="Dixora <no-reply@dixoratech.com>", max_length=255)
    smtp_host: str = Field(default="localhost", min_length=1, max_length=255)
    smtp_port: int = Field(default=587, ge=1, le=65535)
    smtp_username: str | None = Field(default=None, max_length=255)
    smtp_password: SecretStr | None = None
    smtp_use_starttls: bool = True
    smtp_use_ssl: bool = False
    smtp_timeout_seconds: float = Field(default=15.0, ge=1.0, le=120.0)
    resend_api_key: SecretStr | None = None

    # Payment provider. Sandbox by default so a misconfigured deployment
    # cannot accidentally charge a real card.
    payment_provider: Literal["none", "iyzico"] = "none"
    iyzico_api_key: SecretStr | None = None
    iyzico_secret_key: SecretStr | None = None
    iyzico_base_url: str = "sandbox-api.iyzipay.com"
    email_timeout_seconds: float = Field(default=15.0, ge=1.0, le=120.0)
    cors_origins: list[str] = ["http://localhost:3000"]
    print_bridge_key: SecretStr = Field(default=SecretStr("development-print-bridge"))
    s3_endpoint: str = "http://localhost:9000"
    s3_access_key: str = Field(default="dixora", min_length=1, max_length=255)
    s3_secret_key: SecretStr = Field(default=SecretStr("change-me-local-minio"))
    s3_bucket: str = Field(
        default="dixora-media",
        pattern=r"^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$",
    )
    s3_region: str = Field(default="us-east-1", min_length=1, max_length=100)
    media_public_base_url: str = "http://localhost:8000/api/v1/media"
    media_max_upload_bytes: int = Field(default=5 * 1024 * 1024, ge=1024, le=25 * 1024 * 1024)
    media_min_dimension: int = Field(default=64, ge=1, le=4096)
    media_max_dimension: int = Field(default=8192, ge=64, le=16384)
    media_max_pixels: int = Field(default=36_000_000, ge=4096, le=100_000_000)
    auto_create_schema: bool = False
    dev_seed_enabled: bool = False
    log_level: str = "INFO"
    sql_echo: bool = False

    @field_validator("database_url")
    @classmethod
    def normalize_database_url(cls, value: str) -> str:
        if value.startswith("postgresql://"):
            return value.replace("postgresql://", "postgresql+asyncpg://", 1)
        if value.startswith("sqlite://") and not value.startswith("sqlite+aiosqlite://"):
            return value.replace("sqlite://", "sqlite+aiosqlite://", 1)
        return value

    @field_validator("jwt_secret")
    @classmethod
    def validate_secret(cls, value: SecretStr, info: object) -> SecretStr:
        if len(value.get_secret_value()) < 32:
            raise ValueError("JWT secret must contain at least 32 characters")
        return value

    @field_validator(
        "netgsm_usercode",
        "netgsm_password",
        "netgsm_msgheader",
        mode="before",
    )
    @classmethod
    def normalize_optional_netgsm_values(cls, value: object) -> object:
        if isinstance(value, str):
            normalized = value.strip()
            return normalized or None
        return value

    @model_validator(mode="after")
    def reject_unsafe_production_defaults(self) -> Self:
        s3_url = _validate_s3_endpoint(self.s3_endpoint)
        media_url = _validate_media_public_base_url(self.media_public_base_url)
        if self.media_min_dimension > self.media_max_dimension:
            raise ValueError("Media minimum dimension must not exceed maximum dimension")
        if self.media_min_dimension**2 > self.media_max_pixels:
            raise ValueError("Media maximum pixels must allow the configured minimum dimensions")
        if self.loyalty_verification_provider == "netgsm":
            password = (
                self.netgsm_password.get_secret_value().strip()
                if self.netgsm_password is not None
                else ""
            )
            if not self.netgsm_usercode or not password or not self.netgsm_msgheader:
                raise ValueError(
                    "Netgsm verification requires DIXORA_NETGSM_USERCODE, "
                    "DIXORA_NETGSM_PASSWORD and DIXORA_NETGSM_MSGHEADER"
                )
            if not self.netgsm_msgheader.isascii() or not self.netgsm_msgheader.isalnum():
                raise ValueError("DIXORA_NETGSM_MSGHEADER must be 3-11 ASCII letters or digits")
        if self.email_provider == "resend":
            key = (
                self.resend_api_key.get_secret_value().strip()
                if self.resend_api_key is not None
                else ""
            )
            if not key:
                raise ValueError("Resend email requires DIXORA_RESEND_API_KEY")
        if self.environment != "production":
            return self
        if self.loyalty_verification_provider == "development":
            raise ValueError("Development phone verification is not allowed in production")
        if self.email_provider == "development":
            raise ValueError(
                "Development email is not allowed in production; set "
                "DIXORA_EMAIL_PROVIDER to 'smtp' or 'disabled'"
            )
        if self.email_provider == "smtp" and not self.smtp_host.strip():
            raise ValueError("SMTP email requires DIXORA_SMTP_HOST")
        try:
            database_url = make_url(self.database_url)
        except ArgumentError as exc:
            raise ValueError("DIXORA_DATABASE_URL is invalid") from exc
        database_backend = database_url.get_backend_name()
        database_username = (database_url.username or "").lower()
        database_password = (database_url.password or "").lower()
        if database_backend == "sqlite":
            raise ValueError("SQLite is not allowed in production")
        if (
            "change-me" in database_username
            or "change-me" in database_password
            or (database_username == "dixora" and database_password == "dixora")
        ):
            raise ValueError("Production requires generated database credentials")
        jwt_secret = self.jwt_secret.get_secret_value().lower()
        print_key = self.print_bridge_key.get_secret_value().lower()
        s3_secret = self.s3_secret_key.get_secret_value().lower()
        if "development" in jwt_secret or "change-me" in jwt_secret:
            raise ValueError("Production requires a generated DIXORA_JWT_SECRET")
        if "development" in print_key or "change-me" in print_key:
            raise ValueError("Production requires a generated DIXORA_PRINT_BRIDGE_KEY")
        if any(item in s3_secret for item in {"change-me", "development", "local-minio"}):
            raise ValueError("Production requires a generated DIXORA_S3_SECRET_KEY")
        if self.s3_access_key.lower() in {"dixora", "minioadmin", "change-me"}:
            raise ValueError("Production requires a dedicated DIXORA_S3_ACCESS_KEY")
        if s3_url.hostname in {"localhost", "127.0.0.1", "::1"}:
            raise ValueError("Production DIXORA_S3_ENDPOINT must not target localhost")
        if media_url.scheme != "https":
            raise ValueError("DIXORA_MEDIA_PUBLIC_BASE_URL must use HTTPS in production")
        if self.dev_seed_enabled:
            raise ValueError("DIXORA_DEV_SEED_ENABLED must be false in production")
        if self.auto_create_schema:
            raise ValueError("DIXORA_AUTO_CREATE_SCHEMA must be false in production")
        if "*" in self.cors_origins:
            raise ValueError("Wildcard CORS origins are not allowed in production")
        return self


def _validate_s3_endpoint(value: str) -> SplitResult:
    parsed = urlsplit(value if "://" in value else f"http://{value}")
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.netloc
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("DIXORA_S3_ENDPOINT must be an HTTP(S) origin without a path")
    return parsed


def _validate_media_public_base_url(value: str) -> SplitResult:
    parsed = urlsplit(value)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.netloc
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("DIXORA_MEDIA_PUBLIC_BASE_URL must be an absolute HTTP(S) URL")
    return parsed


@lru_cache
def get_settings() -> Settings:
    return Settings()
