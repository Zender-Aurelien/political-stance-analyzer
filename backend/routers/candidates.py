import os
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response

from backend.models.candidate import CandidateResponse
from backend.services.civic import get_candidates, get_candidates_merged, get_profile_candidate, is_new_york_zip
from backend.services.profiles import synchronize_profile

router = APIRouter(tags=["Candidates"])
ZipQuery = Annotated[str | None, Query(pattern=r"^[0-9]{5}$")]


@router.get("/candidates", response_model=list[CandidateResponse])
async def candidates(response: Response, zip: ZipQuery = None):
    live_enabled = bool(os.getenv("OPEN_STATES_API_KEY", "").strip())
    if zip and live_enabled and is_new_york_zip(zip):
        results = await get_candidates_merged(zip)
        response.headers["X-Civic-Data-Source"] = "live+sample" if any(c.dataSource != "sample" for c in results) else "sample"
        return [candidate.model_copy(update={"profileUrl": f"/api/candidates/{candidate.id}/profile?zip={zip}"}) for candidate in results]
    response.headers["X-Civic-Data-Source"] = "sample"
    return [candidate.model_copy(update={"profileUrl": f"/api/candidates/{candidate.id}/profile"}) for candidate in get_candidates(zip)]


@router.get("/candidates/{candidate_id}/profile", response_model=CandidateResponse)
async def profile(candidate_id: str, response: Response, zip: ZipQuery = None):
    if len(candidate_id) > 160 or not all(c.isalnum() or c == "-" for c in candidate_id):
        raise HTTPException(404, "Profile not found.")
    candidate = await get_profile_candidate(candidate_id, zip)
    if candidate is None:
        raise HTTPException(404, "Profile not found.")
    response.headers["Cache-Control"] = "no-store"
    return await synchronize_profile(candidate)
