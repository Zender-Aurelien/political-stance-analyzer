"""Candidate lookup — local JSON sample profiles plus optional Open States enrichment.

Google retired representativeInfoByAddress on April 30, 2025.  Live NY state
legislator data is now sourced from the Open States API (services/openstates.py)
when OPEN_STATES_API_KEY is configured.  The bundled data/candidates.json always
serves as the authoritative fallback for federal and local officials.
"""
import json
import logging
import re

from backend.config import ROOT
from backend.models.candidate import CandidateResponse
from backend.models.quiz import QuizQuestion

logger = logging.getLogger(__name__)
_live_candidates: dict[str, CandidateResponse] = {}


def is_new_york_zip(zip_code: str) -> bool:
    # A format/coverage check, not an authoritative USPS ZIP existence check.
    return bool(re.fullmatch(r"(?:1[0-4][0-9]{3}|00501|00544|06390)", zip_code))


def _load_local_records() -> list[dict]:
    return json.loads((ROOT / "data" / "candidates.json").read_text(encoding="utf-8"))


def get_candidates(zip_code: str | None = None) -> list[CandidateResponse]:
    """Return local sample candidates, optionally filtered by ZIP."""
    records = _load_local_records()
    candidates = [CandidateResponse.model_validate({**record, "isPreview": True}) for record in records]
    if zip_code is None:
        return candidates
    if not is_new_york_zip(zip_code):
        return []
    return [candidate for candidate in candidates if not candidate.zips or zip_code in candidate.zips]


def get_candidates_by_zip_local(zip_code: str) -> list[dict]:
    """Return raw local records matching a ZIP, as plain dicts (for merging).

    Each dict matches the internal shape used by openstates.get_representatives_by_zip:
    { id, name, party, office, district, photo_url, website, positions, sources, source }
    """
    if not is_new_york_zip(zip_code):
        return []
    results = []
    for record in _load_local_records():
        zips = record.get("zips") or []
        if zips and zip_code not in zips:
            continue
        results.append({
            "id": record["id"],
            "name": record.get("name", ""),
            "party": record.get("party", ""),
            "office": record.get("office", ""),
            "district": record.get("district", ""),
            "photo_url": record.get("photo") or None,
            "website": (record.get("sources") or [None])[0],
            "positions": record.get("positions") or [],
            "sources": record.get("sources") or [],
            "bio": record.get("bio", ""),
            "summary": record.get("summary", ""),
            "lastVerified": record.get("lastVerified"),
            "isPreview": True,
            "zips": zips,
            "source": "local",
        })
    return results


async def get_candidates_merged(zip_code: str) -> list[CandidateResponse]:
    """Return candidates for a ZIP by merging Open States (live) with local JSON.

    Merge rules:
    - Both sources are queried concurrently.
    - If the same candidate appears in both (matched by id slug), the Open States
      record is used as the base but the local record's positions, bio, summary,
      and sources are merged in (local editorial data takes precedence for content).
    - Candidates only in the local set are included as-is.
    - Candidates only in Open States have no inferred policy stances. Their
      background and legislative evidence can be requested via the profile route.
    - data_source header hint: "live+sample" if Open States returned anything,
      otherwise "sample".
    """
    import asyncio
    from backend.services.openstates import get_representatives_by_zip as _openstates

    local_records, live_records = await asyncio.gather(
        asyncio.to_thread(get_candidates_by_zip_local, zip_code),
        _openstates(zip_code),
    )

    if not live_records:
        return get_candidates(zip_code)

    # Index local records by id for O(1) merge lookups.
    local_by_id: dict[str, dict] = {r["id"]: r for r in local_records}

    merged: dict[str, dict] = {}

    # Start with live records; merge in local editorial content where available.
    for live in live_records:
        cid = live["id"]
        local = local_by_id.get(cid, {})
        merged[cid] = {
            **live,
            # Prefer local editorial fields when present.
            "positions": local.get("positions") or live.get("positions") or [],
            "bio": local.get("bio") or "",
            "summary": local.get("summary") or "",
            "sources": local.get("sources") or live.get("sources") or [],
            "lastVerified": local.get("lastVerified"),
            "isPreview": local.get("isPreview", True),
            # photo: prefer local asset path; fall back to Open States URL
            "photo": local.get("photo_url") or live.get("photo_url") or "",
            "source": "live+sample" if local else "live",
            "zips": local.get("zips", []),
        }

    # Add any local-only records not already covered by Open States.
    for local in local_records:
        cid = local["id"]
        if cid not in merged:
            merged[cid] = {**local, "photo": local.get("photo_url") or ""}

    if not merged:
        return []

    candidates = []
    for data in merged.values():
        try:
            candidates.append(CandidateResponse.model_validate({
                "id": data["id"],
                "name": data["name"],
                "party": data["party"],
                "office": data["office"],
                "district": data["district"],
                "photo": data.get("photo") or "",
                "summary": data.get("summary") or "",
                "bio": data.get("bio") or "",
                "positions": data.get("positions") or [],
                "zips": data.get("zips") or [],
                "sources": data.get("sources") or [],
                "lastVerified": data.get("lastVerified"),
                "isPreview": data.get("isPreview", True),
                "dataSource": {"local": "sample", "live": "live", "live+sample": "live+sample"}[data["source"]],
                "providerId": data.get("providerId"),
                "providerUrl": data.get("providerUrl"),
            }))
        except Exception:
            logger.warning("civic: skipping malformed candidate record id=%s", data.get("id"))
    for candidate in candidates:
        if candidate.dataSource != "sample":
            _live_candidates[candidate.id] = candidate
    return candidates


async def get_profile_candidate(candidate_id: str, zip_code: str | None = None) -> CandidateResponse | None:
    if candidate_id in _live_candidates:
        return _live_candidates[candidate_id]
    local = next((c for c in get_candidates() if c.id == candidate_id), None)
    if local:
        return local
    if zip_code and is_new_york_zip(zip_code):
        return next((c for c in await get_candidates_merged(zip_code) if c.id == candidate_id), None)
    return None


def get_questions() -> list[QuizQuestion]:
    records = json.loads((ROOT / "data" / "quiz.json").read_text(encoding="utf-8"))
    return [QuizQuestion.model_validate(record) for record in records]


def policy_topics() -> set[str]:
    return {question.topic for question in get_questions() if question.topic}
