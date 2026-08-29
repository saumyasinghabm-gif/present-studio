# Present Studio Cloud

Cloud presentation creation and live presenting product built for the current team:

- Frontend: plain HTML, CSS, JavaScript, Fabric.js.
- Backend: Python FastAPI, SQLAlchemy, Socket.IO.
- Local database: SQLite by default.
- Production database: PostgreSQL through `DATABASE_URL`.

## Run Locally

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r backend\requirements.txt
cd backend
uvicorn app.main:app --reload
```

Open:

```text
http://127.0.0.1:8000
```

Demo login:

```text
owner@presentstudio.local
password123
```

## Structure

```text
frontend/
  login.html
  dashboard.html
  editor.html
  controller.html
  screen.html
  present.html
  css/styles.css
  js/api.js
  js/login.js
  js/dashboard.js
  js/editor.js
  js/present.js

backend/
  requirements.txt
  app/
    main.py
    config.py
    database.py
    models.py
    schemas.py
    seed.py
    socket_manager.py
    routers/
      auth.py
      presentations.py
      media.py
```

## Current Features

- Login flow.
- Presentation dashboard.
- Create presentation.
- Fabric.js canvas editor.
- Add/edit/delete text.
- Add images locally to canvas.
- Save canvas JSON to backend.
- Share-link endpoint.
- Viewer and presenter share links.
- Role-aware presenter console and audience stage.
- Socket.IO active-slide broadcast with presenter authorization.
- Per-slide background image/video media settings.
- Per-slide transitions: none, fade, slide, zoom.
- JWT auth with hashed passwords.
- Share token table.
- Live session persistence.
- Cloudinary upload endpoint.
- Image, video, and MP3 asset library with per-image audio linking.
- Dedicated presenter controller with direct slide/media selection and selected-media loops.
- Clean fullscreen audience screen synchronized through Socket.IO.
- Alembic migration scaffold.
- Docker Compose with PostgreSQL.

## Production Next Steps

- Set a strong `JWT_SECRET`.
- Configure Cloudinary credentials.
- Run with Docker PostgreSQL for production-like testing.
- Expand role-management APIs.
- Add AI slide generation endpoint.

## Docker PostgreSQL

```bash
docker-compose up --build -d
```

Docker Compose runs the FastAPI application (including the frontend) and PostgreSQL.
PostgreSQL is available only to containers on the Compose network; uploaded images
and videos are stored in Cloudinary. Compose reads credentials from the root `.env`
file and injects them at runtime—the file is excluded from the Docker image.

Backend:

```text
http://127.0.0.1:8000
```

## Alembic

From `backend/`:

```bash
alembic upgrade head
```

For local development, the app still creates tables automatically on startup. For production, use Alembic migrations.

## Cloudinary

Set these environment variables:

```text
CLOUDINARY_CLOUD_NAME=ylhzrgso
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
CLOUDINARY_FOLDER=present-studio
```

`ylhzrgso` is configured as this project's Cloudinary cloud name. Add the API key
and API secret from the Cloudinary dashboard before starting the backend. Keep the
API secret server-side and never add it to frontend JavaScript or commit it to Git.
The backend automatically loads these values from the `.env` file in the project root.
Restart the backend after changing that file.

## Important Local Test Flow

1. Login with the demo account.
2. Open the editor for the demo deck.
3. Create an audience link. This must show only the audience stage.
4. Create a presenter link. This must show presenter controls.
5. Move slides from the presenter link. The audience link should follow.
6. Try End Session from the presenter link. Audience should see the ended state.
