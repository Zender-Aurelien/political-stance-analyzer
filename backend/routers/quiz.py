import hashlib
import json

from fastapi import APIRouter, Response

from backend.models.quiz import QuizQuestion
from backend.routers.candidates import ZipQuery
from backend.services import cloudant
from backend.services.civic import get_questions

router = APIRouter(tags=["Quiz"])


@router.get("/quiz", response_model=list[QuizQuestion])
async def quiz(response: Response, zip: ZipQuery = None):
    # Reviewed questions remain consistent for all users. Hash invalidates stale caches.
    questions = get_questions()
    static_payload = [question.model_dump() for question in questions]
    static_version = hashlib.sha256(json.dumps(static_payload, sort_keys=True).encode()).hexdigest()[:16]

    # Always keep the static set cached so the fallback path is warm.
    static_key = "quiz:" + static_version
    cached_static = await cloudant.get_document(static_key)
    if not cached_static or cached_static.get("questions") != static_payload:
        await cloudant.save_document(static_key, {"type": "quiz", "version": static_version, "questions": static_payload})

    response.headers["X-Quiz-Version"] = static_version
    return questions
