"""Track KVKK notice acknowledgement and optional marketing consent at signup.

Adds `privacy_notice_version` and `marketing_consent` to the pending-signup
table (mirrors the existing `contract_version` column), and a durable
`marketing_consent` flag on `users` so the opt-in survives past the transient
verification row.

Revision ID: 0028_registration_consent
Revises: 0027_business_theme_mode
Create Date: 2026-09-06

Note: the revision id is shortened from the filename (as several earlier
revisions already do, e.g. 0009) because Alembic's `alembic_version` table
defaults to `VARCHAR(32)`, and the full descriptive name overflows it.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0028_registration_consent"
down_revision = "0027_business_theme_mode"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    verification_columns = _columns("business_registration_verifications")
    with op.batch_alter_table("business_registration_verifications") as batch:
        if "privacy_notice_version" not in verification_columns:
            batch.add_column(
                sa.Column(
                    "privacy_notice_version",
                    sa.String(length=40),
                    nullable=False,
                    server_default="unknown",
                )
            )
        if "marketing_consent" not in verification_columns:
            batch.add_column(
                sa.Column(
                    "marketing_consent",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.false(),
                )
            )

    user_columns = _columns("users")
    if "marketing_consent" not in user_columns:
        with op.batch_alter_table("users") as batch:
            batch.add_column(
                sa.Column(
                    "marketing_consent",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.false(),
                )
            )


def downgrade() -> None:
    user_columns = _columns("users")
    if "marketing_consent" in user_columns:
        with op.batch_alter_table("users") as batch:
            batch.drop_column("marketing_consent")

    verification_columns = _columns("business_registration_verifications")
    with op.batch_alter_table("business_registration_verifications") as batch:
        if "marketing_consent" in verification_columns:
            batch.drop_column("marketing_consent")
        if "privacy_notice_version" in verification_columns:
            batch.drop_column("privacy_notice_version")
