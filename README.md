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
- Presenter/audience view.
- Socket.IO active-slide broadcast.
- JWT auth with hashed passwords.
- Share token table.
- Live session persistence.
- Cloudinary upload endpoint.
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
docker compose up --build
```

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
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
CLOUDINARY_FOLDER=present-studio
```
