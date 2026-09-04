# Video playback fixes

Files changed:
- frontend/js/editor.js
- frontend/js/builder-ui.js
- frontend/js/preview.js
- frontend/css/styles.css

Fixes:
- New editor videos are no longer saved as permanently muted.
- Clicking the editor video play/pause button enables audio during the user gesture.
- Editor play/pause button state stays synchronized with the HTML video element.
- Video loop/source/mute state is synchronized with the Fabric video placeholder.
- Preview videos always expose native video controls, including full-slide videos.
- Preview media layer is above the static Fabric canvas so video controls receive clicks.
- The preview Fabric canvas no longer intercepts pointer events.
- Preview explicitly attempts video playback after inserting the video element.

Note: Preview still starts autoplay media muted, by design, because modern browsers generally block autoplay with sound. Use the existing "Enable audio" button to enable sound.
