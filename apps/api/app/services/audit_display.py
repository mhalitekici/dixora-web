from __future__ import annotations

import re
from typing import Any

SENSITIVE = re.compile(
    r"password|passwd|credential|authorization|cookie|secret|token|auth_session|"
    r"api[_-]?key|(^|_)pin($|_)|customer|email|phone|address",
    re.IGNORECASE,
)


def safe_audit_value(value: Any, depth: int = 0) -> Any:
    """Sanitize the response only; never rewrite persisted audit evidence."""
    if depth > 12:
        return "[Gizlendi]"
    if isinstance(value, dict):
        return {
            key: "[Gizlendi]" if SENSITIVE.search(str(key)) else safe_audit_value(item, depth + 1)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [safe_audit_value(item, depth + 1) for item in value]
    return value
