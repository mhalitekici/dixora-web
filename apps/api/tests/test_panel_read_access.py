from __future__ import annotations

from uuid import UUID, uuid4

from sqlalchemy import select

from app.models import Branch, LoyaltyCustomer, LoyaltyMembership, Role, Tenant, User
from app.security import hash_password, utcnow
from tests.conftest import ApiContext, auth_headers, login, seeded_resources


async def test_manager_reads_loyalty_without_gaining_program_write_access(api: ApiContext) -> None:
    headers = auth_headers(await login(api, username="manager@dixora.test"))
    for path in ("program", "customers", "rewards"):
        response = await api.client.get(f"/api/v1/loyalty/{path}", headers=headers)
        assert response.status_code == 200, response.text
    denied = await api.client.put("/api/v1/loyalty/program", headers=headers, json={})
    assert denied.status_code == 403
    assert (await api.client.get("/api/v1/notifications", headers=headers)).status_code == 403


async def test_loyalty_reader_only_lists_members_in_accessible_branches(api: ApiContext) -> None:
    owner = auth_headers(await login(api))
    resources = await seeded_resources(api, owner)
    branch_id = UUID(resources["tables"][0]["branch_id"])
    program_response = await api.client.put(
        "/api/v1/loyalty/program",
        headers=owner,
        json={
            "name": "Şube sadakati",
            "is_active": True,
            "campaign_type": "VISIT_COUNT",
            "threshold": 5,
            "branch_ids": [str(branch_id)],
            "reward_product_id": resources["burger"]["id"],
        },
    )
    assert program_response.status_code == 200, program_response.text
    async with api.database.session_factory() as db:
        manager = await db.scalar(select(User).where(User.username == "manager@dixora.test"))
        assert manager is not None and manager.tenant_id is not None
        manager.branch_id = branch_id
        other = Branch(tenant_id=manager.tenant_id, name="Diğer şube", slug="other-branch")
        db.add(other)
        await db.flush()
        for index, member_branch in enumerate((branch_id, other.id)):
            customer = LoyaltyCustomer(
                tenant_id=manager.tenant_id,
                first_name=f"Üye {index}",
                email_normalized=f"branch-reader-{index}@example.com",
            )
            db.add(customer)
            await db.flush()
            db.add(
                LoyaltyMembership(
                    tenant_id=manager.tenant_id,
                    branch_id=member_branch,
                    program_id=UUID(program_response.json()["id"]),
                    customer_id=customer.id,
                    public_token_hash=uuid4().hex,
                    lookup_code=f"MEMBER{index}",
                    referral_code=uuid4().hex,
                    consent_at=utcnow(),
                    consent_text_version="test",
                )
            )
        await db.commit()
    manager_headers = auth_headers(await login(api, username="manager@dixora.test"))
    response = await api.client.get("/api/v1/loyalty/customers", headers=manager_headers)
    assert response.status_code == 200, response.text
    assert [item["membership_code"] for item in response.json()] == ["MEMBER0"]


async def test_accountant_reads_shift_history_but_cannot_open_a_till(api: ApiContext) -> None:
    async with api.database.session_factory() as db:
        role = await db.scalar(select(Role).where(Role.code == "ACCOUNTANT"))
        tenant = await db.scalar(select(Tenant).where(Tenant.slug == "dixora-lab"))
        if role is None:
            role = Role(code="ACCOUNTANT", name="Muhasebe", is_system=True)
            db.add(role)
            await db.flush()
        assert tenant is not None
        branch = await db.scalar(select(Branch).where(Branch.tenant_id == tenant.id))
        assert branch is not None
        db.add(
            User(
                tenant_id=tenant.id,
                branch_id=branch.id,
                role_id=role.id,
                username="accountant@dixora.test",
                display_name="Muhasebe",
                password_hash=hash_password("DixoraLab!2026"),
            )
        )
        await db.commit()
    headers = auth_headers(await login(api, username="accountant@dixora.test"))
    history = await api.client.get("/api/v1/shifts/history", headers=headers)
    assert history.status_code == 200, history.text
    denied = await api.client.post("/api/v1/shifts/open", headers=headers, json={})
    assert denied.status_code == 403
    waiter = auth_headers(await login(api, username="waiter@dixora.test"))
    assert (await api.client.get("/api/v1/shifts/history", headers=waiter)).status_code == 403


async def test_active_order_filter_excludes_closed_orders_and_preserves_default_history(
    api: ApiContext,
) -> None:
    from app.models import Order, TableSession
    from app.models.enums import OrderStatus, TableSessionStatus

    headers = auth_headers(await login(api))
    resources = await seeded_resources(api, headers)
    created = []
    for index in range(2):
        response = await api.client.post(
            "/api/v1/orders",
            headers=headers,
            json={
                "table_id": resources["tables"][7 + index]["id"],
                "items": [{"product_id": resources["burger"]["id"], "quantity": "1"}],
                "auto_accept": True,
                "idempotency_key": f"active-filter-order-{index}",
            },
        )
        assert response.status_code == 201, response.text
        created.append(response.json()["id"])
    async with api.database.session_factory() as db:
        paid = await db.get(Order, UUID(created[1]))
        assert paid is not None
        paid.status = OrderStatus.PAID
        await db.commit()
    active = await api.client.get("/api/v1/orders?active_only=true&limit=200", headers=headers)
    assert active.status_code == 200, active.text
    ids = {item["id"] for item in active.json()["items"]}
    assert created[0] in ids and created[1] not in ids
    cashier = await api.client.get(
        "/api/v1/orders?active_only=true&include_paid_open_tables=true&limit=200",
        headers=headers,
    )
    assert cashier.status_code == 200, cashier.text
    assert created[1] in {item["id"] for item in cashier.json()["items"]}
    async with api.database.session_factory() as db:
        paid = await db.get(Order, UUID(created[1]))
        assert paid is not None
        table_session = await db.get(TableSession, paid.table_session_id)
        assert table_session is not None
        table_session.status = TableSessionStatus.CLOSED
        await db.commit()
    cashier = await api.client.get(
        "/api/v1/orders?active_only=true&include_paid_open_tables=true&limit=200",
        headers=headers,
    )
    assert created[1] not in {item["id"] for item in cashier.json()["items"]}
    history = await api.client.get("/api/v1/orders?limit=200", headers=headers)
    assert created[1] in {item["id"] for item in history.json()["items"]}
