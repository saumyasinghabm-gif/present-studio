import sys
import types
from types import SimpleNamespace

stub_models = types.ModuleType("backend.app.models")
stub_models.LiveSession = object
sys.modules["backend.app.models"] = stub_models

from backend.app.live_state import apply_controller_state, live_session_payload, normalized_volume

live = SimpleNamespace(
    active_slide_id="slide_1", active_media_kind="video", active_media_id="video_1",
    media_position=12.0, media_updated_at=None, media_playing=True, media_muted=False,
    video_volume=1.0, audio_volume=1.0, is_live=True,
)
assert live_session_payload(live, "pres_1")["videoVolume"] == 1.0
apply_controller_state(live, slide_id="slide_1", video_volume=.25, audio_volume=.6)
state = live_session_payload(live, "pres_1")
assert state["videoVolume"] == .25 and state["audioVolume"] == .6
apply_controller_state(live, slide_id="slide_1")
assert live.video_volume == .25 and live.audio_volume == .6
apply_controller_state(live, slide_id="slide_1", video_volume="nan", audio_volume=4)
assert live.video_volume == .25 and live.audio_volume == 1.0
assert normalized_volume(-5) == 0.0
print("Volume state persists and stays within 0–1")
