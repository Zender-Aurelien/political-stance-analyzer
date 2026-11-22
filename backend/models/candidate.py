from pydantic import BaseModel, Field
from typing import Literal


class Position(BaseModel):
    topic: str
    stance: str
    description: str


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
