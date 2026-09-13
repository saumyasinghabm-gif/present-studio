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
    repair_share_link_schema()
    repair_live_session_schema()
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


def repair_share_link_schema() -> None:
    """Repair pre-migration SQLite and PostgreSQL databases on startup."""
    inspector = inspect(engine)
    if "share_links" not in inspector.get_table_names():
        return
    share_columns = {column["name"] for column in inspector.get_columns("share_links")}
    statements = share_link_repair_statements(engine.dialect.name, share_columns)
    if not statements:
        return
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


def share_link_repair_statements(dialect_name: str, columns: set[str]) -> list[str]:
    """Return ALTER statements needed by older share_links tables."""
    is_sqlite = dialect_name == "sqlite"
    bool_default = "1" if is_sqlite else "TRUE"
    timestamp_type = "DATETIME" if is_sqlite else "TIMESTAMP WITH TIME ZONE"
    statements: list[str] = []
    if "screen_access_code_hash" not in columns:
        statements.append("ALTER TABLE share_links ADD COLUMN screen_access_code_hash VARCHAR(255)")
    if "is_active" not in columns:
        statements.append(f"ALTER TABLE share_links ADD COLUMN is_active BOOLEAN DEFAULT {bool_default} NOT NULL")
    if "expires_at" not in columns:
        statements.append(f"ALTER TABLE share_links ADD COLUMN expires_at {timestamp_type}")
    if "created_at" not in columns:
        statements.append(f"ALTER TABLE share_links ADD COLUMN created_at {timestamp_type} DEFAULT CURRENT_TIMESTAMP")
    return statements


def repair_live_session_schema() -> None:
    """Keep databases created before media-state persistence usable."""
    inspector = inspect(engine)
    if "live_sessions" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("live_sessions")}
    statements = live_session_repair_statements(engine.dialect.name, columns)
    if not statements:
        return
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


def live_session_repair_statements(dialect_name: str, columns: set[str]) -> list[str]:
    is_sqlite = dialect_name == "sqlite"
    bool_default = "0" if is_sqlite else "FALSE"
    timestamp_type = "DATETIME" if is_sqlite else "TIMESTAMP WITH TIME ZONE"
    definitions = {
        "active_media_id": "VARCHAR(128)",
        "active_media_kind": "VARCHAR(16) DEFAULT 'slide' NOT NULL",
        "media_position": "FLOAT DEFAULT 0 NOT NULL",
        "media_playing": f"BOOLEAN DEFAULT {bool_default} NOT NULL",
        "media_muted": f"BOOLEAN DEFAULT {bool_default} NOT NULL",
        "media_updated_at": timestamp_type,
    }
    return [
        f"ALTER TABLE live_sessions ADD COLUMN {name} {definition}"
        for name, definition in definitions.items()
        if name not in columns
    ]


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
