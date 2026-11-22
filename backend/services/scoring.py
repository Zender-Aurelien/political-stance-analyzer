"""Reproducible values matching on the same spectrum as the frontend."""
import math

from backend.models.candidate import CandidateResponse
from backend.models.quiz import MatchResult

STANCE_SCORE = {
    "expand": 2, "support": 2, "increase": 2, "reform": 1, "regulate": 1,
    "neutral": 0, "market": -1, "deregulate": -1,
    "decrease": -2, "restrict": -2, "oppose": -2,
}


def score_candidate(candidate: CandidateResponse, answers: dict[str, float], zip_code: str | None = None) -> MatchResult:
    shared = {p.topic: p for p in candidate.positions if p.topic in answers and p.stance in STANCE_SCORE}
    if not shared:
        return MatchResult(candidate_id=candidate.id, match_pct=None, value_match_pct=None,
                           shared_topics=[], explanation="Not enough shared policy data to calculate a match.")
    differences = {topic: abs(answers[topic] - STANCE_SCORE[p.stance]) for topic, p in shared.items()}
    pct = math.floor(100 - sum(differences.values()) / (4 * len(shared)) * 100 + 0.5)
    boost = 4 if zip_code and (not candidate.zips or zip_code in candidate.zips) else 0
    aligned = [topic.replace("_", " ") for topic, difference in differences.items() if difference <= 1]
    differing = [topic.replace("_", " ") for topic, difference in differences.items() if difference > 2.5]
    parts = [f"Compared {len(shared)} shared policy topics against this sample profile."]
    if aligned:
        parts.append("Closer alignment: " + ", ".join(aligned) + ".")
    if differing:
        parts.append("Larger differences: " + ", ".join(differing) + ".")
    if boost:
        parts.append("Sample ZIP coverage adds 4 points; exact district representation is not verified.")
    return MatchResult(candidate_id=candidate.id, match_pct=min(100, pct + boost),
                       value_match_pct=pct, location_boost=boost, shared_topics=list(shared),
                       explanation=" ".join(parts))
