"""add per-user presentation quotas

Revision ID: 20260907_0002
Revises: 20260824_0001
Create Date: 2026-09-07
"""
from alembic import op
import sqlalchemy as sa


revision = "20260907_0002"
down_revision = "20260824_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("presentation_limit", sa.Integer(), nullable=False, server_default="10"),
    )


def downgrade() -> None:
    op.drop_column("users", "presentation_limit")
