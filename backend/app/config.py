from functools import lru_cache
from pathlib import Path
from pydantic import BaseModel
import os


class Settings(BaseModel):
    app_name: str = "Present Studio Cloud"
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./present_studio.db")
    frontend_dir: Path = Path(__file__).resolve().parents[2] / "frontend"
    cors_origins: list[str] = ["http://127.0.0.1:8000", "http://localhost:8000"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
