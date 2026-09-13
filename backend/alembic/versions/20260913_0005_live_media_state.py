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
    op.add_column("live_sessions", sa.Column("active_media_id", sa.String(length=128), nullable=True))
    op.add_column("live_sessions", sa.Column("active_media_kind", sa.String(length=16), server_default="slide", nullable=False))
    op.add_column("live_sessions", sa.Column("media_position", sa.Float(), server_default="0", nullable=False))
    op.add_column("live_sessions", sa.Column("media_playing", sa.Boolean(), server_default=sa.false(), nullable=False))
    op.add_column("live_sessions", sa.Column("media_muted", sa.Boolean(), server_default=sa.false(), nullable=False))
    op.add_column("live_sessions", sa.Column("media_updated_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("live_sessions", "media_updated_at")
    op.drop_column("live_sessions", "media_muted")
    op.drop_column("live_sessions", "media_playing")
    op.drop_column("live_sessions", "media_position")
    op.drop_column("live_sessions", "active_media_kind")
    op.drop_column("live_sessions", "active_media_id")
