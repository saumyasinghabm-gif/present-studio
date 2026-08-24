from typing import Any, Literal
from pydantic import BaseModel


class LoginRequest(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    id: str
    name: str
    email: str
    role: str


class SlideIn(BaseModel):
    id: str
    order: int
    title: str
    canvas: dict[str, Any]


class SlideOut(SlideIn):
    pass


class PresentationCreate(BaseModel):
    title: str


class PresentationSave(BaseModel):
    id: str
    title: str
    slides: list[SlideIn]


class PresentationOut(BaseModel):
    id: str
    title: str
    ownerId: str
    status: str
    updatedAt: str | None = None
    slides: list[SlideOut]


class ShareLinkOut(BaseModel):
    url: str


class MediaAssetOut(BaseModel):
    id: str
    name: str
    mimeType: str
    url: str
    size: int


class LiveSlideEvent(BaseModel):
    presentationId: str
    slideId: str
    mode: Literal["presenter", "audience"] = "presenter"
