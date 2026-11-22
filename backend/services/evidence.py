"""Versioned excerpt retrieval and a fail-closed, per-summary evidence gate.

This first retrieval layer is filtered by person and exact source version. It
does not do semantic search, certify source truth, or infer political stances.
"""
import hashlib
import itertools
import json
import re
from datetime import datetime, timezone
from uuid import uuid4
from urllib.parse import urlsplit

from backend.models.evidence import SourceCitation, SummaryRun
from backend.services.cloudant import get_document, save_document
from backend.services.source_policy import official_url

PROMPT_VERSION = "public-biography-extractive-v1"
SNAPSHOT_PREFIX = "evidence-snapshot:v1:"
RUN_PREFIX = "evidence-run:v1:"


def digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def permitted_source(url: str, kind: str) -> bool:
    if kind == "official_biography":
        return official_url(url)
    try:
        parsed = urlsplit(url)
        return kind == "office_record" and parsed.scheme == "https" and parsed.hostname == "openstates.org" and not parsed.username and not parsed.password and parsed.port in (None, 443) and not parsed.query
    except ValueError:
        return False


async def index_excerpts(candidate_id: str, url: str, kind: str, facts: list[str]) -> list[SourceCitation]:
    """Persist a bounded excerpt snapshot; repeat ingestion reuses its version.

    contentHash describes the indexed excerpts, not the entire HTML page.
    capturedAt is the first local capture, not a publisher's publication date.
    """
    facts = list(dict.fromkeys(text.strip() for text in facts if isinstance(text, str) and text.strip()))
    if not permitted_source(url, kind) or not facts or len(facts) > 9 or any(len(text) > 2000 or len(text.split()) > 70 for text in facts):
        return []
    if any(re.search(r"ignore (?:all |previous )?instructions|reveal.{0,20}(?:secret|api.key)|<script", text, re.I) for text in facts):
        return []
    content_hash = digest(json.dumps(facts, ensure_ascii=False, separators=(",", ":")))
    source_id = digest(json.dumps([candidate_id, url, kind, content_hash], separators=(",", ":")))
    key = SNAPSHOT_PREFIX + source_id
    snapshot = await get_document(key)
    if snapshot is None:
        captured = datetime.now(timezone.utc).isoformat()
        chunks = [SourceCitation(sourceId=source_id, chunkId=digest(source_id + ":" + str(index) + ":" + text), candidateId=candidate_id, url=url, kind=kind, excerpt=text, excerptHash=digest(text), contentHash=content_hash, capturedAt=captured) for index, text in enumerate(facts)]
        snapshot = {"type": "evidence_snapshot", "candidateId": candidate_id, "sourceId": source_id, "contentHash": content_hash, "chunks": [chunk.model_dump() for chunk in chunks]}
        await save_document(key, snapshot)
    return await retrieve_excerpts(candidate_id, source_id)


async def retrieve_excerpts(candidate_id: str, source_id: str) -> list[SourceCitation]:
    """Retrieve a specific person's excerpt version and verify stored integrity."""
    snapshot = await get_document(SNAPSHOT_PREFIX + source_id)
    if not snapshot or snapshot.get("candidateId") != candidate_id or snapshot.get("sourceId") != source_id:
        return []
    try:
        if not isinstance(snapshot["chunks"], list) or len(snapshot["chunks"]) > 9:
            return []
        chunks = [SourceCitation.model_validate(chunk) for chunk in snapshot["chunks"]]
        text_hash = digest(json.dumps([chunk.excerpt for chunk in chunks], ensure_ascii=False, separators=(",", ":")))
        if text_hash != snapshot["contentHash"]:
            return []
        for index, chunk in enumerate(chunks):
            if chunk.candidateId != candidate_id or chunk.sourceId != source_id or chunk.contentHash != text_hash or chunk.excerptHash != digest(chunk.excerpt) or chunk.chunkId != digest(source_id + ":" + str(index) + ":" + chunk.excerpt) or not permitted_source(chunk.url, chunk.kind):
                return []
        # Bind the source version to the subject, URL, type and ordered excerpts.
        if not chunks or any((chunk.url, chunk.kind) != (chunks[0].url, chunks[0].kind) for chunk in chunks):
            return []
        expected = digest(json.dumps([candidate_id, chunks[0].url, chunks[0].kind, text_hash], separators=(",", ":")))
        return chunks if source_id == expected else []
    except (KeyError, ValueError, TypeError):
        return []


def check_summary(candidate_id: str, text: str, chunks: list[SourceCitation]) -> tuple[dict[str, bool], list[SourceCitation]]:
    """Accept only an exact concatenation of one or two retrieved excerpts."""
    checks = {
        "has_evidence": bool(chunks),
        "subject_bound": bool(chunks) and all(c.candidateId == candidate_id for c in chunks),
        "allowed_sources": bool(chunks) and all(permitted_source(c.url, c.kind) for c in chunks),
        "excerpt_hashes": bool(chunks) and all(c.excerptHash == digest(c.excerpt) for c in chunks),
        "within_word_limit": bool(text) and len(text.split()) <= 70,
        "within_character_limit": bool(text) and len(text) <= 2000,
        "output_from_retrieved_excerpts": False,
    }
    selected = []
    if text:
        for size in (1, 2):
            match = next((list(items) for items in itertools.permutations(chunks, size) if " ".join(c.excerpt for c in items) == text), None)
            if match:
                checks["output_from_retrieved_excerpts"] = True
                selected = match
                break
    return checks, selected


async def record_run(candidate_id: str, summary: str, chunks: list[SourceCitation], *, mode: str, model_id: str | None, model_checks: dict[str, bool], duration_ms: int, fallback: bool = False) -> SummaryRun:
    checks, citations = check_summary(candidate_id, summary, chunks)
    accepted = all(checks.values())
    run = SummaryRun(runId=uuid4().hex, candidateId=candidate_id, createdAt=datetime.now(timezone.utc).isoformat(), mode=mode, modelId=model_id, promptVersion=PROMPT_VERSION, outcome="fallback" if accepted and fallback else "supported" if accepted else "unavailable", modelOutputChecks=model_checks, publicationChecks=checks, citations=citations if accepted else [], summary=summary if accepted else "", durationMs=duration_ms)
    await save_document(RUN_PREFIX + run.runId, run.model_dump())
    return run


async def get_run(candidate_id: str, run_id: str) -> SummaryRun | None:
    if not re.fullmatch(r"[0-9a-f]{32}", run_id):
        return None
    stored = await get_document(RUN_PREFIX + run_id)
    if not stored or stored.get("candidateId") != candidate_id:
        return None
    try:
        run = SummaryRun.model_validate(stored)
        if run.runId != run_id:
            return None
        return run
    except ValueError:
        return None


async def verify_cached_summary(candidate_id: str, fields: dict) -> bool:
    """Reject altered or untraceable cached AI text before serving it."""
    run_id = fields.get("biographyRunId")
    if not run_id:
        return fields.get("biographyMode") != "watsonx_summary"
    run = await get_run(candidate_id, run_id)
    if run is None or run.summary != fields.get("bio") or run.outcome == "unavailable":
        return False
    chunks = []
    for source_id in dict.fromkeys(c.sourceId for c in run.citations):
        chunks.extend(await retrieve_excerpts(candidate_id, source_id))
    checks, citations = check_summary(candidate_id, run.summary, chunks)
    return all(checks.values()) and citations == run.citations
