"""Open States API v3 — live NY state legislator lookup by ZIP code.

Requires OPEN_STATES_API_KEY in the environment.  When the key is absent or
the upstream call fails the function returns an empty list so the local
candidates.json fallback in civic.py can serve the request uninterrupted.

Rate limiting
─────────────
Open States free tier: 1 000 requests/day, no burst limit published.
zippopotam.us: no published limit; treated conservatively.

A module-level token-bucket enforces at most RATE_LIMIT_RPS calls per second
across all coroutines, applied to both the geocode call and the Open States
call so the combined pair never exceeds the budget.
"""
import asyncio
import logging
import os
import re
import time

import httpx

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Rate limiter — simple token bucket, shared across all requests
# ---------------------------------------------------------------------------
_RATE_LIMIT_RPS: float = 2.0          # max calls per second to external APIs
_bucket_tokens: float = _RATE_LIMIT_RPS
_bucket_last: float = time.monotonic()
_bucket_lock: asyncio.Lock | None = None  # created lazily (needs a running loop)


def _get_lock() -> asyncio.Lock:
    global _bucket_lock
    if _bucket_lock is None:
        _bucket_lock = asyncio.Lock()
    return _bucket_lock


async def _acquire() -> None:
    """Block until a token is available, then consume one."""
    global _bucket_tokens, _bucket_last
    async with _get_lock():
        now = time.monotonic()
        elapsed = now - _bucket_last
        _bucket_last = now
        _bucket_tokens = min(_RATE_LIMIT_RPS, _bucket_tokens + elapsed * _RATE_LIMIT_RPS)
        if _bucket_tokens >= 1.0:
            _bucket_tokens -= 1.0
            return
        wait = (1.0 - _bucket_tokens) / _RATE_LIMIT_RPS
        _bucket_tokens = 0.0
    # Sleep outside the lock so other coroutines can refill while we wait.
    await asyncio.sleep(wait)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _slug(name: str) -> str:
    """'Alexandria Ocasio-Cortez' → 'alexandria-ocasio-cortez'."""
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


async def _zip_to_latlon(zip_code: str) -> tuple[float, float] | None:
    """Resolve a US ZIP to (lat, lon) via zippopotam.us (no key required)."""
    await _acquire()
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(f"https://api.zippopotam.us/us/{zip_code}")
            if response.status_code == 404:
                logger.warning("openstates: ZIP %s not found in zippopotam.us", zip_code)
                return None
            response.raise_for_status()
            place = response.json()["places"][0]
            return float(place["latitude"]), float(place["longitude"])
    except (httpx.HTTPError, KeyError, IndexError, ValueError, TypeError) as exc:
        logger.warning("openstates: geocode failed for ZIP %s — %s", zip_code, exc)
        return None


def _map_person(person: dict) -> dict:
    """Map an Open States person object to the internal candidate dict shape."""
    role = (person.get("current_role") or {})
    links = person.get("links") or []
    return {
        "id": _slug(person.get("name", "")),
        "providerId": person.get("id"),
        "name": person.get("name", ""),
        "party": person.get("party", ""),
        "office": role.get("title") or {"upper": "State Senator", "lower": "State Assembly Member"}.get(role.get("org_classification"), "State Legislator"),
        "district": f"New York · District {role['district']}" if role.get("district") else "New York · Statewide",
        "photo_url": person.get("image") or None,
        "website": links[0].get("url") if links else None,
        # Office records contain no policy stance; sourced evidence is loaded separately.
        "positions": [],
        "sources": [link["url"] for link in links if isinstance(link, dict) and link.get("url")],
        "source": "openstates",
    }


# ---------------------------------------------------------------------------
# Public interface
# ---------------------------------------------------------------------------

async def get_representatives_by_zip(zip_code: str) -> list[dict]:
    """Return NY state legislators (Senate + Assembly) for a given ZIP code.

    Returns an empty list when:
    - OPEN_STATES_API_KEY is not set
    - The ZIP cannot be geocoded
    - The upstream API call fails
    """
    api_key = os.getenv("OPEN_STATES_API_KEY", "").strip()
    if not api_key:
        logger.warning("openstates: OPEN_STATES_API_KEY not set; skipping live lookup")
        return []

    if not re.fullmatch(r"(?:1[0-4][0-9]{3}|00501|00544|06390)", zip_code):
        return []

    coords = await _zip_to_latlon(zip_code)
    if coords is None:
        return []

    lat, lon = coords
    await _acquire()
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.get(
                "https://v3.openstates.org/people.geo",
                params={"lat": lat, "lng": lon, "include": "links"},
                headers={"X-API-KEY": api_key},
            )
            response.raise_for_status()
            people = response.json().get("results") or []
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        logger.warning("openstates: people.geo lookup unavailable; using sample profiles")
        return []

    ny_people = [
        p for p in people
        if isinstance(p, dict) and "new york" in ((p.get("jurisdiction") or {}).get("name") or "").lower()
    ]
    return [_map_person(p) for p in ny_people]
