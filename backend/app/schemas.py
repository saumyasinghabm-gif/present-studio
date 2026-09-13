from typing import Any, Literal
from pydantic import BaseModel, Field


SharePermission = Literal["viewer", "presenter"]


class LoginRequest(BaseModel):
    email: str
    password: str


class SignupRequest(BaseModel):
    name: str
    email: str
    password: str


class UserOut(BaseModel):
    id: str
    name: str
    email: str
    role: str
    presentationLimit: int


class PresentationLimitUpdate(BaseModel):
    presentationLimit: int = Field(ge=0, le=100000)


class StorageLimitUpdate(BaseModel):
    storageLimitBytes: int | None = Field(default=None, ge=0, le=1024 * 1024 * 1024 * 1024)


class AuthOut(BaseModel):
    user: UserOut
    accessToken: str


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


class PresentationPayload(BaseModel):
    presentation: PresentationOut
    permission: SharePermission


class ShareLinkCreate(BaseModel):
    permission: SharePermission = "viewer"
    screenAccessCode: str | None = Field(default=None, pattern=r"^\d{4}$")


class ShareLinkOut(BaseModel):
    url: str
    token: str
    permission: SharePermission
    requiresScreenCode: bool = False
    screenUrl: str | None = None
    screenToken: str | None = None
    audienceUrl: str | None = None


class LiveMediaTokenRequest(BaseModel):
    displayName: str | None = Field(default=None, max_length=80)
    shareToken: str = Field(default="", max_length=200)
    screenAccessCode: str | None = Field(default=None, pattern=r"^\d{4}$")


class LiveMediaTokenOut(BaseModel):
    url: str
    token: str
    roomName: str
    participantIdentity: str
    participantName: str
    permission: SharePermission


class ScreenAccessRequest(BaseModel):
    token: str
    screenAccessCode: str = Field(pattern=r"^\d{4}$")


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


class LiveSlideUpdate(BaseModel):
    slideId: str


class LiveSessionOut(BaseModel):
    presentationId: str
    activeSlideId: str | None = None
    isLive: bool
    kind: str = "slide"
    mediaId: str | None = None
    position: float = 0.0
    playing: bool = False
    muted: bool = False
    serverTime: int | None = None
