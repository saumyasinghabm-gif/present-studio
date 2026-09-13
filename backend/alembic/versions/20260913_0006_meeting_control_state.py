"""persist authoritative meeting control state

Revision ID: 20260913_0006
Revises: 20260913_0005
Create Date: 2026-09-13
"""
from alembic import op
import sqlalchemy as sa


revision = "20260913_0006"
down_revision = "20260913_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("live_sessions")}
    if "featured_share_identity" not in columns:
        op.add_column("live_sessions", sa.Column("featured_share_identity", sa.String(length=128), nullable=True))
    if "meeting_muted" not in columns:
        op.add_column("live_sessions", sa.Column("meeting_muted", sa.Boolean(), server_default=sa.false(), nullable=False))
    if "muted_participant_identities" not in columns:
        op.add_column("live_sessions", sa.Column("muted_participant_identities", sa.Text(), server_default="[]", nullable=False))


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("live_sessions")}
    for name in ("muted_participant_identities", "meeting_muted", "featured_share_identity"):
        if name in columns:
            op.drop_column("live_sessions", name)
