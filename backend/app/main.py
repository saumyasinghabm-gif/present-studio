from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import socketio
from sqlalchemy import inspect, text
from .config import get_settings
from .database import Base, SessionLocal, engine
from .models import User
from .routers import admin, auth, media, presentations
from .security import admin_user
from .seed import seed_demo_data
from .socket_manager import sio


settings = get_settings()
fastapi_app = FastAPI(title=settings.app_name)

fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@fastapi_app.on_event("startup")
def startup() -> None:
    Base.metadata.create_all(bind=engine)
    repair_local_sqlite_schema()
    db = SessionLocal()
    try:
        seed_demo_data(db)
    finally:
        db.close()


def repair_local_sqlite_schema() -> None:
    if not settings.database_url.startswith("sqlite"):
        return
    inspector = inspect(engine)
    if "users" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("users")}
    with engine.begin() as connection:
        if "password_hash" not in columns:
            connection.execute(text("ALTER TABLE users ADD COLUMN password_hash VARCHAR(255)"))
        if "is_active" not in columns:
            connection.execute(text("ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT 1 NOT NULL"))
        if "presentation_limit" not in columns:
            connection.execute(text("ALTER TABLE users ADD COLUMN presentation_limit INTEGER DEFAULT 10 NOT NULL"))
        if "storage_limit_bytes" not in columns:
            connection.execute(text("ALTER TABLE users ADD COLUMN storage_limit_bytes BIGINT"))
    if "share_links" not in inspector.get_table_names():
        return
    share_columns = {column["name"] for column in inspector.get_columns("share_links")}
    if "screen_access_code_hash" not in share_columns:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE share_links ADD COLUMN screen_access_code_hash VARCHAR(255)"))


@fastapi_app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


fastapi_app.include_router(auth.router)
fastapi_app.include_router(presentations.router)
fastapi_app.include_router(media.router)
fastapi_app.include_router(admin.router)


@fastapi_app.get("/admin", include_in_schema=False)
@fastapi_app.get("/admin.html", include_in_schema=False)
def admin_dashboard(_: User = Depends(admin_user)) -> FileResponse:
    return FileResponse(settings.frontend_dir / "admin.html")

fastapi_app.mount("/", StaticFiles(directory=settings.frontend_dir, html=True), name="frontend")

app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app)
