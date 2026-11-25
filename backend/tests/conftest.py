import pytest


@pytest.fixture(autouse=True)
def isolate_reference_data(monkeypatch, tmp_path):
    """Ordinary tests never use the operator's credentials or public-data cache."""
    monkeypatch.setenv("CACHE_PATH", str(tmp_path / "public.sqlite3"))
    monkeypatch.setenv("ENABLE_WATSONX", "false")
    monkeypatch.setenv("ENABLE_WATSONX_BIOS", "false")
    monkeypatch.delenv("CLOUDANT_URL", raising=False)
    monkeypatch.delenv("OPEN_STATES_API_KEY", raising=False)


@pytest.fixture(autouse=True)
def reset_rate_limits():
    """Clear rate-limit state before and after every test so tests don't bleed into each other."""
    from backend.middleware.rate_limit import reset_all
    reset_all()
    yield
    reset_all()
