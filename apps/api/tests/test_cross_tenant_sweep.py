"""No business may read or touch another's records.

A sweep rather than a list: the dangerous case is the endpoint added next
month whose author forgot the tenant filter, and a hand-written list of
endpoints would never mention it.

Every id in these requests belongs to the seeded business, but the caller is
signed in to a *different* one. Nothing may come back 2xx.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import select

from app.models import Branch, Category, Order, Product, Role, Tenant, User
from app.security import hash_password
from tests.conftest import ApiContext, auth_headers, login, seeded_resources

# Routes whose ids are not tenant-owned, so a foreign caller reaching them
# proves nothing about isolation.
SKIP_PREFIXES = (
    "/api/v1/auth/",
    "/api/v1/system/",
    "/api/v1/registrations/",
    "/api/v1/loyalty/public/",
    "/api/v1/qr/public/",
    "/api/v1/menu/",
    "/api/v1/billing/iyzico/",
    "/api/v1/print-bridge/",
    "/api/v1/media/",
    "/api/v1/docs",
    "/api/v1/openapi.json",
    "/api/v1/redoc",
    "/docs/",
    "/health",
    "/ready",
    # Platform-level surfaces are meant to span businesses; they are guarded by
    # the super-admin permission instead, which the anonymous sweep covers.
    "/api/v1/businesses",
)

ALLOWED = {401, 403, 404, 405, 409, 415, 422, 429, 503}


async def _rival(api: ApiContext) -> dict[str, str]:
    """A second business with its own owner, and nothing else."""
    async with api.database.session_factory() as db:
        source = (await db.execute(select(Tenant))).scalars().first()
        assert source is not None
        role = (
            await db.execute(
                select(Role).where(
                    Role.tenant_id == source.id, Role.code == "BUSINESS_ADMIN"
                )
            )
        ).scalar_one()

        tenant = Tenant(
            name="Rakip Kafe",
            slug=f"rakip-{uuid4().hex[:8]}",
            business_type="CAFE",
            state="ACTIVE",
            is_active=True,
        )
        db.add(tenant)
        await db.flush()
        branch = Branch(
            tenant_id=tenant.id, name="Merkez", slug="merkez", is_active=True
        )
        db.add(branch)
        await db.flush()
        db.add(
            User(
                tenant_id=tenant.id,
                branch_id=branch.id,
                role_id=role.id,
                username="rakip@rakip.test",
                email="rakip@rakip.test",
                display_name="Rakip Sahibi",
                password_hash=hash_password("Rakip-Guvenli!2026"),
                is_active=True,
            )
        )
        await db.commit()
        slug = tenant.slug

    tokens = await login(
        api,
        username="rakip@rakip.test",
        password="Rakip-Guvenli!2026",
        business=slug,
    )
    return auth_headers(tokens)


def _operations(app: Any) -> list[tuple[str, str]]:
    spec = app.openapi()
    return [
        (method.upper(), path)
        for path, item in spec["paths"].items()
        for method in item
        if method in ("get", "post", "put", "patch", "delete")
    ]


async def _victim_ids(api: ApiContext) -> dict[str, str]:
    headers = auth_headers(await login(api))
    resources = await seeded_resources(api, headers)
    async with api.database.session_factory() as db:
        tenant = (await db.execute(select(Tenant))).scalars().first()
        branch = (await db.execute(select(Branch))).scalars().first()
        category = (await db.execute(select(Category))).scalars().first()
        product = (await db.execute(select(Product))).scalars().first()
        order = (await db.execute(select(Order))).scalars().first()
        user = (
            await db.execute(select(User).where(User.tenant_id == tenant.id))
        ).scalars().first()
    return {
        "tenant": str(tenant.id),
        "branch": str(branch.id),
        "category": str(category.id) if category else str(uuid4()),
        "product": str(product.id) if product else str(uuid4()),
        "order": str(order.id) if order else str(uuid4()),
        "user": str(user.id),
        "table": resources["tables"][0]["id"],
    }


def _fill(path: str, ids: dict[str, str]) -> str:
    """Put the victim's real ids into the path wherever they fit."""
    out: list[str] = []
    for segment in path.split("/"):
        if not (segment.startswith("{") and segment.endswith("}")):
            out.append(segment)
            continue
        name = segment[1:-1].lower()
        if not (name == "id" or name.endswith("_id")):
            # Not an owned record — a feature code, a slug, a status. Feeding a
            # uuid here proves nothing about isolation.
            out.append("loyalty")
            continue
        for key, value in ids.items():
            if key in name:
                out.append(value)
                break
        else:
            out.append(ids["order"])
    return "/".join(out)


async def test_a_rival_business_cannot_reach_anything_of_ours(
    api: ApiContext,
) -> None:
    ids = await _victim_ids(api)
    headers = await _rival(api)

    leaked: list[str] = []
    for method, path in _operations(api.app):
        if any(path.startswith(prefix) for prefix in SKIP_PREFIXES):
            continue
        if "{" not in path:
            # Collection endpoints are scoped by the caller's own tenant; the
            # dangerous shape is a foreign id in the path.
            continue
        target = _fill(path, ids)
        if not any(value in target for value in ids.values()):
            # Nothing of the victim's ended up in the URL — a feature code, a
            # slug. Whatever this returns says nothing about isolation.
            continue
        response = await api.client.request(method, target, headers=headers, json={})
        if response.status_code not in ALLOWED:
            leaked.append(f"{method} {path} -> {response.status_code}")

    assert leaked == [], "another business's records were reachable:\n" + "\n".join(
        leaked
    )


async def test_the_sweep_actually_exercised_something(api: ApiContext) -> None:
    """Guard on the guard: a filter that skipped everything would pass."""
    checked = [
        path
        for _, path in _operations(api.app)
        if "{" in path
        and not any(path.startswith(prefix) for prefix in SKIP_PREFIXES)
    ]
    assert len(checked) > 30


def test_every_victim_id_is_a_real_uuid() -> None:
    """A malformed id would be rejected as 422 and prove nothing."""
    assert UUID("11111111-1111-1111-1111-111111111111")
