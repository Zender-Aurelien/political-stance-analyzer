"""Public source excerpts and generation records; never user quiz answers."""
from typing import Literal

from pydantic import BaseModel, Field


class SourceCitation(BaseModel):
    sourceId: str
    chunkId: str
    candidateId: str
    url: str
    kind: Literal["official_biography", "office_record"]
    excerpt: str = Field(max_length=2000)
    excerptHash: str
    contentHash: str
    capturedAt: str


class SummaryRun(BaseModel):
    runId: str
    candidateId: str
    createdAt: str
    mode: str
    modelId: str | None = None
    promptVersion: str
    outcome: Literal["supported", "fallback", "unavailable"]
    modelOutputChecks: dict[str, bool] = Field(default_factory=dict)
    publicationChecks: dict[str, bool] = Field(default_factory=dict)
    citations: list[SourceCitation] = Field(default_factory=list)
    summary: str
    durationMs: int
