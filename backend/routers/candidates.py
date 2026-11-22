from typing import Annotated

from fastapi import APIRouter, Query, Response

from backend.models.candidate import CandidateResponse
from backend.services.civic import get_candidates

router = APIRouter(tags=["Candidates"])
ZipQuery = Annotated[str | None, Query(pattern=r"^[0-9]{5}$")]


@router.get("/candidates", response_model=list[CandidateResponse])
def candidates(response: Response, zip: ZipQuery = None):
    response.headers["X-Civic-Data-Source"] = "sample"
    return get_candidates(zip)
