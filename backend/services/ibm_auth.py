"""IBM IAM token exchange shared by the optional Cloudant/watsonx adapters."""
import asyncio
import time

import httpx

_tokens: dict[str, tuple[str, float]] = {}
_lock = asyncio.Lock()


async def get_token(api_key: str) -> str:
    async with _lock:
        cached = _tokens.get(api_key)
        if cached and cached[1] > time.time() + 60:
            return cached[0]
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.post(
                "https://iam.cloud.ibm.com/identity/token",
                data={"grant_type": "urn:ibm:params:oauth:grant-type:apikey", "apikey": api_key},
                headers={"Accept": "application/json"},
            )
            response.raise_for_status()
            data = response.json()
        token = data["access_token"]
        _tokens[api_key] = (token, time.time() + float(data.get("expires_in", 300)))
        return token
