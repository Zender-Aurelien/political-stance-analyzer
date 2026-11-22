from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class QuizOption(BaseModel):
    label: str
    value: str


class QuizQuestion(BaseModel):
    id: str
    type: Literal["text", "choice", "multicheck", "likert"]
    topic: str | None
    section: str
    prompt: str
    helpText: str = ""
    optional: bool = False
    placeholder: str = ""
    score: list[int] = Field(default_factory=list)
    options: list[QuizOption] = Field(default_factory=list)


class MatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # Only policy topic averages reach the API. Demographic context stays on-device.
    answers: Annotated[dict[str, Annotated[float, Field(ge=-2, le=2, allow_inf_nan=False)]], Field(min_length=1, max_length=20)]
    candidate_ids: Annotated[list[str], Field(min_length=1, max_length=24)]
    zip: Annotated[str | None, Field(pattern=r"^[0-9]{5}$")] = None

    @field_validator("answers", mode="before")
    @classmethod
    def numeric_answers(cls, value):
        if isinstance(value, dict) and any(type(score) not in (int, float) for score in value.values()):
            raise ValueError("Answers must be numeric policy scores between -2 and 2.")
        return value

    @field_validator("candidate_ids")
    @classmethod
    def unique_ids(cls, value):
        if len(value) != len(set(value)):
            raise ValueError("Candidate IDs must be unique.")
        return value


class MatchResult(BaseModel):
    candidate_id: str
    match_pct: int | None
    value_match_pct: int | None
    location_boost: int = 0
    shared_topics: list[str]
    explanation: str
    explanation_source: Literal["rules", "watsonx"] = "rules"
    explanation_basis: str | None = None
    explanation_checks: dict[str, bool] = Field(default_factory=dict)
    data_source: str = "sample"
