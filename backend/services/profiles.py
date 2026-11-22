"""Refresh public profile evidence without generating or inferring political views."""
import asyncio
from datetime import datetime, timezone
from html.parser import HTMLParser
import json
import logging
import os
import re
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx

from backend.config import ROOT
from backend.models.candidate import CandidateResponse
from backend.services.cloudant import get_document, save_document

logger = logging.getLogger(__name__)
TTL_SECONDS = 6 * 60 * 60
CACHE_PREFIX = "profile-evidence:v2:"
_MAX_HTML_BYTES = 1_500_000


def official_url(url: str) -> bool:
    """Only public government sites; callers cannot supply arbitrary fetch URLs."""
    try:
        parsed = urlsplit(url)
        host = (parsed.hostname or "").lower()
        return parsed.scheme == "https" and not parsed.username and not parsed.password and parsed.port in (None, 443) and (
            host in {"www.nysenate.gov", "nysenate.gov", "nyassembly.gov", "www.nyassembly.gov", "assembly.state.ny.us", "www.assembly.state.ny.us", "governor.ny.gov", "ag.ny.gov", "www.nyc.gov", "nyc.gov"}
            or host.endswith(".house.gov") or host.endswith(".senate.gov")
        )
    except (ValueError, TypeError):
        return False


class BiographyHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.blocks = []
        self.links = []
        self.current = []
        self.in_paragraph = False
        self.link = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag not in {"img", "meta", "link", "br", "hr", "input", "source", "wbr"}:
            self.stack.append((tag, attrs))
        if tag == "p":
            self.flush()
            self.in_paragraph = True
        if tag == "a":
            self.link = [attrs.get("href", ""), []]

    def handle_endtag(self, tag):
        if tag == "p":
            self.flush()
            self.in_paragraph = False
        if tag == "a" and self.link:
            self.links.append((self.link[0], " ".join(self.link[1])))
            self.link = None
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break

    def handle_data(self, data):
        if any(tag in {"script", "style", "nav", "footer", "header"} for tag, _ in self.stack):
            return
        if self.link:
            self.link[1].append(data.strip())
        if self.in_paragraph:
            self.current.append(data)

    def flush(self):
        text = re.sub(r"\s+", " ", " ".join(self.current)).strip()
        if len(text.split()) >= 8:
            self.blocks.append(text)
        self.current = []


async def _official_page(url: str) -> tuple[str, BiographyHTML] | None:
    async with httpx.AsyncClient(timeout=4, follow_redirects=False, headers={"User-Agent": "CivicLens/1.0 public-profile-reader"}) as client:
        for _ in range(4):
            if not official_url(url):
                return None
            async with client.stream("GET", url) as response:
                if response.is_redirect:
                    url = urljoin(url, response.headers.get("location", ""))
                    continue
                if response.status_code != 200 or "text/html" not in response.headers.get("content-type", ""):
                    return None
                data = bytearray()
                async for chunk in response.aiter_bytes():
                    data.extend(chunk)
                    if len(data) > _MAX_HTML_BYTES:
                        return None
                parser = BiographyHTML()
                parser.feed(data.decode("utf-8", errors="replace"))
                parser.flush()
                return url, parser
    return None


def _biography_url(candidate: CandidateResponse) -> str | None:
    for source in candidate.sources:
        if not official_url(source):
            continue
        parsed = urlsplit(source)
        if parsed.hostname in {"www.nysenate.gov", "nysenate.gov"}:
            match = re.match(r"^(/senators/[^/]+)", parsed.path)
            if match:
                return urlunsplit(("https", parsed.netloc, match[1] + "/about", "", ""))
        elif parsed.hostname in {"assembly.state.ny.us", "www.assembly.state.ny.us", "nyassembly.gov", "www.nyassembly.gov"}:
            match = re.match(r"^(/mem/[^/?]+)", parsed.path)
            if match:
                return urlunsplit(("https", parsed.netloc, match[1] + "/bio/", "", ""))
        elif parsed.hostname.endswith((".house.gov", ".senate.gov")) or parsed.hostname in {"governor.ny.gov", "ag.ny.gov", "www.nyc.gov", "nyc.gov"}:
            return source
    return None


def _excerpt(blocks: list[str]) -> str:
    # Show a short attributed excerpt, with a link to the full official biography.
    usable = [text for text in blocks if not re.search(r"cookie|privacy policy|sign up|subscribe|javascript|newsletter", text, re.I)]
    if not usable:
        return ""
    def experience(text):
        return len(re.findall(r"\b(?:served|worked|teacher|nypd|marine|lawyer|attorney|career|veteran|business|graduated)\b", text, re.I))
    text = max(usable, key=experience)
    words = text.split()
    preview = " ".join(words[:24])
    if len(words) > 24:
        endings = list(re.finditer(r"[.!?](?=\s|$)", preview))
        if endings and endings[-1].end() > 70:
            return preview[:endings[-1].end()]
        return preview + "…"
    return preview


async def _background(candidate: CandidateResponse) -> dict:
    url = _biography_url(candidate)
    if url:
        try:
            page = await _official_page(url)
            if page:
                final_url, parser = page
                # Non-NY legislature sites have different layouts: follow their biography link.
                if not re.search(r"/about(?:/|$)|/bio(?:/|$)", urlsplit(final_url).path):
                    link = next((urljoin(final_url, href) for href, label in parser.links if re.search(r"biography|about (?:the|rep|senator)|^about$|^bio$", label.strip(), re.I) and official_url(urljoin(final_url, href)) and urlsplit(urljoin(final_url, href)).hostname == urlsplit(final_url).hostname), None)
                    if link and link != final_url:
                        page = await _official_page(link)
                        if page:
                            final_url, parser = page
                        else:
                            return {}
                    else:
                        return {}
                excerpt = _excerpt(parser.blocks)
                if excerpt:
                    return {"bio": excerpt, "biographySource": final_url, "biographyMode": "official_excerpt"}
        except (httpx.HTTPError, ValueError):
            logger.info("Official biography unavailable; retaining attributed background if available.")
    # A reviewed fallback is explicit and dated; it is never presented as a fresh fetch.
    reviewed = json.loads((ROOT / "data" / "reviewed-backgrounds.json").read_text(encoding="utf-8")).get(candidate.id)
    if reviewed:
        return {"bio": reviewed["summary"], "biographySource": reviewed["url"], "biographyMode": "reviewed_summary", "biographyReviewedAt": reviewed["reviewedAt"]}
    return {}


async def _legislation(candidate: CandidateResponse) -> list[dict]:
    provider_id = candidate.providerId or ""
    key = os.getenv("OPEN_STATES_API_KEY", "").strip()
    if not key or not re.fullmatch(r"ocd-person/[a-f0-9-]{36}", provider_id):
        return []
    year = datetime.now(timezone.utc).year
    first = year if year % 2 else year - 1
    params = {"jurisdiction": "New York", "session": f"{first}-{first + 1}", "sponsor": provider_id, "classification": "bill", "per_page": 3, "sort": "latest_action_desc", "include": ["sponsorships", "sources"]}
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.get("https://v3.openstates.org/bills", params=params, headers={"X-API-KEY": key})
            response.raise_for_status()
            bills = response.json().get("results") or []
        evidence = []
        for bill in bills:
            sponsorship = next((s for s in bill.get("sponsorships", []) if (s.get("person") or {}).get("id") == provider_id), None)
            if not sponsorship:
                continue
            urls = [s.get("url", "") for s in bill.get("sources", [])]
            url = next((u.replace("http://", "https://", 1) for u in urls if official_url(u.replace("http://", "https://", 1)) and "/api/" not in u), None)
            if not url or not bill.get("title"):
                continue
            evidence.append({"title": f"{bill.get('identifier', '')}: {bill['title']}", "url": url, "kind": "Primary sponsor" if sponsorship.get("primary") else "Co-sponsor", "date": bill.get("latest_action_date") or None})
        return evidence
    except (httpx.HTTPError, ValueError, TypeError, KeyError):
        logger.info("Legislative records unavailable; no policy stance inferred.")
        return []


async def synchronize_profile(candidate: CandidateResponse) -> CandidateResponse:
    cache_id = CACHE_PREFIX + candidate.id
    stored = await get_document(cache_id)
    now = datetime.now(timezone.utc)
    cache_ttl = TTL_SECONDS if stored and stored["fields"].get("profileStatus") == "synced" else 600
    if stored and now.timestamp() - stored.get("fetchedAt", 0) < cache_ttl:
        return CandidateResponse.model_validate({**candidate.model_dump(), **stored["fields"]})
    async def bounded(operation):
        try:
            return await asyncio.wait_for(operation, timeout=9)
        except asyncio.TimeoutError:
            return None
    background, evidence = await asyncio.gather(bounded(_background(candidate)), bounded(_legislation(candidate)))
    background, evidence = background or {}, evidence or []
    if (not background or not evidence) and stored:
        return CandidateResponse.model_validate({**candidate.model_dump(), **stored["fields"], "profileStatus": "cached"})
    fields = {**background, "policyEvidence": evidence, "profileStatus": "synced" if background and evidence else "partial" if background or evidence else "unavailable"}
    if background or evidence:
        fields["profileCheckedAt"] = now.isoformat()
        fields["sources"] = list(dict.fromkeys(candidate.sources + ([background["biographySource"]] if background else []) + [e["url"] for e in evidence]))
        await save_document(cache_id, {"fetchedAt": now.timestamp(), "fields": fields})
    return CandidateResponse.model_validate({**candidate.model_dump(), **fields})
