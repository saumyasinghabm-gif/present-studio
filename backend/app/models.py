from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(32), default="owner")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now())

    presentations: Mapped[list["Presentation"]] = relationship(back_populates="owner")


class Presentation(Base):
    __tablename__ = "presentations"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    title: Mapped[str] = mapped_column(String(255))
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(32), default="draft")
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    owner: Mapped[User] = relationship(back_populates="presentations")
    slides: Mapped[list["Slide"]] = relationship(back_populates="presentation", cascade="all, delete-orphan")


class Slide(Base):
    __tablename__ = "slides"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    presentation_id: Mapped[str] = mapped_column(ForeignKey("presentations.id"), index=True)
    order: Mapped[int] = mapped_column(default=1)
    title: Mapped[str] = mapped_column(String(255), default="Untitled Slide")
    canvas: Mapped[dict] = mapped_column(JSON, default=dict)

    presentation: Mapped[Presentation] = relationship(back_populates="slides")


class MediaAsset(Base):
    __tablename__ = "media_assets"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str] = mapped_column(String(120))
    url: Mapped[str] = mapped_column(Text)
    size: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PresentationMember(Base):
    __tablename__ = "presentation_members"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    presentation_id: Mapped[str] = mapped_column(ForeignKey("presentations.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    role: Mapped[str] = mapped_column(String(32), default="viewer")
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ShareLink(Base):
    __tablename__ = "share_links"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    presentation_id: Mapped[str] = mapped_column(ForeignKey("presentations.id"), index=True)
    token: Mapped[str] = mapped_column(String(160), unique=True, index=True)
    permission: Mapped[str] = mapped_column(String(32), default="viewer")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    expires_at: Mapped[str | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now())


class LiveSession(Base):
    __tablename__ = "live_sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    presentation_id: Mapped[str] = mapped_column(ForeignKey("presentations.id"), unique=True, index=True)
    active_slide_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    presenter_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    audience_count: Mapped[int] = mapped_column(Integer, default=0)
    is_live: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
