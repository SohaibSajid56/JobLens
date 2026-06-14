# backend/app/core/config.py
import os
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parents[2]
load_dotenv(BASE_DIR / ".env")


def require_env(name: str) -> str:
    value = os.getenv(name)
    if not value or not value.strip():
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value.strip()


class Settings:
    DATABASE_URL: str = require_env("DATABASE_URL")

    HF_TOKEN: str = require_env("HF_TOKEN")
    RAPIDAPI_KEY: str = os.getenv("RAPIDAPI_KEY", "").strip()

    SECRET_KEY: str = require_env("SECRET_KEY")
    ALGORITHM: str = os.getenv("ALGORITHM", "HS256")
    TOKEN_EXPIRE_MINUTES: int = int(os.getenv("TOKEN_EXPIRE_MINUTES", "10080"))


settings = Settings()