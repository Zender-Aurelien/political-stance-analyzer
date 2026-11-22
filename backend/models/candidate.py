from pydantic import BaseModel, Field
from typing import Literal
from backend.models.evidence import SourceCitation


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
    providerUrl: str | None = None
    profileUrl: str | None = None
    biographySource: str | None = None
    biographyMode: Literal["official_excerpt", "reviewed_summary", "watsonx_summary", "office_record", "sample", "unavailable"] = "unavailable"
    biographyScope: Literal["career", "office"] = "career"
    biographyReviewedAt: str | None = None
    biographyCheckedAt: str | None = None
    biographyRunId: str | None = None
    biographyTraceUrl: str | None = None
    biographyCitations: list[SourceCitation] = Field(default_factory=list)
    policyEvidence: list[PolicyEvidence] = Field(default_factory=list)
    legislationCheckedAt: str | None = None
    profileCheckedAt: str | None = None
    profileStatus: Literal["not_requested", "synced", "partial", "unavailable", "cached"] = "not_requested"
