from sqlalchemy import JSON, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    role: Mapped[str] = mapped_column(String(32), default="owner")
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
