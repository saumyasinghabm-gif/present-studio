# Frontend Developer Tasks

These tasks are written for a junior frontend developer. She should work inside `frontend/` only.

## Priority 1 - Stabilize Current UI

- Run the FastAPI server and open `/login.html`.
- Understand `frontend/js/api.js`.
- Do not add direct `fetch()` calls outside `frontend/js/api.js`.
- Keep page files simple: HTML structure, CSS styling, JS behavior.
- Check mobile and desktop layouts after every UI change.

## Five-Day Frontend Assignment

Owner: Junior Frontend Developer

### Day 1 - Run, Read, And Verify

- Run the app locally and confirm login, dashboard, editor, and present pages open.
- Read `frontend/js/api.js`, `frontend/js/editor.js`, and `frontend/js/present.js`.
- Verify audience links do not show presenter controls.
- Verify presenter links show Previous, Next, End Session, timer, thumbnails, notes, and next preview.
- Report any console error with page name, browser action, and screenshot.

### Day 2 - Editor Canvas Controls

- Add drag support for canvas elements.
- Add resize support for canvas elements.
- Add image element property editing.
- Add video placeholder support in slide JSON.
- Add delete selected element.
- Add duplicate selected element.
- Add layer ordering: bring forward, send backward.
- Add basic keyboard shortcuts: Delete, Ctrl+C, Ctrl+V.

### Day 3 - Slide Management

- Add rename presentation UI.
- Add rename slide UI.
- Add duplicate slide.
- Add delete slide.
- Add drag-and-drop slide reorder.
- Save after slide structure changes.

### Day 4 - Media Library And Background Panel

- Show uploaded media assets in the right panel.
- Allow click-to-insert image/video on canvas.
- Show upload progress.
- Validate file type before sending to backend.
- Improve the existing background media panel without changing the stored JSON shape.
- Keep `background_media.type`, `url`, `loop`, `muted`, `fit`, and `fade_in_ms` exactly as documented.

### Day 5 - Presenting Polish

- Add audience loading and error states.
- Add full-screen audience mode.
- Polish mobile layout for presenter console.
- Improve sidebar thumbnails visually.
- Test transitions: none, fade, slide, zoom.
- Test video background loop and mute behavior.

## Later Design Cleanup

- Replace decorative text symbols with proper icons once the project moves to React.
- Standardize spacing tokens in CSS.
- Split the single `style.css` into page-level CSS files if the plain HTML approach continues.
- Keep canvas controls compact and production-like, not landing-page-like.

## Definition Of Done For Each Frontend Task

- Works in Chrome.
- Works at desktop and mobile widths.
- Does not break login, dashboard, editor, or present view.
- Uses `frontend/js/api.js` for data.
- Updates the slide JSON when canvas content changes.
- Does not add presenter controls to viewer/audience mode.
- Has no console errors.
