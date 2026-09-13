"""add screen access codes for protected share links

Revision ID: 20260908_0004
Revises: 20260907_0003
Create Date: 2026-09-08
"""
from alembic import op
import sqlalchemy as sa


revision = "20260908_0004"
down_revision = "20260907_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("share_links")}
    if "screen_access_code_hash" not in columns:
        op.add_column("share_links", sa.Column("screen_access_code_hash", sa.String(length=255), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("share_links")}
    if "screen_access_code_hash" in columns:
        op.drop_column("share_links", "screen_access_code_hash")
