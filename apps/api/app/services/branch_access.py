from __future__ import annotations

from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Branch, User, UserBranchMembership


async def resolve_accessible_branches(db: AsyncSession, user: User) -> tuple[frozenset[UUID], bool]:
    """The single branch grant policy used by login, refresh, HTTP and realtime."""
    if user.tenant_id is None:
        return frozenset(), False
    query = select(Branch.id).where(
        Branch.tenant_id == user.tenant_id,
        Branch.is_active.is_(True),
        Branch.archived_at.is_(None),
    )
    if user.branch_id is not None:
        memberships = select(UserBranchMembership.branch_id).where(
            UserBranchMembership.user_id == user.id,
            UserBranchMembership.tenant_id == user.tenant_id,
            UserBranchMembership.is_active.is_(True),
        )
        query = query.where(or_(Branch.id == user.branch_id, Branch.id.in_(memberships)))
    return frozenset((await db.execute(query)).scalars().all()), user.branch_id is None
