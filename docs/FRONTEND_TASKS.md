# Frontend Developer Tasks

These tasks are written for a junior frontend developer. She should work inside `frontend/` only.

## Priority 1 - Stabilize Current UI

- Run the FastAPI server and open `/login.html`.
- Understand `frontend/js/api.js`.
- Do not add direct `fetch()` calls outside `frontend/js/api.js`.
- Keep page files simple: HTML structure, CSS styling, JS behavior.
- Check mobile and desktop layouts after every UI change.

## Priority 2 - Editor Canvas

- Add drag support for canvas elements.
- Add resize support for canvas elements.
- Add image element property editing.
- Add video placeholder support in slide JSON.
- Add delete selected element.
- Add duplicate selected element.
- Add layer ordering: bring forward, send backward.
- Add basic keyboard shortcuts: Delete, Ctrl+C, Ctrl+V.

## Priority 3 - Slide Management

- Add rename presentation UI.
- Add rename slide UI.
- Add duplicate slide.
- Add delete slide.
- Add drag-and-drop slide reorder.
- Save after slide structure changes.

## Priority 4 - Media Library

- Show uploaded media assets in the right panel.
- Allow click-to-insert image/video on canvas.
- Show upload progress.
- Validate file type before sending to backend.

## Priority 5 - Presenting

- Add presenter route/state separate from editor mode.
- Add audience loading and error states.
- Add full-screen audience mode.
- Prepare Socket.IO integration points for active-slide updates.

## Priority 6 - Design Cleanup

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
- Has no console errors.
