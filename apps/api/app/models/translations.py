from __future__ import annotations

from uuid import UUID

from sqlalchemy import ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class ContentTranslation(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Cached machine translation of one tenant-owned content field.

    ``source_hash`` is the fingerprint of the text that was translated. When a
    business edits a product name the hash stops matching and the row is
    treated as stale, so edits invalidate translations without needing an
    explicit cache-busting step anywhere in the catalog write paths.
    """

    __tablename__ = "content_translations"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "entity_type",
            "entity_id",
            "field",
            "locale",
            name="uq_content_translation_scope",
        ),
        Index("ix_content_translations_lookup", "tenant_id", "locale", "entity_type"),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    entity_type: Mapped[str] = mapped_column(String(40), nullable=False)
    entity_id: Mapped[UUID] = mapped_column(nullable=False)
    field: Mapped[str] = mapped_column(String(40), nullable=False)
    locale: Mapped[str] = mapped_column(String(12), nullable=False)
    source_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    translated_text: Mapped[str] = mapped_column(Text, nullable=False)
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
