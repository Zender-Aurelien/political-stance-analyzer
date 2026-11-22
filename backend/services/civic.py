"""Public sample profiles, with explicit ZIP coverage limits.

Google retired representativeInfoByAddress on April 30, 2025. This module does
not pretend the bundled dataset is a live representatives lookup.
"""
import json
import re

from backend.config import ROOT
from backend.models.candidate import CandidateResponse
from backend.models.quiz import QuizQuestion


def is_new_york_zip(zip_code: str) -> bool:
    # A format/coverage check, not an authoritative USPS ZIP existence check.
    return bool(re.fullmatch(r"(?:1[0-4][0-9]{3}|00501|00544|06390)", zip_code))


def get_candidates(zip_code: str | None = None) -> list[CandidateResponse]:
    records = json.loads((ROOT / "data" / "candidates.json").read_text())
    candidates = [CandidateResponse.model_validate({**record, "isPreview": True}) for record in records]
    if zip_code is None:
        return candidates
    if not is_new_york_zip(zip_code):
        return []
    return [candidate for candidate in candidates if not candidate.zips or zip_code in candidate.zips]


def get_questions() -> list[QuizQuestion]:
    records = json.loads((ROOT / "data" / "quiz.json").read_text())
    return [QuizQuestion.model_validate(record) for record in records]


def policy_topics() -> set[str]:
    return {question.topic for question in get_questions() if question.topic}
