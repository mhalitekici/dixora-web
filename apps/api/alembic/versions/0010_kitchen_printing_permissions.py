"""Allow kitchen users to operate the printer workspace.

Revision ID: 0010_kitchen_printing
Revises: 0009_loyalty_verify_security
Create Date: 2026-08-04
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0010_kitchen_printing"
down_revision = "0009_loyalty_verify_security"
branch_labels = None
depends_on = None

PERMISSION_CODES = ("printing.read", "printing.manage")


def upgrade() -> None:
    connection = op.get_bind()
    for code in PERMISSION_CODES:
        connection.execute(
            sa.text(
                "INSERT INTO role_permissions (role_id, permission_id) "
                "SELECT roles.id, permissions.id "
                "FROM roles JOIN permissions ON permissions.code = :permission_code "
                "WHERE roles.code = 'KITCHEN' AND roles.tenant_id IS NOT NULL "
                "AND NOT EXISTS ("
                "SELECT 1 FROM role_permissions existing "
                "WHERE existing.role_id = roles.id "
                "AND existing.permission_id = permissions.id"
                ")"
            ),
            {"permission_code": code},
        )


def downgrade() -> None:
    connection = op.get_bind()
    for code in PERMISSION_CODES:
        connection.execute(
            sa.text(
                "DELETE FROM role_permissions "
                "WHERE permission_id = (SELECT id FROM permissions WHERE code = :permission_code) "
                "AND role_id IN ("
                "SELECT id FROM roles WHERE code = 'KITCHEN' AND tenant_id IS NOT NULL"
                ")"
            ),
            {"permission_code": code},
        )
