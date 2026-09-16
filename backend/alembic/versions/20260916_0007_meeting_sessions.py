"""meeting instances and persistent participant grants

Revision ID: 20260916_0007
Revises: 20260913_0006
Create Date: 2026-09-16
"""
from alembic import op
import sqlalchemy as sa


revision = "20260916_0007"
down_revision = "20260913_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    live_columns = {column["name"] for column in inspector.get_columns("live_sessions")}
    if "meeting_instance_id" not in live_columns:
        op.add_column(
            "live_sessions",
            sa.Column("meeting_instance_id", sa.String(length=64), nullable=True),
        )

    inspector = sa.inspect(bind)
    if "meeting_participant_grants" not in inspector.get_table_names():
        op.create_table(
            "meeting_participant_grants",
            sa.Column("id", sa.String(length=64), primary_key=True),
            sa.Column(
                "presentation_id",
                sa.String(length=64),
                sa.ForeignKey("presentations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("meeting_instance_id", sa.String(length=64), nullable=False),
            sa.Column("guest_id", sa.String(length=128), nullable=False),
            sa.Column("display_name", sa.String(length=80), nullable=False, server_default="Guest"),
            sa.Column("role", sa.String(length=16), nullable=False, server_default="audience"),
            sa.Column("status", sa.String(length=16), nullable=False, server_default="approved"),
            sa.Column("cohost_share_id", sa.String(length=64), nullable=True),
            sa.Column(
                "admitted_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.UniqueConstraint(
                "presentation_id",
                "meeting_instance_id",
                "guest_id",
                name="uq_meeting_participant_grant",
            ),
        )
        op.create_index(
            "ix_meeting_participant_grants_presentation_id",
            "meeting_participant_grants",
            ["presentation_id"],
        )
        op.create_index(
            "ix_meeting_participant_grants_meeting_instance_id",
            "meeting_participant_grants",
            ["meeting_instance_id"],
        )
        op.create_index(
            "ix_meeting_participant_grants_guest_id",
            "meeting_participant_grants",
            ["guest_id"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if "meeting_participant_grants" in inspector.get_table_names():
        op.drop_table("meeting_participant_grants")

    inspector = sa.inspect(bind)
    if "live_sessions" in inspector.get_table_names():
        live_columns = {column["name"] for column in inspector.get_columns("live_sessions")}
        if "meeting_instance_id" in live_columns:
            op.drop_column("live_sessions", "meeting_instance_id")
