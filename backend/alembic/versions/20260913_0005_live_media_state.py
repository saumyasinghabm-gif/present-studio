"""persist authoritative live media state

Revision ID: 20260913_0005
Revises: 20260908_0004
Create Date: 2026-09-13
"""
from alembic import op
import sqlalchemy as sa


revision = "20260913_0005"
down_revision = "20260908_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("live_sessions")}
    if "active_media_id" not in columns:
        op.add_column("live_sessions", sa.Column("active_media_id", sa.String(length=128), nullable=True))
    if "active_media_kind" not in columns:
        op.add_column("live_sessions", sa.Column("active_media_kind", sa.String(length=16), server_default="slide", nullable=False))
    if "media_position" not in columns:
        op.add_column("live_sessions", sa.Column("media_position", sa.Float(), server_default="0", nullable=False))
    if "media_playing" not in columns:
        op.add_column("live_sessions", sa.Column("media_playing", sa.Boolean(), server_default=sa.false(), nullable=False))
    if "media_muted" not in columns:
        op.add_column("live_sessions", sa.Column("media_muted", sa.Boolean(), server_default=sa.false(), nullable=False))
    if "media_updated_at" not in columns:
        op.add_column("live_sessions", sa.Column("media_updated_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("live_sessions")}
    for name in ("media_updated_at", "media_muted", "media_playing", "media_position", "active_media_kind", "active_media_id"):
        if name in columns:
            op.drop_column("live_sessions", name)
