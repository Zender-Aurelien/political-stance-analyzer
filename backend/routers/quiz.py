import hashlib
import json

from fastapi import APIRouter, Response

from backend.config import watsonx_enabled
from backend.models.quiz import QuizQuestion
from backend.routers.candidates import ZipQuery
from backend.services import cloudant
from backend.services.civic import get_questions
from backend.services.watsonx import generate_quiz_questions

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

    if not watsonx_enabled():
        response.headers["X-Quiz-Version"] = static_version
        return questions

    # Watsonx path: check for a cached rephrased set tied to this static version.
    rephrased_key = "quiz:rephrased:" + static_version
    cached_rephrased = await cloudant.get_document(rephrased_key)
    if cached_rephrased and isinstance(cached_rephrased.get("questions"), list):
        rephrased_payload = cached_rephrased["questions"]
        rephrased_version = hashlib.sha256(json.dumps(rephrased_payload, sort_keys=True).encode()).hexdigest()[:16]
        response.headers["X-Quiz-Version"] = rephrased_version
        return [QuizQuestion.model_validate(q) for q in rephrased_payload]

    # Cache miss: ask watsonx to rephrase the likert prompts.
    rephrased_dicts = await generate_quiz_questions(static_payload)
    if not rephrased_dicts:
        # Watsonx returned nothing useful — serve the static set unchanged.
        response.headers["X-Quiz-Version"] = static_version
        return questions

    await cloudant.save_document(rephrased_key, {"type": "rephrased_quiz", "version": static_version, "questions": rephrased_dicts})
    rephrased_version = hashlib.sha256(json.dumps(rephrased_dicts, sort_keys=True).encode()).hexdigest()[:16]
    response.headers["X-Quiz-Version"] = rephrased_version
    return [QuizQuestion.model_validate(q) for q in rephrased_dicts]
