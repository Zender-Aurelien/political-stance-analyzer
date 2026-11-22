import asyncio

import httpx
from fastapi.testclient import TestClient

from backend.main import app
from backend.services import civic, openstates


def test_api_key_uses_header_and_new_york_mapping(monkeypatch):
    monkeypatch.setenv("OPEN_STATES_API_KEY", "test-private-key")
    requests = []

    def respond(request):
        requests.append(request)
        if request.url.host == "api.zippopotam.us":
            return httpx.Response(200, json={"places": [{"latitude": "40.81", "longitude": "-73.95"}]})
        return httpx.Response(200, json={"results": [
            {"name": "Example Legislator", "party": "Democratic", "current_role": {"district": "30", "org_classification": "upper"}, "jurisdiction": {"name": "New York"}, "links": [{"url": "https://example.org/official"}]},
            {"name": "Other State", "jurisdiction": {"name": "California"}},
        ]})

    factory = httpx.AsyncClient
    monkeypatch.setattr(openstates.httpx, "AsyncClient", lambda **kwargs: factory(transport=httpx.MockTransport(respond), **kwargs))
    async def no_wait():
        pass
    monkeypatch.setattr(openstates, "_acquire", no_wait)
    result = asyncio.run(openstates.get_representatives_by_zip("10027"))
    assert len(result) == 1
    assert result[0]["office"] == "State Senator"
    assert result[0]["district"] == "New York · District 30"
    upstream = requests[-1]
    assert upstream.headers["x-api-key"] == "test-private-key"
    assert "test-private-key" not in str(upstream.url)


def test_http_errors_never_log_credentials(monkeypatch, caplog):
    monkeypatch.setenv("OPEN_STATES_API_KEY", "test-private-key")
    async def coords(_):
        return (40.81, -73.95)
    monkeypatch.setattr(openstates, "_zip_to_latlon", coords)
    factory = httpx.AsyncClient
    monkeypatch.setattr(openstates.httpx, "AsyncClient", lambda **kwargs: factory(transport=httpx.MockTransport(lambda request: httpx.Response(401)), **kwargs))
    assert asyncio.run(openstates.get_representatives_by_zip("10027")) == []
    assert "test-private-key" not in caplog.text


def test_non_new_york_zip_never_calls_provider(monkeypatch):
    monkeypatch.setenv("OPEN_STATES_API_KEY", "test")
    async def forbidden(_):
        raise AssertionError("Provider should not be contacted")
    monkeypatch.setattr(openstates, "_zip_to_latlon", forbidden)
    assert asyncio.run(openstates.get_representatives_by_zip("90210")) == []


def test_live_lookup_and_fallback_have_accurate_sources(monkeypatch):
    monkeypatch.setenv("OPEN_STATES_API_KEY", "test")
    async def live(_):
        return [{"id": "example-legislator", "name": "Example Legislator", "party": "Democratic", "office": "State Senator", "district": "New York · District 30", "photo_url": None, "positions": [], "sources": [], "source": "openstates"}]
    monkeypatch.setattr(openstates, "get_representatives_by_zip", live)
    with TestClient(app) as client:
        response = client.get("/api/candidates?zip=10027")
        assert response.status_code == 200
        assert response.headers["X-Civic-Data-Source"] == "live+sample"
        records = response.json()
        assert records[0]["dataSource"] == "live"
        assert records[0]["positions"] == []
        expected = {c.id: c.model_dump() for c in civic.get_candidates("10027")}
        assert {c["id"]: c for c in records[1:]} == expected

        async def offline(_):
            return []
        monkeypatch.setattr(openstates, "get_representatives_by_zip", offline)
        fallback = client.get("/api/candidates?zip=10027")
        assert fallback.headers["X-Civic-Data-Source"] == "sample"
        assert fallback.json() == list(expected.values())
