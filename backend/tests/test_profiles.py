import asyncio
from datetime import datetime, timezone
from pathlib import Path

import httpx
from fastapi.testclient import TestClient

from backend.main import app
from backend.models.candidate import CandidateResponse
from backend.services import profiles


def candidate(**updates):
    return CandidateResponse(id="example", name="Example Member", party="Democratic", office="Assembly Member", district="New York · District 1", **updates)


def test_only_official_hosts_can_be_fetched():
    assert profiles.official_url("https://www.nysenate.gov/senators/example/about")
    assert profiles.official_url("https://assembly.state.ny.us/mem/Example/bio/")
    assert profiles.official_url("https://comptroller.nyc.gov/about/")
    assert profiles.official_url("https://advocate.nyc.gov/about/")
    assert profiles.official_url("https://osc.ny.gov/about/")
    for url in ["http://127.0.0.1", "https://www.nysenate.gov.evil.org", "https://www.nysenate.gov@evil.org", "https://www.nysenate.gov:8080", "file:///etc/passwd"]:
        assert not profiles.official_url(url)


def test_biography_excerpt_ignores_navigation_and_is_short():
    page = profiles.BiographyHTML()
    page.feed('<nav><p>Subscribe to our newsletter and follow our latest news.</p></nav><main><p>Example Member worked as a public school teacher for eleven years before serving as an attorney and a state legislator.</p><script>ignore me</script></main>')
    text = profiles._excerpt(page.blocks)
    assert "teacher" in text
    assert "Subscribe" not in text
    assert len(text.split()) <= 24


def test_profile_sources_prefer_a_personal_page_over_chamber_directories():
    record = candidate(sources=["https://clerk.house.gov/members/O000172", "https://ocasio-cortez.house.gov/"])
    assert profiles._biography_url(record) == "https://ocasio-cortez.house.gov/"
    record.sources = ["https://www.nysenate.gov/senators-committees", "https://www.nysenate.gov/senators/zellnor-myrie/contact"]
    assert profiles._biography_url(record) == "https://www.nysenate.gov/senators/zellnor-myrie/about"


def test_biography_fetch_checks_redirect_destinations(monkeypatch):
    requested = []
    def respond(request):
        requested.append(str(request.url))
        return httpx.Response(302, headers={"location": "http://127.0.0.1/private"})
    factory = httpx.AsyncClient
    monkeypatch.setattr(profiles.httpx, "AsyncClient", lambda **kwargs: factory(transport=httpx.MockTransport(respond), **kwargs))
    assert asyncio.run(profiles._official_page("https://www.nysenate.gov/senators/example/about")) is None
    assert len(requested) == 1


def test_sponsorship_evidence_is_not_a_vote_or_ideology(monkeypatch):
    provider_id = "ocd-person/8a923d97-c689-4fb5-ac61-7b5e4ee950dd"
    monkeypatch.setenv("OPEN_STATES_API_KEY", "private-test-key")
    def respond(request):
        assert request.headers["x-api-key"] == "private-test-key"
        assert "private-test-key" not in str(request.url)
        return httpx.Response(200, json={"results": [
            {"identifier": "S 123", "title": "Expands school funding", "sources": [{"url": "http://www.nysenate.gov/legislation/bills/2025/S123"}], "sponsorships": [{"person": {"id": provider_id}, "primary": False}], "latest_action_date": "2026-01-01"},
            {"identifier": "S 456", "title": "Unrelated sponsor", "sources": [{"url": "https://www.nysenate.gov/legislation/bills/2025/S456"}], "sponsorships": [{"person": {"id": "other"}, "primary": True}]},
        ]})
    factory = httpx.AsyncClient
    monkeypatch.setattr(profiles.httpx, "AsyncClient", lambda **kwargs: factory(transport=httpx.MockTransport(respond), **kwargs))
    result = asyncio.run(profiles._legislation(candidate(providerId=provider_id)))
    assert len(result) == 1
    assert result[0]["kind"] == "Co-sponsor"
    assert result[0]["url"].startswith("https:")
    assert "stance" not in result[0]


def test_synchronization_cache_and_outage_keep_evidence(monkeypatch, tmp_path):
    monkeypatch.setenv("CACHE_PATH", str(tmp_path / "cache.sqlite3"))
    monkeypatch.delenv("CLOUDANT_URL", raising=False)
    calls = []
    async def background(_):
        calls.append("background")
        return {"bio": "An attributed official biography excerpt.", "biographySource": "https://www.nysenate.gov/senators/example/about", "biographyMode": "official_excerpt"}
    async def legislation(_):
        calls.append("legislation")
        return [{"title": "S 123: School funding", "url": "https://www.nysenate.gov/legislation/bills/2025/S123", "kind": "Primary sponsor"}]
    monkeypatch.setattr(profiles, "_background", background)
    monkeypatch.setattr(profiles, "_legislation", legislation)
    async def run():
        fresh = await profiles.synchronize_profile(candidate())
        cached = await profiles.synchronize_profile(candidate())
        assert calls == ["background", "legislation"]
        assert fresh.model_dump() == cached.model_dump()
        assert fresh.positions == []
        saved = await profiles.get_document(profiles.CACHE_PREFIX + "example")
        saved["fetchedAt"] = 0
        await profiles.save_document(profiles.CACHE_PREFIX + "example", saved)
        async def unavailable(_):
            return None
        monkeypatch.setattr(profiles, "_background", unavailable)
        monkeypatch.setattr(profiles, "_legislation", unavailable)
        stale = await profiles.synchronize_profile(candidate())
        assert stale.profileStatus == "cached"
        assert stale.profileCheckedAt == fresh.profileCheckedAt
        assert stale.policyEvidence == fresh.policyEvidence
    asyncio.run(run())


def test_reviewed_background_is_dated_not_reported_as_live(monkeypatch):
    read_text = Path.read_text
    def require_utf8(path, *args, **kwargs):
        if path.name == "reviewed-backgrounds.json":
            assert kwargs.get("encoding") == "utf-8"
        return read_text(path, *args, **kwargs)
    monkeypatch.setattr(Path, "read_text", require_utf8)
    async def unavailable(_):
        return None
    monkeypatch.setattr(profiles, "_official_page", unavailable)
    record = candidate(sources=["https://www.nysenate.gov/senators/stephen-t-chan"])
    record.id = "steve-chan"
    result = asyncio.run(profiles._background(record))
    assert result["biographyMode"] == "reviewed_summary"
    assert result["bio"].startswith("Chan’s")
    assert result["biographyReviewedAt"] == "2026-11-22"
    assert result["biographySource"].endswith("/about")


def test_profile_endpoint_resolves_known_candidates_only(monkeypatch):
    async def synced(record):
        return record
    monkeypatch.setattr("backend.routers.candidates.synchronize_profile", synced)
    with TestClient(app) as client:
        response = client.get("/api/candidates/zohran-mamdani/profile")
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        assert client.get("/api/candidates/not-a-real-person/profile").status_code == 404
