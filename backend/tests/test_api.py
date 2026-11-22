import asyncio

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.models.candidate import CandidateResponse, Position
from backend.services import cloudant, watsonx
from backend.services.scoring import score_candidate


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("CACHE_PATH", str(tmp_path / "cache.sqlite3"))
    monkeypatch.setenv("ENABLE_WATSONX", "false")
    monkeypatch.delenv("CLOUDANT_URL", raising=False)
    monkeypatch.delenv("OPEN_STATES_API_KEY", raising=False)
    with TestClient(app) as session:
        yield session


def test_full_workflow(client):
    assert client.get("/health").json()["status"] == "ok"
    profiles = client.get("/api/candidates").json()
    assert len(profiles) == 17
    assert all(profile["isPreview"] for profile in profiles)
    questions = client.get("/api/quiz").json()
    assert len(questions) > 10
    topics = {question["topic"] for question in questions if question["topic"]}
    body = {"answers": {topic: 1 for topic in topics}, "candidate_ids": [profile["id"] for profile in profiles], "zip": "10027"}
    response = client.post("/api/match", json=body)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    results = response.json()
    assert len(results) == len(profiles)
    scores = [result["match_pct"] for result in results]
    assert scores == sorted(scores, reverse=True)
    assert all(0 <= score <= 100 for score in scores)
    assert all(result["explanation"] and result["explanation_source"] == "rules" for result in results)
    assert client.get("/api/quiz").json() == questions


def test_zip_search(client):
    profiles = client.get("/api/candidates?zip=10027").json()
    assert profiles
    assert all(not profile["zips"] or "10027" in profile["zips"] for profile in profiles)
    assert client.get("/api/candidates?zip=90210").json() == []
    assert client.get("/api/candidates?zip=00501").status_code == 200
    assert client.get("/api/candidates?zip=12").status_code == 422
    assert client.get("/api/quiz?zip=abcde").status_code == 422


@pytest.mark.parametrize("changes", [
    {"answers": {}}, {"answers": {"housing": 3}}, {"answers": {"housing": -3}},
    {"answers": {"housing": True}}, {"answers": {"housing": "expand"}},
    {"answers": {"income": 1}}, {"candidate_ids": []},
    {"candidate_ids": ["zohran-mamdani", "zohran-mamdani"]},
    {"zip": "123"}, {"zip": "90210"}, {"age": 35},
])
def test_invalid_match_request(client, changes):
    body = {"answers": {"housing": 2}, "candidate_ids": ["zohran-mamdani"], **changes}
    assert client.post("/api/match", json=body).status_code == 422


def test_unknown_candidate(client):
    assert client.post("/api/match", json={"answers": {"housing": 2}, "candidate_ids": ["missing"]}).status_code == 404


def test_scoring_extremes_and_unknown_stance():
    candidate = CandidateResponse(id="test", name="Test", party="Test", office="Test", district="Test", positions=[Position(topic="housing", stance="expand", description="Test")])
    assert score_candidate(candidate, {"housing": 2}).match_pct == 100
    assert score_candidate(candidate, {"housing": -2}).match_pct == 0
    assert score_candidate(candidate, {"housing": 0}).match_pct == 50
    assert score_candidate(candidate, {"housing": 0}, "10027").match_pct == 54
    assert score_candidate(candidate, {"housing": 2}, "10027").match_pct == 100
    assert score_candidate(candidate, {"climate": 2}).match_pct is None
    candidate.positions[0].stance = "unverified"
    assert score_candidate(candidate, {"housing": 2}).match_pct is None


def test_public_cache_persists_and_updates(client):
    async def run():
        assert await cloudant.get_document("quiz:test") is None
        await cloudant.save_document("quiz:test", {"type": "quiz", "version": 1})
        assert (await cloudant.get_document("quiz:test"))["version"] == 1
        await cloudant.save_document("quiz:test", {"type": "quiz", "version": 2})
        assert (await cloudant.get_document("quiz:test"))["version"] == 2
        assert len(await cloudant.query_by_field("type", "quiz")) == 1
    asyncio.run(run())


def test_cloudant_outage_falls_back_locally(client, monkeypatch):
    import httpx
    monkeypatch.setenv("CLOUDANT_URL", "https://test.cloudant.com")
    monkeypatch.setenv("CLOUDANT_APIKEY", "test")
    monkeypatch.setenv("CLOUDANT_DB_NAME", "test")
    async def unavailable(*args, **kwargs):
        raise httpx.ConnectError("offline")
    monkeypatch.setattr(cloudant, "_request", unavailable)
    async def run():
        await cloudant.save_document("public:test", {"type": "test"})
        assert (await cloudant.get_document("public:test"))["type"] == "test"
    asyncio.run(run())


def test_disabled_ai_does_not_call_ibm(client, monkeypatch):
    async def forbidden(*args):
        raise AssertionError("AI is disabled")
    monkeypatch.setattr(watsonx, "get_token", forbidden)
    assert asyncio.run(watsonx.explain_match({"housing": 2}, {}, "test")) == ""


def test_ai_outage_keeps_match_scores(client, monkeypatch):
    import httpx
    for key in ("WATSONX_API_KEY", "WATSONX_SPACE_ID", "WATSONX_URL", "WATSONX_MODEL_ID"):
        monkeypatch.setenv(key, "test")
    monkeypatch.setenv("ENABLE_WATSONX", "true")
    async def unavailable(*args):
        raise httpx.ConnectError("offline")
    monkeypatch.setattr(watsonx, "get_token", unavailable)
    result = client.post("/api/match", json={"answers": {"housing": 2}, "candidate_ids": ["zohran-mamdani"]}).json()[0]
    assert result["match_pct"] == 100
    assert result["explanation_source"] == "rules"


def test_static_files_do_not_expose_private_files(client):
    assert client.get("/").status_code == 200
    assert client.get("/JS/main.js").status_code == 200
    assert client.get("/about.html").status_code == 200
    for path in ("/backend/.env", "/.git/config", "/backend/main.py", "/data/../backend/.env", "/.env"):
        assert client.get(path).status_code == 404


def test_cors_and_status(client):
    approved = client.get("/health", headers={"Origin": "http://localhost:5500"})
    assert approved.headers["access-control-allow-origin"] == "http://localhost:5500"
    unapproved = client.get("/health", headers={"Origin": "https://example.org"})
    assert "access-control-allow-origin" not in unapproved.headers
    status = client.get("/api/status").json()
    assert status["data_source"] == "sample"
    assert status["live_representatives"] is False
