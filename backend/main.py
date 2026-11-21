import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Civic Lens API", version="0.1.0")

# ---------------------------------------------------------------------------
# CORS — allow the frontend origin (set FRONTEND_ORIGIN in .env)
# ---------------------------------------------------------------------------
frontend_origin = os.getenv("FRONTEND_ORIGIN", "*")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Routers — uncomment each as the corresponding sub-task is implemented
# ---------------------------------------------------------------------------
# from routers import candidates as candidates_router
# from routers import quiz as quiz_router
# from routers import match as match_router

# app.include_router(candidates_router.router, prefix="/api")
# app.include_router(quiz_router.router, prefix="/api")
# app.include_router(match_router.router, prefix="/api")


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------
@app.get("/health")
async def health():
    return {"status": "ok"}
