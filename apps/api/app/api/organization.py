from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy import func, select, update
from sqlalchemy.orm import selectinload

from app.dependencies import (
    DbSession,
    Identity,
    require_branch,
    require_permissions,
    require_record_branch,
    require_tenant,
)
from app.errors import DomainError
from app.models import (
    AuthSession,
    Branch,
    Permission,
    PreparationStation,
    Role,
    Subscription,
    SubscriptionPlan,
    User,
    UserBranchMembership,
)
from app.rbac import ASSIGNABLE_ROLE_PRESETS, ensure_tenant_role_presets
from app.schemas import (
    BranchArchiveRequest,
    BranchCreate,
    BranchOut,
    BranchPricingOut,
    BranchUpdate,
    BranchUsageOut,
    PasswordChange,
    PinChange,
    RoleCreate,
    RoleDetailOut,
    RoleUpdate,
    UserBranchAccessOut,
    UserBranchAccessUpdate,
    UserCreate,
    UserOut,
    UserUpdate,
)
from app.security import hash_password, utcnow
from app.services.audit import add_audit_log
from app.services.branch_setup import provision_branch
from app.services.pricing import branch_pricing_for_tenant

router = APIRouter(tags=["organization"])
SettingsManager = Annotated[Identity, Depends(require_permissions("settings.manage"))]
UserManager = Annotated[Identity, Depends(require_permissions("users.manage"))]
RoleManager = Annotated[Identity, Depends(require_permissions("roles.manage"))]


def role_output(role: Role) -> RoleDetailOut:
    return RoleDetailOut(
        id=role.id,
        tenant_id=role.tenant_id,
        code=role.code,
        name=role.name,
        is_system=role.is_system,
        is_active=role.is_active,
        permissions=sorted(permission.code for permission in role.permissions),
    )


def user_output(user: User) -> UserOut:
    if user.tenant_id is None:
        raise ValueError("Business user must have a tenant")
    return UserOut(
        id=user.id,
        tenant_id=user.tenant_id,
        branch_id=user.branch_id,
        preparation_station_id=user.preparation_station_id,
        role_id=user.role_id,
        role=user.role.code,
        username=user.username,
        email=user.email,
        phone=user.phone,
        display_name=user.display_name,
        is_active=user.is_active,
        has_pin=user.pin_hash is not None,
        permissions=sorted(permission.code for permission in user.role.permissions),
    )


async def _tenant_role(db: DbSession, tenant_id: UUID, role_id: UUID) -> Role:
    role = (
        await db.execute(
            select(Role)
            .where(Role.id == role_id, Role.tenant_id == tenant_id, Role.is_active.is_(True))
            .options(selectinload(Role.permissions))
        )
    ).scalar_one_or_none()
    if role is None:
        raise DomainError("role_not_found", "Role not found", status_code=404)
    return role


async def _tenant_branch(
    db: DbSession,
    identity: Identity,
    branch_id: UUID | None,
) -> Branch | None:
    """Load a branch of this business that the caller is allowed to act on.

    Access is checked here rather than at each call site because every route
    that names a branch by id needs the same answer, and the one that forgets to
    ask is how a manager pinned to one branch ends up renaming another's.
    """
    if branch_id is None:
        return None
    branch = (
        await db.execute(
            select(Branch).where(
                Branch.id == branch_id, Branch.tenant_id == require_tenant(identity)
            )
        )
    ).scalar_one_or_none()
    if branch is None:
        raise DomainError("branch_not_found", "Branch not found", status_code=404)
    require_record_branch(identity, branch.id)
    return branch


def _assert_user_in_scope(identity: Identity, user: User) -> None:
    """A branch-pinned manager may only act on staff from branches they cover.

    A user with no branch spans the whole business, so only a caller who also
    spans it may touch them — otherwise a manager pinned to one branch could
    reset the owner's password from their own employee screen.
    """
    if user.branch_id is None:
        if not identity.has_all_branch_access:
            raise DomainError(
                "branch_forbidden",
                "You do not have access to this employee",
                status_code=403,
            )
        return
    require_record_branch(identity, user.branch_id)


async def _tenant_station(
    db: DbSession,
    tenant_id: UUID,
    branch_id: UUID | None,
    station_id: UUID | None,
) -> PreparationStation | None:
    if station_id is None:
        return None
    if branch_id is None:
        raise DomainError(
            "branch_required_for_station",
            "A branch is required when assigning a preparation station",
            status_code=422,
        )
    station = (
        await db.execute(
            select(PreparationStation).where(
                PreparationStation.id == station_id,
                PreparationStation.tenant_id == tenant_id,
                PreparationStation.branch_id == branch_id,
                PreparationStation.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if station is None:
        raise DomainError("station_not_found", "Preparation station not found", status_code=404)
    return station


async def _validate_employee_scope(
    db: DbSession,
    *,
    identity: Identity,
    tenant_id: UUID,
    role: Role,
    branch_id: UUID | None,
    station_id: UUID | None,
) -> None:
    if role.code not in ASSIGNABLE_ROLE_PRESETS:
        raise DomainError(
            "role_not_assignable",
            "Only fixed employee role presets can be assigned",
            status_code=422,
        )
    if role.code == "BUSINESS_ADMIN":
        if branch_id is not None or station_id is not None:
            raise DomainError(
                "admin_scope_must_be_global",
                "Administrators operate across all branches and cannot be station-scoped",
                status_code=422,
            )
        return
    if branch_id is None:
        raise DomainError(
            "employee_branch_required",
            "This employee role requires a branch",
            status_code=422,
        )
    await _tenant_branch(db, identity, branch_id)
    if role.code == "KITCHEN":
        if station_id is None:
            raise DomainError(
                "kitchen_station_required",
                "Kitchen employees require a preparation station",
                status_code=422,
            )
        await _tenant_station(db, tenant_id, branch_id, station_id)
    elif station_id is not None:
        raise DomainError(
            "station_not_allowed_for_role",
            "Only kitchen employees can be assigned to a preparation station",
            status_code=422,
        )


async def _branch_usage(db: DbSession, tenant_id: UUID) -> BranchUsageOut:
    plan = (
        await db.execute(
            select(SubscriptionPlan)
            .join(Subscription, Subscription.plan_id == SubscriptionPlan.id)
            .where(Subscription.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    total = (
        await db.execute(select(func.count(Branch.id)).where(Branch.tenant_id == tenant_id))
    ).scalar_one()
    active = (
        await db.execute(
            select(func.count(Branch.id)).where(
                Branch.tenant_id == tenant_id,
                Branch.is_active.is_(True),
            )
        )
    ).scalar_one()
    maximum = plan.max_branches if plan else None
    return BranchUsageOut(
        plan_name=plan.name if plan else None,
        max_branches=maximum,
        active_branches=active,
        total_branches=total,
        can_create=maximum is None or active < maximum,
    )


@router.get("/branches", response_model=list[BranchOut])
async def list_branches(identity: SettingsManager, db: DbSession) -> list[BranchOut]:
    predicates = [Branch.tenant_id == require_tenant(identity)]
    if not identity.has_all_branch_access:
        # The branch switcher is built from this list, so a pinned user must see
        # exactly the branches they may act in and no more.
        predicates.append(Branch.id.in_(identity.accessible_branch_ids))
    rows = (
        (await db.execute(select(Branch).where(*predicates).order_by(Branch.name)))
        .scalars()
        .all()
    )
    return [BranchOut.model_validate(branch) for branch in rows]


@router.get("/branches/usage", response_model=BranchUsageOut)
async def branch_usage(identity: SettingsManager, db: DbSession) -> BranchUsageOut:
    return await _branch_usage(db, require_tenant(identity))


@router.post("/branches", response_model=BranchOut, status_code=status.HTTP_201_CREATED)
async def create_branch(
    payload: BranchCreate,
    identity: SettingsManager,
    db: DbSession,
) -> BranchOut:
    tenant_id = require_tenant(identity)
    usage = await _branch_usage(db, tenant_id)
    if not usage.can_create:
        raise DomainError(
            "branch_limit_reached",
            "The subscription branch limit has been reached",
            status_code=409,
            details={
                "plan_name": usage.plan_name,
                "max_branches": usage.max_branches,
                "active_branches": usage.active_branches,
            },
        )
    duplicate = (
        await db.execute(
            select(Branch.id).where(Branch.tenant_id == tenant_id, Branch.slug == payload.slug)
        )
    ).scalar_one_or_none()
    if duplicate is not None:
        raise DomainError("branch_slug_conflict", "Branch slug is already in use", status_code=409)
    branch = Branch(tenant_id=tenant_id, **payload.model_dump())
    db.add(branch)
    await db.flush()
    # An empty branch cannot take an order: tickets are grouped by station and it
    # has none, and every inventory-tracked product is refused for want of a
    # recipe. Both are copied from a branch that already works.
    setup = await provision_branch(db, tenant_id=tenant_id, branch=branch)
    add_audit_log(
        db,
        identity=identity,
        action="branch.created",
        resource_type="branch",
        resource_id=branch.id,
        branch_id=branch.id,
        new_value={"name": branch.name, "slug": branch.slug, "setup": setup.as_dict()},
    )
    await db.commit()
    return BranchOut.model_validate(branch)


@router.patch("/branches/{branch_id}", response_model=BranchOut)
async def update_branch(
    branch_id: UUID,
    payload: BranchUpdate,
    identity: SettingsManager,
    db: DbSession,
) -> BranchOut:
    branch = await _tenant_branch(db, identity, branch_id)
    assert branch is not None
    previous = {"name": branch.name, "is_active": branch.is_active}
    changes = payload.model_dump(exclude_unset=True)
    requested_slug = changes.get("slug")
    if requested_slug is not None and requested_slug != branch.slug:
        duplicate = (
            await db.execute(
                select(Branch.id).where(
                    Branch.tenant_id == branch.tenant_id,
                    Branch.slug == requested_slug,
                    Branch.id != branch.id,
                )
            )
        ).scalar_one_or_none()
        if duplicate is not None:
            raise DomainError(
                "branch_slug_conflict",
                "Branch slug is already in use",
                status_code=409,
            )
    if changes.get("is_active") is False and branch.is_active:
        usage = await _branch_usage(db, branch.tenant_id)
        if usage.active_branches <= 1:
            raise DomainError(
                "last_active_branch",
                "The last active branch cannot be deactivated",
                status_code=409,
            )
    if changes.get("is_active") is True and not branch.is_active:
        usage = await _branch_usage(db, branch.tenant_id)
        if not usage.can_create:
            raise DomainError(
                "branch_limit_reached",
                "The subscription branch limit has been reached",
                status_code=409,
                details={
                    "plan_name": usage.plan_name,
                    "max_branches": usage.max_branches,
                    "active_branches": usage.active_branches,
                },
            )
    for key, value in changes.items():
        setattr(branch, key, value)
    add_audit_log(
        db,
        identity=identity,
        action="branch.updated",
        resource_type="branch",
        resource_id=branch.id,
        branch_id=branch.id,
        previous_value=previous,
        new_value={"name": branch.name, "is_active": branch.is_active},
    )
    await db.commit()
    return BranchOut.model_validate(branch)


@router.get("/branches/pricing", response_model=BranchPricingOut)
async def branch_pricing(identity: SettingsManager, db: DbSession) -> BranchPricingOut:
    """Current monthly amount and what opening one more branch would cost."""
    pricing = await branch_pricing_for_tenant(db, require_tenant(identity))
    return BranchPricingOut(
        currency=pricing.currency,
        base_monthly_price=pricing.base_monthly_price,
        included_branches=pricing.included_branches,
        additional_branch_price=pricing.additional_branch_price,
        active_branches=pricing.active_branches,
        billable_extra_branches=pricing.billable_extra_branches,
        monthly_total=pricing.monthly_total,
        next_branch_monthly_total=pricing.next_branch_monthly_total,
    )


@router.post("/branches/{branch_id}/archive", response_model=BranchOut)
async def archive_branch(
    branch_id: UUID,
    payload: BranchArchiveRequest,
    identity: SettingsManager,
    db: DbSession,
) -> BranchOut:
    """Retire a branch without deleting any of its history.

    Archived branches stop accepting new work and drop out of the switcher, but
    every order, payment and audit row stays queryable for reporting.
    """
    tenant_id = require_tenant(identity)
    branch = await _tenant_branch(db, identity, branch_id)
    assert branch is not None
    if not branch.is_active:
        return BranchOut.model_validate(branch)

    usage = await _branch_usage(db, tenant_id)
    if usage.active_branches <= 1:
        raise DomainError(
            "last_active_branch",
            "The last active branch cannot be archived",
            status_code=409,
        )

    branch.is_active = False
    branch.archived_at = utcnow()
    add_audit_log(
        db,
        identity=identity,
        action="branch.archived",
        resource_type="branch",
        resource_id=branch.id,
        branch_id=branch.id,
        reason=payload.reason,
        new_value={"name": branch.name, "is_active": False},
    )
    await db.commit()
    return BranchOut.model_validate(branch)


@router.post("/branches/{branch_id}/restore", response_model=BranchOut)
async def restore_branch(
    branch_id: UUID,
    identity: SettingsManager,
    db: DbSession,
) -> BranchOut:
    """Bring an archived branch back into service (and back onto the bill)."""
    tenant_id = require_tenant(identity)
    branch = await _tenant_branch(db, identity, branch_id)
    assert branch is not None
    if branch.is_active:
        return BranchOut.model_validate(branch)

    usage = await _branch_usage(db, tenant_id)
    if not usage.can_create:
        raise DomainError(
            "branch_limit_reached",
            "The subscription branch limit has been reached",
            status_code=409,
            details={
                "plan_name": usage.plan_name,
                "max_branches": usage.max_branches,
                "active_branches": usage.active_branches,
            },
        )

    branch.is_active = True
    branch.archived_at = None
    add_audit_log(
        db,
        identity=identity,
        action="branch.restored",
        resource_type="branch",
        resource_id=branch.id,
        branch_id=branch.id,
        new_value={"name": branch.name, "is_active": True},
    )
    await db.commit()
    return BranchOut.model_validate(branch)


@router.get("/users/{user_id}/branches", response_model=UserBranchAccessOut)
async def get_user_branch_access(
    user_id: UUID,
    identity: UserManager,
    db: DbSession,
) -> UserBranchAccessOut:
    tenant_id = require_tenant(identity)
    user = (
        await db.execute(select(User).where(User.id == user_id, User.tenant_id == tenant_id))
    ).scalar_one_or_none()
    if user is None:
        raise DomainError("user_not_found", "User not found", status_code=404)
    _assert_user_in_scope(identity, user)
    _assert_user_in_scope(identity, user)
    memberships = (
        (
            await db.execute(
                select(UserBranchMembership.branch_id).where(
                    UserBranchMembership.user_id == user.id,
                    UserBranchMembership.tenant_id == tenant_id,
                    UserBranchMembership.is_active.is_(True),
                )
            )
        )
        .scalars()
        .all()
    )
    branch_ids = sorted(
        {*memberships, *([user.branch_id] if user.branch_id else [])}, key=str
    )
    return UserBranchAccessOut(
        user_id=user.id,
        primary_branch_id=user.branch_id,
        branch_ids=list(branch_ids),
        has_all_branch_access=user.branch_id is None,
    )


@router.put("/users/{user_id}/branches", response_model=UserBranchAccessOut)
async def set_user_branch_access(
    user_id: UUID,
    payload: UserBranchAccessUpdate,
    identity: UserManager,
    db: DbSession,
) -> UserBranchAccessOut:
    """Replace the set of branches a user may operate in.

    Every id is verified to belong to this business first, so a leaked branch id
    from another tenant can never be granted here.
    """
    tenant_id = require_tenant(identity)
    user = (
        await db.execute(select(User).where(User.id == user_id, User.tenant_id == tenant_id))
    ).scalar_one_or_none()
    if user is None:
        raise DomainError("user_not_found", "User not found", status_code=404)
    _assert_user_in_scope(identity, user)
    _assert_user_in_scope(identity, user)
    if user.branch_id is None:
        raise DomainError(
            "user_already_business_wide",
            "This user already has access to every branch",
            status_code=409,
        )

    requested = set(payload.branch_ids)
    if requested:
        owned = set(
            (
                await db.execute(
                    select(Branch.id).where(
                        Branch.tenant_id == tenant_id, Branch.id.in_(requested)
                    )
                )
            )
            .scalars()
            .all()
        )
        if owned != requested:
            raise DomainError(
                "branch_not_found",
                "One or more branches were not found",
                status_code=404,
            )
        # Nobody may grant access wider than their own.
        for candidate in requested:
            require_record_branch(identity, candidate)

    # The primary branch is implicit and cannot be revoked here.
    requested.discard(user.branch_id)

    existing = (
        (
            await db.execute(
                select(UserBranchMembership).where(
                    UserBranchMembership.user_id == user.id,
                    UserBranchMembership.tenant_id == tenant_id,
                )
            )
        )
        .scalars()
        .all()
    )
    by_branch = {row.branch_id: row for row in existing}
    for branch_id, row in by_branch.items():
        row.is_active = branch_id in requested or branch_id == user.branch_id
    for branch_id in requested - set(by_branch):
        db.add(
            UserBranchMembership(
                tenant_id=tenant_id,
                user_id=user.id,
                branch_id=branch_id,
                is_active=True,
            )
        )

    add_audit_log(
        db,
        identity=identity,
        action="user.branch_access_updated",
        resource_type="user",
        resource_id=user.id,
        new_value={"branch_ids": sorted(str(value) for value in requested)},
    )
    await db.commit()
    return await get_user_branch_access(user_id, identity, db)


@router.get("/users", response_model=list[UserOut])
async def list_users(identity: UserManager, db: DbSession) -> list[UserOut]:
    selected_branch = require_branch(identity)
    predicates = [User.tenant_id == require_tenant(identity), User.branch_id == selected_branch]
    if not identity.has_all_branch_access:
        # A pinned manager manages their own branches' staff. Listing colleagues
        # they cannot edit would only be a roster of 403s.
        predicates.append(User.branch_id.in_(identity.accessible_branch_ids))
    rows = (
        (
            await db.execute(
                select(User)
                .where(*predicates)
                .options(selectinload(User.role).selectinload(Role.permissions))
                .order_by(User.display_name)
            )
        )
        .scalars()
        .all()
    )
    return [user_output(user) for user in rows]


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreate,
    identity: UserManager,
    db: DbSession,
) -> UserOut:
    tenant_id = require_tenant(identity)
    role = await _tenant_role(db, tenant_id, payload.role_id)
    await _validate_employee_scope(
        db,
        identity=identity,
        tenant_id=tenant_id,
        role=role,
        branch_id=payload.branch_id,
        station_id=payload.preparation_station_id,
    )
    existing = (
        await db.execute(
            select(User.id).where(
                User.tenant_id == tenant_id,
                User.username == payload.username.lower(),
            )
        )
    ).scalar_one_or_none()
    if existing:
        raise DomainError("username_conflict", "Username is already in use", status_code=409)
    user = User(
        tenant_id=tenant_id,
        branch_id=payload.branch_id,
        preparation_station_id=payload.preparation_station_id,
        role_id=role.id,
        username=payload.username.lower(),
        email=payload.email.lower() if payload.email else None,
        phone=payload.phone,
        display_name=payload.display_name,
        password_hash=hash_password(payload.temporary_password),
        pin_hash=hash_password(payload.pin) if payload.pin else None,
        is_active=payload.is_active,
    )
    db.add(user)
    await db.flush()
    add_audit_log(
        db,
        identity=identity,
        action="user.created",
        resource_type="user",
        resource_id=user.id,
        new_value={"username": user.username, "role": role.code},
    )
    await db.commit()
    user.role = role
    return user_output(user)


@router.patch("/users/{user_id}", response_model=UserOut)
async def update_user(
    user_id: UUID,
    payload: UserUpdate,
    identity: UserManager,
    db: DbSession,
) -> UserOut:
    tenant_id = require_tenant(identity)
    user = (
        await db.execute(
            select(User)
            .where(User.id == user_id, User.tenant_id == tenant_id)
            .options(selectinload(User.role).selectinload(Role.permissions))
        )
    ).scalar_one_or_none()
    if user is None:
        raise DomainError("user_not_found", "User not found", status_code=404)
    _assert_user_in_scope(identity, user)
    data = payload.model_dump(exclude_unset=True)
    if user.role.code == "BUSINESS_OWNER" and any(
        field in data for field in {"role_id", "branch_id", "preparation_station_id", "is_active"}
    ):
        raise DomainError(
            "owner_account_protected",
            "The business owner account cannot be reassigned or deactivated",
            status_code=403,
        )
    role_changed = "role_id" in data
    if "role_id" in data:
        user.role = await _tenant_role(db, tenant_id, data["role_id"])
        user.role_id = user.role.id
        data.pop("role_id")
    desired_branch_id = data.get("branch_id", user.branch_id)
    desired_station_id = data.get("preparation_station_id", user.preparation_station_id)
    if user.role.code in ASSIGNABLE_ROLE_PRESETS:
        await _validate_employee_scope(
            db,
            identity=identity,
            tenant_id=tenant_id,
            role=user.role,
            branch_id=desired_branch_id,
            station_id=desired_station_id,
        )
    elif role_changed:
        raise DomainError(
            "role_not_assignable",
            "Only fixed employee role presets can be assigned",
            status_code=422,
        )
    else:
        if "branch_id" in data:
            await _tenant_branch(db, identity, desired_branch_id)
        if "preparation_station_id" in data:
            await _tenant_station(db, tenant_id, desired_branch_id, desired_station_id)
    previous_active = user.is_active
    for key, value in data.items():
        setattr(user, key, value)
    if previous_active and not user.is_active:
        await db.execute(
            update(AuthSession)
            .where(AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None))
            .values(revoked_at=datetime.now(UTC))
        )
    add_audit_log(
        db,
        identity=identity,
        action="user.updated",
        resource_type="user",
        resource_id=user.id,
        new_value={"role": user.role.code, "is_active": user.is_active},
    )
    await db.commit()
    return user_output(user)


@router.post("/users/{user_id}/password", status_code=status.HTTP_204_NO_CONTENT)
async def reset_user_password(
    user_id: UUID,
    payload: PasswordChange,
    identity: UserManager,
    db: DbSession,
) -> None:
    user = (
        await db.execute(
            select(User).where(User.id == user_id, User.tenant_id == require_tenant(identity))
        )
    ).scalar_one_or_none()
    if user is None:
        raise DomainError("user_not_found", "User not found", status_code=404)
    _assert_user_in_scope(identity, user)
    user.password_hash = hash_password(payload.password)
    await db.execute(
        update(AuthSession)
        .where(AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
    )
    add_audit_log(
        db,
        identity=identity,
        action="user.password_reset",
        resource_type="user",
        resource_id=user.id,
    )
    await db.commit()


@router.put("/users/{user_id}/pin", status_code=status.HTTP_204_NO_CONTENT)
async def set_user_pin(
    user_id: UUID,
    payload: PinChange,
    identity: UserManager,
    db: DbSession,
) -> None:
    user = (
        await db.execute(
            select(User).where(User.id == user_id, User.tenant_id == require_tenant(identity))
        )
    ).scalar_one_or_none()
    if user is None:
        raise DomainError("user_not_found", "User not found", status_code=404)
    _assert_user_in_scope(identity, user)
    user.pin_hash = hash_password(payload.pin) if payload.pin else None
    add_audit_log(
        db,
        identity=identity,
        action="user.pin_changed",
        resource_type="user",
        resource_id=user.id,
    )
    await db.commit()


@router.get("/roles", response_model=list[RoleDetailOut])
async def list_roles(identity: UserManager, db: DbSession) -> list[RoleDetailOut]:
    tenant_id = require_tenant(identity)
    await ensure_tenant_role_presets(db, tenant_id)
    await db.commit()
    roles = (
        (
            await db.execute(
                select(Role)
                .where(
                    Role.tenant_id == tenant_id,
                    Role.code.in_(ASSIGNABLE_ROLE_PRESETS),
                )
                .options(selectinload(Role.permissions))
                .order_by(Role.name)
            )
        )
        .scalars()
        .all()
    )
    return [role_output(role) for role in roles]


@router.post("/roles", response_model=RoleDetailOut, status_code=status.HTTP_201_CREATED)
async def create_role(
    payload: RoleCreate,
    identity: RoleManager,
    db: DbSession,
) -> RoleDetailOut:
    del payload, identity, db
    raise DomainError(
        "role_presets_locked",
        "Employee roles are fixed presets and cannot be created",
        status_code=409,
    )


@router.patch("/roles/{role_id}", response_model=RoleDetailOut)
async def update_role(
    role_id: UUID,
    payload: RoleUpdate,
    identity: RoleManager,
    db: DbSession,
) -> RoleDetailOut:
    del role_id, payload, identity, db
    raise DomainError(
        "role_presets_locked",
        "Employee role presets cannot be changed",
        status_code=409,
    )


@router.get("/permissions", response_model=list[str])
async def list_permissions(identity: RoleManager, db: DbSession) -> list[str]:
    require_tenant(identity)
    permissions = (
        (await db.execute(select(Permission.code).order_by(Permission.code))).scalars().all()
    )
    return list(permissions)
