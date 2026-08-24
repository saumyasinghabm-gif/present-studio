"""initial production schema

Revision ID: 20260824_0001
Revises:
Create Date: 2026-08-24
"""
from alembic import op
import sqlalchemy as sa


revision = "20260824_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("role", sa.String(32), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "presentations",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("owner_id", sa.String(64), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "slides",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("presentation_id", sa.String(64), sa.ForeignKey("presentations.id"), nullable=False),
        sa.Column("order", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("canvas", sa.JSON(), nullable=False),
    )
    op.create_index("ix_slides_presentation_id", "slides", ["presentation_id"])

    op.create_table(
        "media_assets",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("owner_id", sa.String(64), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("mime_type", sa.String(120), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_media_assets_owner_id", "media_assets", ["owner_id"])

    op.create_table(
        "presentation_members",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("presentation_id", sa.String(64), sa.ForeignKey("presentations.id"), nullable=False),
        sa.Column("user_id", sa.String(64), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("role", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "share_links",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("presentation_id", sa.String(64), sa.ForeignKey("presentations.id"), nullable=False),
        sa.Column("token", sa.String(160), nullable=False),
        sa.Column("permission", sa.String(32), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_share_links_token", "share_links", ["token"], unique=True)

    op.create_table(
        "live_sessions",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("presentation_id", sa.String(64), sa.ForeignKey("presentations.id"), nullable=False),
        sa.Column("active_slide_id", sa.String(64), nullable=True),
        sa.Column("presenter_user_id", sa.String(64), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("audience_count", sa.Integer(), nullable=False),
        sa.Column("is_live", sa.Boolean(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_live_sessions_presentation_id", "live_sessions", ["presentation_id"], unique=True)


def downgrade() -> None:
    op.drop_table("live_sessions")
    op.drop_table("share_links")
    op.drop_table("presentation_members")
    op.drop_table("media_assets")
    op.drop_table("slides")
    op.drop_table("presentations")
    op.drop_table("users")
