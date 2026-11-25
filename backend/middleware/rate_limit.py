"""IP-keyed sliding-window rate limiter.

Each rule names a path prefix (or exact path) and the allowed number of
requests in a rolling time window.  The middleware checks rules in order and
applies the first match.  Unmatched paths are allowed through unrestricted.

No external dependencies — uses only asyncio and the standard library.

Window design
─────────────
Timestamps for each (ip, bucket) pair are kept in a deque.  On each request
the deque is trimmed to remove entries older than the window, then the new
timestamp is appended.  If the resulting length exceeds the limit the request
is rejected with 429.

Memory is bounded: each active (ip, bucket) entry holds at most `limit`
timestamps.  Entries are pruned lazily on the next request from that IP to
that bucket.  The total footprint is O(unique_ips × rules × limit), which is
small for a demo app.

Usage (main.py)
───────────────
from backend.middleware.rate_limit import RateLimitMiddleware, Rule
app.add_middleware(RateLimitMiddleware, rules=[
    Rule("/api/match",           limit=10,  window=60),
    Rule("/api/candidates",      limit=30,  window=60),
    Rule("/api/quiz",            limit=60,  window=60),
    Rule("/api/status",          limit=60,  window=60),
    Rule("/health",              limit=60,  window=60),
])
"""
from __future__ import annotations

import asyncio
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse


@dataclass
class Rule:
    """A rate-limit rule matched by path prefix."""
    path: str          # prefix to match (e.g. "/api/match")
    limit: int         # max requests allowed in the window
    window: float      # rolling window in seconds


@dataclass
class _Bucket:
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    # ip -> deque of timestamps
    timestamps: dict[str, deque] = field(default_factory=lambda: defaultdict(deque))


# Module-level registry so tests can reset all active middleware instances.
_instances: list["RateLimitMiddleware"] = []


def reset_all() -> None:
    """Clear all in-memory rate-limit state. For use in tests only."""
    for instance in _instances:
        for bucket in instance._buckets:
            bucket.timestamps.clear()


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Sliding-window rate limiter keyed by client IP and path bucket."""

    def __init__(self, app, rules: list[Rule]):
        super().__init__(app)
        self._rules = rules
        # One _Bucket per rule, indexed the same way as _rules.
        self._buckets: list[_Bucket] = [_Bucket() for _ in rules]
        _instances.append(self)

    def _client_ip(self, request: Request) -> str:
        # Respect X-Forwarded-For when running behind a trusted proxy (Render).
        # Only the leftmost address is used; it may be spoofed without a trusted
        # proxy, but for a demo app this is an acceptable trade-off.
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            return forwarded.split(",")[0].strip()
        if request.client:
            return request.client.host
        return "unknown"

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        for rule, bucket in zip(self._rules, self._buckets):
            if not path.startswith(rule.path):
                continue
            ip = self._client_ip(request)
            now = time.monotonic()
            async with bucket.lock:
                dq = bucket.timestamps[ip]
                # Evict timestamps outside the current window.
                while dq and now - dq[0] > rule.window:
                    dq.popleft()
                if len(dq) >= rule.limit:
                    retry_after = int(rule.window - (now - dq[0])) + 1
                    return JSONResponse(
                        status_code=429,
                        content={"detail": "Too many requests. Please wait before trying again."},
                        headers={"Retry-After": str(retry_after)},
                    )
                dq.append(now)
            break  # first matching rule wins
        return await call_next(request)
