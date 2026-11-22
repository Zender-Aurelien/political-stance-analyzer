import asyncio

from fastapi import APIRouter, HTTPException, Response

from backend.models.quiz import MatchRequest, MatchResult
from backend.services.civic import get_candidates, is_new_york_zip, policy_topics
from backend.services.scoring import score_candidate
from backend.services.watsonx import explain_match

router = APIRouter(tags=["Matches"])


@router.post("/match", response_model=list[MatchResult])
async def match(payload: MatchRequest, response: Response):
    response.headers["Cache-Control"] = "no-store"
    unknown_topics = set(payload.answers) - policy_topics()
    if unknown_topics:
        raise HTTPException(422, "Answers contain unsupported policy topics.")
    if payload.zip and not is_new_york_zip(payload.zip):
        raise HTTPException(422, "Matching currently covers New York ZIP codes only.")
    candidates = {candidate.id: candidate for candidate in get_candidates()}
    if set(payload.candidate_ids) - candidates.keys():
        raise HTTPException(404, "One or more candidate IDs were not found.")

    async def calculate(candidate_id: str):
        candidate = candidates[candidate_id]
        result = score_candidate(candidate, payload.answers, payload.zip)
        if result.match_pct is not None:
            baseline = result.explanation
            explanation = await explain_match(payload.answers, candidate.model_dump(), result.explanation)
            if explanation:
                result.explanation = explanation
                result.explanation_source = "watsonx"
                result.explanation_basis = baseline
                result.explanation_checks = {"computed_text_only": True, "score_unchanged": True}
        return result

    results = await asyncio.gather(*(calculate(candidate_id) for candidate_id in payload.candidate_ids))
    return sorted(results, key=lambda result: result.match_pct if result.match_pct is not None else -1, reverse=True)
