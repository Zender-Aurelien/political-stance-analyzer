"""Run from the repository root: python -m uvicorn backend.main:app."""
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.responses import Response

from backend.config import ROOT, cloudant_configured, openstates_configured, watsonx_enabled, watsonx_bios_enabled
from backend.routers import candidates, match, quiz
from backend.services.civic import get_candidates, get_questions


class _Utf8JsonResponse(JSONResponse):
    """JSONResponse with an explicit charset=utf-8 in Content-Type.

    FastAPI's default JSONResponse omits the charset, which causes Firefox on
    Windows to fall back to the system encoding (cp1252), breaking multi-byte
    UTF-8 characters like em-dashes and accented letters in API responses.
    """
    media_type = "application/json; charset=utf-8"


class _Utf8StaticFiles(StaticFiles):
    """StaticFiles that appends charset=utf-8 to text/* and application/json responses."""

    _FORCE_UTF8 = {"application/json", "application/javascript",
                   "text/html", "text/css", "text/plain", "text/javascript"}

    async def get_response(self, path: str, scope) -> Response:
        response = await super().get_response(path, scope)
        ct = response.headers.get("content-type", "")
        mime = ct.split(";")[0].strip()
        if mime in self._FORCE_UTF8 and "charset" not in ct:
            response.headers["content-type"] = f"{mime}; charset=utf-8"
        return response


app = FastAPI(
    title="Civic Lens API",
    version="1.0.0",
    description="Values matching demo using labeled sample New York profiles.",
    default_response_class=_Utf8JsonResponse,
)
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
    live = openstates_configured()
    return {
        "status": "ok",
        "data_source": "live+sample" if live else "sample",
        "candidate_count": len(get_candidates()),
        "question_count": len(get_questions()),
        "live_representatives": live,
        "scoring": "deterministic",
        "watsonx_enabled": watsonx_enabled(),
        "watsonx_bios_enabled": watsonx_bios_enabled(),
        "cloudant_configured": cloudant_configured(),
        "openstates_configured": live,
        "notice": (
            "Live NY state legislator data via Open States API; federal and local officials from sample profiles."
            if live else
            "Demo using included sample profiles. ZIP coverage and positions are not verified live election data."
        ),
    }


@app.get("/", include_in_schema=False)
@app.get("/index.html", include_in_schema=False)
def home():
    return FileResponse(ROOT / "frontend" / "index.html")


@app.get("/about.html", include_in_schema=False)
def about():
    return FileResponse(ROOT / "frontend" / "about.html")


# Mount only public assets. Never expose .env, .git, backend source, or cache.
for directory in ("JS", "Styles.css", "accessibility", "assets"):
    app.mount("/" + directory, _Utf8StaticFiles(directory=ROOT / "frontend" / directory), name=directory)
# data/ lives at the repo root (shared between frontend and backend).
app.mount("/data", _Utf8StaticFiles(directory=ROOT / "data"), name="data")
