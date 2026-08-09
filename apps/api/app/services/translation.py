from __future__ import annotations

import hashlib
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ContentTranslation

# The language every business authors its catalog in. Translations are only ever
# stored *away* from this, never back into it.
SOURCE_LOCALE = "tr"
SUPPORTED_LOCALES: tuple[str, ...] = ("tr", "en", "de", "ru", "ar")

LOCALE_NAMES: dict[str, str] = {
    "tr": "Türkçe",
    "en": "English",
    "de": "Deutsch",
    "ru": "Русский",
    "ar": "العربية",
}

# Only fields a business would reasonably want shown in another language. Prices,
# codes and internal fields are never translated.
TRANSLATABLE_FIELDS: dict[str, frozenset[str]] = {
    "product": frozenset({"name", "description"}),
    "category": frozenset({"name", "description"}),
    "modifier_group": frozenset({"name"}),
    "modifier": frozenset({"name"}),
}

# Written on every row so a future import/tooling path stays distinguishable.
MANUAL_PROVIDER = "manual"


def is_supported_locale(locale: str | None) -> bool:
    return locale in SUPPORTED_LOCALES


def is_translatable(entity_type: str, field: str) -> bool:
    return field in TRANSLATABLE_FIELDS.get(entity_type, frozenset())


def source_fingerprint(text: str) -> str:
    return hashlib.sha256(text.strip().encode("utf-8")).hexdigest()


@dataclass(frozen=True, slots=True)
class TranslationKey:
    entity_type: str
    entity_id: UUID
    field: str
    text: str


async def translate_fields(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    locale: str,
    keys: list[TranslationKey],
) -> dict[tuple[str, UUID, str], str]:
    """Return the business's own translations for the given fields.

    Anything the business has not translated simply falls back to the source
    text at the call site, so a partially translated menu stays coherent rather
    than showing gaps. This is a single indexed read — no external service sits
    in the path of a customer loading a menu.
    """
    resolved: dict[tuple[str, UUID, str], str] = {}
    if locale == SOURCE_LOCALE or not is_supported_locale(locale):
        return resolved

    wanted = [key for key in keys if key.text and key.text.strip()]
    if not wanted:
        return resolved

    entity_ids = {key.entity_id for key in wanted}
    rows = (
        (
            await db.execute(
                select(ContentTranslation).where(
                    ContentTranslation.tenant_id == tenant_id,
                    ContentTranslation.locale == locale,
                    ContentTranslation.entity_id.in_(entity_ids),
                )
            )
        )
        .scalars()
        .all()
    )
    stored = {(row.entity_type, row.entity_id, row.field): row for row in rows}

    for key in wanted:
        row = stored.get((key.entity_type, key.entity_id, key.field))
        if row is not None and row.translated_text.strip():
            resolved[(key.entity_type, key.entity_id, key.field)] = row.translated_text
    return resolved


async def save_translation(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    entity_type: str,
    entity_id: UUID,
    field: str,
    locale: str,
    translated_text: str,
    source_text: str,
) -> ContentTranslation | None:
    """Create, update or clear one business-authored translation.

    Returns ``None`` when the text was blanked out, which removes the row so the
    menu falls back to the original language for that field.
    """
    existing = (
        await db.execute(
            select(ContentTranslation).where(
                ContentTranslation.tenant_id == tenant_id,
                ContentTranslation.entity_type == entity_type,
                ContentTranslation.entity_id == entity_id,
                ContentTranslation.field == field,
                ContentTranslation.locale == locale,
            )
        )
    ).scalar_one_or_none()

    value = translated_text.strip()
    if not value:
        if existing is not None:
            await db.delete(existing)
        return None

    if existing is not None:
        existing.translated_text = value
        existing.source_hash = source_fingerprint(source_text)
        existing.provider = MANUAL_PROVIDER
        return existing

    row = ContentTranslation(
        tenant_id=tenant_id,
        entity_type=entity_type,
        entity_id=entity_id,
        field=field,
        locale=locale,
        source_hash=source_fingerprint(source_text),
        translated_text=value,
        provider=MANUAL_PROVIDER,
    )
    db.add(row)
    return row
