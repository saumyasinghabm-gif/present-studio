from datetime import datetime, timezone
from typing import Any

from .models import LiveSession


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def live_session_payload(live: LiveSession | None, presentation_id: str) -> dict[str, Any]:
    now = utc_now()
    position = max(0.0, float(live.media_position or 0.0)) if live else 0.0
    updated_at = _as_utc(live.media_updated_at) if live else None
    playing = bool(live and live.media_playing)
    if playing and updated_at:
        position += max(0.0, (now - updated_at).total_seconds())
    return {
        "presentationId": presentation_id,
        "slideId": live.active_slide_id if live else None,
        "kind": (live.active_media_kind or "slide") if live else "slide",
        "mediaId": live.active_media_id if live else None,
        "position": position,
        "playing": playing,
        "muted": bool(live and live.media_muted),
        "isLive": bool(live and live.is_live),
        "serverTime": int(now.timestamp() * 1000),
    }


def apply_controller_state(
    live: LiveSession,
    *,
    slide_id: str,
    kind: str = "slide",
    media_id: str | None = None,
    position: float = 0.0,
    playing: bool = False,
    muted: bool = False,
) -> None:
    live.active_slide_id = slide_id
    live.active_media_kind = kind
    live.active_media_id = media_id
    live.media_position = max(0.0, min(float(position), 86400.0))
    live.media_playing = bool(playing)
    live.media_muted = bool(muted)
    live.media_updated_at = utc_now()
    live.is_live = True
