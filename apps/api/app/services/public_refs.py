from __future__ import annotations

import base64
import hashlib
import hmac
from typing import Literal
from uuid import UUID

from app.config import Settings

PublicReferenceKind = Literal[
    "category",
    "product",
    "modifier_group",
    "modifier",
    "request",
]

_PREFIXES: dict[PublicReferenceKind, str] = {
    "category": "c",
    "product": "p",
    "modifier_group": "g",
    "modifier": "m",
    "request": "r",
}


def public_reference(
    settings: Settings,
    *,
    tenant_id: UUID,
    kind: PublicReferenceKind,
    resource_id: UUID,
) -> str:
    message = b"\0".join((tenant_id.bytes, kind.encode("ascii"), resource_id.bytes))
    digest = hmac.new(
        settings.jwt_secret.get_secret_value().encode("utf-8"),
        message,
        hashlib.sha256,
    ).digest()[:18]
    token = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return f"{_PREFIXES[kind]}_{token}"
