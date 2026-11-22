import os
from typing import Annotated

from fastapi import APIRouter, Query, Response

from backend.models.candidate import CandidateResponse
from backend.services.civic import get_candidates, get_candidates_merged, is_new_york_zip

router = APIRouter(tags=["Candidates"])
ZipQuery = Annotated[str | None, Query(pattern=r"^[0-9]{5}$")]


@router.get("/candidates", response_model=list[CandidateResponse])
async def candidates(response: Response, zip: ZipQuery = None):
    live_enabled = bool(os.getenv("OPEN_STATES_API_KEY", "").strip())
    if zip and live_enabled and is_new_york_zip(zip):
        results = await get_candidates_merged(zip)
        response.headers["X-Civic-Data-Source"] = "live+sample" if any(c.dataSource != "sample" for c in results) else "sample"
        return results
    response.headers["X-Civic-Data-Source"] = "sample"
    return get_candidates(zip)
