import asyncio
import json

import httpx
import pytest

from backend.services import profiles, watsonx
from backend.tests.test_profiles import candidate


def configure(monkeypatch):
    monkeypatch.setenv("ENABLE_WATSONX_BIOS", "true")
    monkeypatch.setenv("ENABLE_WATSONX", "false")
    for key in ["WATSONX_API_KEY", "WATSONX_PROJECT_ID", "WATSONX_MODEL_ID"]:
        monkeypatch.setenv(key, "test-value")
    monkeypatch.setenv("WATSONX_URL", "https://us-south.ml.cloud.ibm.com")
    async def token(_):
        return "test-token"
    monkeypatch.setattr(watsonx, "get_token", token)


@pytest.mark.parametrize("output,expected", [
    ({"sentences": [1, 0]}, "She previously worked as a teacher. Example Member is a state legislator."),
    ({"sentences": [8]}, ""),
    ({"sentences": [True]}, ""),
    ({"bio": "An invented career as a doctor."}, ""),
])
def test_watsonx_only_selects_supplied_facts(monkeypatch, output, expected):
    configure(monkeypatch)
    facts = ["Example Member is a state legislator.", "She previously worked as a teacher."]
    def respond(request):
        assert request.url.path == "/ml/v1/text/chat"
        body = json.loads(request.content)
        assert json.loads(body["messages"][1]["content"]) == {"facts": facts}
        assert "answers" not in body and "zip" not in body
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(output)}}]})
    factory = httpx.AsyncClient
    monkeypatch.setattr(watsonx.httpx, "AsyncClient", lambda **kwargs: factory(transport=httpx.MockTransport(respond), **kwargs))
    assert asyncio.run(watsonx.summarize_biography(facts)) == expected
    assert not watsonx.watsonx_enabled()  # profile opt-in must not enable quiz sharing


def test_blocked_biography_produces_honest_office_overview_even_if_ibm_fails(monkeypatch):
    configure(monkeypatch)
    async def unavailable(_):
        return ""
    monkeypatch.setattr(profiles, "summarize_biography", unavailable)
    result = asyncio.run(profiles._complete_background(candidate(dataSource="live"), {}))
    assert result["biographyScope"] == "office"
    assert result["biographyMode"] == "office_record"
    assert "Open States lists Example Member" in result["bio"]
    assert "teacher" not in result["bio"]
    assert asyncio.run(profiles._complete_background(candidate(), {})) == {}


def test_successful_ai_summary_retains_source_and_scope(monkeypatch):
    configure(monkeypatch)
    async def summarize(facts):
        return facts[0]
    monkeypatch.setattr(profiles, "summarize_biography", summarize)
    result = asyncio.run(profiles._complete_background(candidate(dataSource="live"), {}))
    assert result["biographyMode"] == "watsonx_summary"
    assert result["biographyScope"] == "office"
    source = "https://www.nysenate.gov/senators/example/about"
    result = asyncio.run(profiles._complete_background(candidate(), {"bio": "Excerpt", "biographySource": source, "_facts": ["A supplied career sentence."]}))
    assert result["biographySource"] == source
    assert result["bio"] == "A supplied career sentence."
    assert "_facts" not in result


def test_partial_refresh_keeps_bio_but_updates_new_legislation(monkeypatch, tmp_path):
    monkeypatch.setenv("ENABLE_WATSONX_BIOS", "false")
    monkeypatch.setenv("CACHE_PATH", str(tmp_path / "public.sqlite3"))
    monkeypatch.delenv("CLOUDANT_URL", raising=False)
    async def background(_):
        return {"bio": "A previously sourced career.", "biographyMode": "official_excerpt"}
    bills = [{"title": "Original bill", "url": "https://www.nysenate.gov/legislation/bills/2025/S1"}]
    async def legislation(_):
        return bills
    monkeypatch.setattr(profiles, "_background", background)
    monkeypatch.setattr(profiles, "_legislation", legislation)
    async def run():
        record = candidate(dataSource="live")
        await profiles.synchronize_profile(record)
        key = profiles.CACHE_PREFIX + record.id
        saved = await profiles.get_document(key)
        saved["fields"]["biographyCheckedAt"] = "2026-01-01T00:00:00+00:00"
        saved["fetchedAt"] = 0
        await profiles.save_document(key, saved)
        async def blocked(_):
            return {}
        monkeypatch.setattr(profiles, "_background", blocked)
        bills[0] = {"title": "New bill", "url": "https://www.nysenate.gov/legislation/bills/2025/S2"}
        result = await profiles.synchronize_profile(record)
        assert result.bio == "A previously sourced career."
        assert result.policyEvidence[0].title == "New bill"
        assert result.profileStatus == "cached"
        assert result.biographyCheckedAt == "2026-01-01T00:00:00+00:00"
        assert result.legislationCheckedAt != result.biographyCheckedAt
        # A changed office invalidates this person's cached summary immediately.
        record.office = "New office"
        result = await profiles.synchronize_profile(record)
        assert "New office" in result.bio
        assert result.biographyScope == "office"
    asyncio.run(run())
