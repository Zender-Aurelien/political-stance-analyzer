import pytest


@pytest.fixture(autouse=True)
def isolate_reference_data(monkeypatch, tmp_path):
    """Ordinary tests never use the operator's credentials or public-data cache."""
    monkeypatch.setenv("CACHE_PATH", str(tmp_path / "public.sqlite3"))
    monkeypatch.setenv("ENABLE_WATSONX", "false")
    monkeypatch.setenv("ENABLE_WATSONX_BIOS", "false")
    monkeypatch.delenv("CLOUDANT_URL", raising=False)
    monkeypatch.delenv("OPEN_STATES_API_KEY", raising=False)
