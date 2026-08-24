from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import socketio
from .config import get_settings
from .database import Base, SessionLocal, engine
from .routers import auth, media, presentations
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
    db = SessionLocal()
    try:
        seed_demo_data(db)
    finally:
        db.close()


@fastapi_app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


fastapi_app.include_router(auth.router)
fastapi_app.include_router(presentations.router)
fastapi_app.include_router(media.router)

fastapi_app.mount("/", StaticFiles(directory=settings.frontend_dir, html=True), name="frontend")

app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app)
