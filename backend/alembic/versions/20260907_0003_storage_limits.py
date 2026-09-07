"""add admin-managed media storage limits

Revision ID: 20260907_0003
Revises: 20260907_0002
Create Date: 2026-09-07
"""
from alembic import op
import sqlalchemy as sa


revision = "20260907_0003"
down_revision = "20260907_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("storage_limit_bytes", sa.BigInteger(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "storage_limit_bytes")
