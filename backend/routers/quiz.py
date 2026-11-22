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
    payload = [question.model_dump() for question in questions]
    version = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:16]
    key = "quiz:" + version
    cached = await cloudant.get_document(key)
    if not cached or cached.get("questions") != payload:
        await cloudant.save_document(key, {"type": "quiz", "version": version, "questions": payload})
    response.headers["X-Quiz-Version"] = version
    return questions
