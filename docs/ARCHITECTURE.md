# Present Studio Cloud Architecture

## Goal

Build a professional cloud presentation product in phases. The first production milestone is a reliable product for creating slide decks, storing slide JSON, uploading assets, generating share links, and presenting live.

## Final Team-Fit Stack

- Frontend: HTML, CSS, JavaScript.
- Canvas editor: Fabric.js.
- Backend: Python FastAPI.
- Database: SQLAlchemy with SQLite locally and PostgreSQL in production.
- Realtime: Socket.IO through `python-socketio`.
- Storage: Cloudinary/S3/R2 in production.

## Current App Modules

- `frontend/js/api.js` - browser API client.
- `frontend/js/editor.js` - Fabric.js canvas editor.
- `frontend/js/present.js` - audience/presenter rendering and Socket.IO events.
- `backend/app/main.py` - FastAPI app and static frontend serving.
- `backend/app/models.py` - SQLAlchemy tables.
- `backend/app/routers/` - API modules.
- `backend/app/socket_manager.py` - live slide sync.
- `backend/alembic/` - production migrations.
- `docker-compose.yml` - PostgreSQL and backend containers.

## Data Model

The editor should store slides as JSON. The backend should not need custom columns for every visual element.

```json
{
  "id": "slide_1",
  "order": 1,
  "title": "Welcome",
  "subtitle": "to Present Studio",
  "kicker": "PRESENT STUDIO",
  "canvas": {
    "background": "#fcf8ef",
    "elements": [
      {
        "id": "title",
        "type": "text",
        "text": "Welcome",
        "x": 21,
        "y": 36,
        "width": 54,
        "fontSize": 54,
        "color": "#1f1e1b",
        "fontWeight": "500",
        "textAlign": "center"
      }
    ]
  }
}
```

## Rules For Frontend Work

- Do not call `fetch()` directly from page scripts except inside `frontend/js/api.js`.
- Use `window.PresentStudioApi` for backend communication.
- Keep all slide content serializable as JSON.
- Keep audience/presenter rendering read-only unless in editor mode.
- Keep UI dense, modern, and product-like.

## Backend Rules

- Keep routers small and module-based.
- Store slide canvas data as JSON.
- Keep uploaded media outside the database.
- Use Socket.IO only for live active-slide events, not for saving slide data.
- Every new canvas element type must be serializable in slide JSON.
- Keep the audience page read-only.
- Use Alembic for production schema changes.
- Use PostgreSQL in Docker for production-like testing.

## Production Components

- JWT auth with HTTP-only cookie and bearer-token support.
- Password hashes with Passlib.
- Cloudinary media upload.
- Share token table for public audience links.
- Live session table for active-slide persistence.
