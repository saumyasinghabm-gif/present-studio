from functools import lru_cache
from pathlib import Path
from pydantic import BaseModel
import os


class Settings(BaseModel):
    app_name: str = "Present Studio Cloud"
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./present_studio.db")
    frontend_dir: Path = Path(__file__).resolve().parents[2] / "frontend"
    cors_origins: list[str] = ["http://127.0.0.1:8000", "http://localhost:8000"]
    jwt_secret: str = os.getenv("JWT_SECRET", "change-this-secret-before-production")
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = int(os.getenv("ACCESS_TOKEN_MINUTES", "1440"))
    public_base_url: str = os.getenv("PUBLIC_BASE_URL", "http://127.0.0.1:8000")
    cloudinary_cloud_name: str | None = os.getenv("CLOUDINARY_CLOUD_NAME")
    cloudinary_api_key: str | None = os.getenv("CLOUDINARY_API_KEY")
    cloudinary_api_secret: str | None = os.getenv("CLOUDINARY_API_SECRET")
    cloudinary_folder: str = os.getenv("CLOUDINARY_FOLDER", "present-studio")


@lru_cache
def get_settings() -> Settings:
    return Settings()
