"""Short-lived reauthentication grants bound to the actor's existing session."""
from alembic import op
from app.models.identity import OperationGrant

revision = "0042_operation_grants"
down_revision = "0041_role_operational_profile"
branch_labels = None
depends_on = None


def upgrade() -> None:
    OperationGrant.__table__.create(bind=op.get_bind(), checkfirst=True)


def downgrade() -> None:
    OperationGrant.__table__.drop(bind=op.get_bind(), checkfirst=True)
