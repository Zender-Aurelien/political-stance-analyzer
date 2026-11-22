"""Run from the repository root: python -m uvicorn backend.main:app."""
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.config import ROOT, cloudant_configured, watsonx_enabled
from backend.routers import candidates, match, quiz
from backend.services.civic import get_candidates, get_questions

app = FastAPI(title="Civic Lens API", version="1.0.0", description="Values matching demo using labeled sample New York profiles.")
origins = [origin.strip() for origin in os.getenv("FRONTEND_ORIGIN", "http://localhost:5500,http://127.0.0.1:5500").split(",") if origin.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=False,
                   allow_methods=["GET", "POST"], allow_headers=["Content-Type"])
app.include_router(candidates.router, prefix="/api")
app.include_router(quiz.router, prefix="/api")
app.include_router(match.router, prefix="/api")


@app.get("/health", tags=["Status"])
def health():
    return {"status": "ok", "version": "1.0.0", "data_source": "sample"}


@app.get("/api/status", tags=["Status"])
def status():
    return {
        "status": "ok", "data_source": "sample", "candidate_count": len(get_candidates()),
        "question_count": len(get_questions()), "live_representatives": False,
        "scoring": "deterministic", "watsonx_enabled": watsonx_enabled(),
        "cloudant_configured": cloudant_configured(),
        "notice": "Demo using included sample profiles. ZIP coverage and positions are not verified live election data.",
    }


@app.get("/", include_in_schema=False)
@app.get("/index.html", include_in_schema=False)
def home():
    return FileResponse(ROOT / "index.html")


@app.get("/about.html", include_in_schema=False)
def about():
    return FileResponse(ROOT / "about.html")


# Mount only public assets. Never expose .env, .git, backend source, or cache.
for directory in ("JS", "Styles.css", "assets", "data"):
    app.mount("/" + directory, StaticFiles(directory=ROOT / directory), name=directory)
