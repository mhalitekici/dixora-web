"""Every endpoint is closed unless it was deliberately opened.

Walks the whole route table rather than naming endpoints one by one: the risk
this guards against is a *new* endpoint shipped without auth, and a hand-written
list would never mention the route nobody remembered to protect.
"""

from __future__ import annotations

from typing import Any

from tests.conftest import ApiContext

# Deliberately public, each for a stated reason. Anything not matching one of
# these prefixes must reject an anonymous caller.
PUBLIC_PREFIXES: tuple[tuple[str, str], ...] = (
    ("/api/v1/auth/", "login, refresh and logout cannot require a session"),
    ("/api/v1/system/", "liveness and readiness are polled by the platform"),
    # Mounted at the root, not under the API prefix, so the load balancer and
    # uptime checks can reach them without knowing the version.
    ("/health", "liveness probe"),
    ("/ready", "readiness probe"),
    ("/api/v1/registrations/", "signing a business up happens before any account exists"),
    ("/api/v1/loyalty/public/", "customer-facing loyalty, guarded by its own token"),
    ("/api/v1/qr/public/", "the QR menu is the whole point of being public"),
    ("/api/v1/menu/", "public menu"),
    ("/api/v1/billing/iyzico/", "the payment provider posts here with no session"),
    ("/api/v1/print-bridge/", "authenticated by a shared device key, not a user"),
    ("/api/v1/media/", "signed media URLs"),
    ("/api/v1/docs", "API documentation"),
    ("/api/v1/openapi.json", "API schema"),
    ("/api/v1/redoc", "API documentation"),
    ("/docs/", "API documentation"),
)

# Anonymous callers must never see 2xx. 401/403 are the correct answers; 404,
# 405, 422 and 429 all mean the request died before doing anything, which is
# also acceptable — the point is that nothing succeeds.
REFUSALS = {401, 403, 404, 405, 409, 415, 422, 429, 500, 503}


def _operations(app: Any) -> list[tuple[str, str]]:
    spec = app.openapi()
    return [
        (method.upper(), path)
        for path, item in spec["paths"].items()
        for method in item
        if method in ("get", "post", "put", "patch", "delete")
    ]


def _is_public(path: str) -> bool:
    return any(path.startswith(prefix) for prefix, _ in PUBLIC_PREFIXES)


def _fill(path: str) -> str:
    """Substitute a well-formed but non-existent id for every path parameter."""
    out: list[str] = []
    for segment in path.split("/"):
        if segment.startswith("{") and segment.endswith("}"):
            out.append("11111111-1111-1111-1111-111111111111")
        else:
            out.append(segment)
    return "/".join(out)


async def test_the_route_table_is_not_empty(api: ApiContext) -> None:
    """A guard on the guard: an empty walk would pass everything silently."""
    assert len(_operations(api.app)) > 100


async def test_every_private_endpoint_refuses_an_anonymous_caller(
    api: ApiContext,
) -> None:
    leaked: list[str] = []

    for method, path in _operations(api.app):
        if _is_public(path):
            continue
        response = await api.client.request(method, _fill(path), json={})
        if response.status_code not in REFUSALS:
            leaked.append(f"{method} {path} -> {response.status_code}")

    assert leaked == [], "endpoints reachable without authentication:\n" + "\n".join(
        leaked
    )
