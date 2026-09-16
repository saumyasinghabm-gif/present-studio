from datetime import datetime, timezone
import json
import math
from typing import Any

from .models import LiveSession


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def normalized_volume(value: Any, fallback: float = 1.0) -> float:
    try:
        volume = float(value)
    except (TypeError, ValueError):
        return fallback
    return max(0.0, min(volume, 1.0)) if math.isfinite(volume) else fallback


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
        "videoVolume": normalized_volume(live.video_volume) if live else 1.0,
        "audioVolume": normalized_volume(live.audio_volume) if live else 1.0,
        "isLive": bool(live and live.is_live),
        "serverTime": int(now.timestamp() * 1000),
    }


def meeting_control_payload(live: LiveSession | None, presentation_id: str) -> dict[str, Any]:
    try:
        muted = json.loads(live.muted_participant_identities or "[]") if live else []
    except (TypeError, ValueError):
        muted = []
    return {
        "presentationId": presentation_id,
        "featuredShareIdentity": live.featured_share_identity if live else None,
        "meetingMuted": bool(live and live.meeting_muted),
        "mutedParticipants": [str(identity)[:128] for identity in muted if identity][:100],
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
    video_volume: float | None = None,
    audio_volume: float | None = None,
) -> None:
    live.active_slide_id = slide_id
    live.active_media_kind = kind
    live.active_media_id = media_id
    live.media_position = max(0.0, min(float(position), 86400.0))
    live.media_playing = bool(playing)
    live.media_muted = bool(muted)
    if video_volume is not None:
        live.video_volume = normalized_volume(video_volume, normalized_volume(live.video_volume))
    if audio_volume is not None:
        live.audio_volume = normalized_volume(audio_volume, normalized_volume(live.audio_volume))
    live.media_updated_at = utc_now()
    live.is_live = True
