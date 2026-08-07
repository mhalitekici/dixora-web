"""Initial multi-tenant Dixora schema.

Revision ID: 0001_initial
Revises:
Create Date: 2026-07-30
"""

from alembic import op
from app.models import Base

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The metadata is fully constraint-named and is also used by Alembic autogenerate.
    # Keeping the bootstrap revision tied to that metadata prevents a handwritten
    # 48-table migration from drifting before the first production release.
    Base.metadata.create_all(bind=op.get_bind(), checkfirst=True)


def downgrade() -> None:
    Base.metadata.drop_all(bind=op.get_bind(), checkfirst=True)
