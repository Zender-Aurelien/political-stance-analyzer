from pydantic import BaseModel, Field
from typing import Literal


class Position(BaseModel):
    topic: str
    stance: str
    description: str


class PolicyEvidence(BaseModel):
    title: str
    url: str
    kind: str = "Sponsored legislation"
    date: str | None = None


class CandidateResponse(BaseModel):
    id: str
    name: str
    party: str
    office: str
    district: str
    photo: str = ""
    summary: str = ""
    bio: str = ""
    positions: list[Position] = Field(default_factory=list)
    zips: list[str] = Field(default_factory=list)
    sources: list[str] = Field(default_factory=list)
    lastVerified: str | None = None
    isPreview: bool = True
    dataSource: Literal["sample", "live", "live+sample"] = "sample"
    providerId: str | None = None
    profileUrl: str | None = None
    biographySource: str | None = None
    biographyMode: Literal["official_excerpt", "reviewed_summary", "sample", "unavailable"] = "unavailable"
    biographyReviewedAt: str | None = None
    policyEvidence: list[PolicyEvidence] = Field(default_factory=list)
    profileCheckedAt: str | None = None
    profileStatus: Literal["not_requested", "synced", "partial", "unavailable", "cached"] = "not_requested"
