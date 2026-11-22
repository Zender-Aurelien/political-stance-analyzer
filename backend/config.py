"""Paths and configuration. Credentials never leave the server."""
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / "backend" / ".env")


def cache_path() -> Path:
    return Path(os.getenv("CACHE_PATH", str(ROOT / "backend" / ".cache" / "public-data.sqlite3")))


def watsonx_enabled() -> bool:
    return os.getenv("ENABLE_WATSONX", "false").lower() == "true" and all(
        os.getenv(key) for key in ("WATSONX_API_KEY", "WATSONX_PROJECT_ID", "WATSONX_URL", "WATSONX_MODEL_ID")
    )


def cloudant_configured() -> bool:
    return all(os.getenv(key) for key in ("CLOUDANT_URL", "CLOUDANT_APIKEY", "CLOUDANT_DB_NAME"))
