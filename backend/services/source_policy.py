"""Allowed government sources for public profile evidence."""
from urllib.parse import urlsplit


def official_url(url: str) -> bool:
    try:
        parsed = urlsplit(url)
        host = (parsed.hostname or "").lower()
        return parsed.scheme == "https" and not parsed.username and not parsed.password and parsed.port in (None, 443) and (
            host in {"www.nysenate.gov", "nysenate.gov", "nyassembly.gov", "www.nyassembly.gov", "assembly.state.ny.us", "www.assembly.state.ny.us", "governor.ny.gov", "ag.ny.gov", "www.nyc.gov", "nyc.gov", "osc.ny.gov"}
            or host.endswith((".house.gov", ".senate.gov", ".nyc.gov"))
        )
    except (ValueError, TypeError):
        return False
