"""Cache public reference data in Cloudant, or SQLite during local development.

Quiz responses and personal profiles are never persisted here.
"""
import asyncio
import json
import logging
import os
import sqlite3
from urllib.parse import quote

import httpx

from backend.config import cache_path, cloudant_configured
from backend.services.ibm_auth import get_token

logger = logging.getLogger(__name__)


def _local(action: str, doc_id: str, data: dict | None = None):
    path = cache_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path, timeout=5) as db:
        db.execute("CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, data TEXT NOT NULL)")
        if action == "save":
            db.execute("INSERT INTO documents VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data", (doc_id, json.dumps(data)))
            return None
        row = db.execute("SELECT data FROM documents WHERE id=?", (doc_id,)).fetchone()
        return json.loads(row[0]) if row else None


async def _request(method: str, suffix: str, **kwargs):
    token = await get_token(os.environ["CLOUDANT_APIKEY"])
    url = os.environ["CLOUDANT_URL"].rstrip("/") + "/" + quote(os.environ["CLOUDANT_DB_NAME"], safe="")
    async with httpx.AsyncClient(timeout=5) as client:
        response = await client.request(method, url + suffix, headers={"Authorization": f"Bearer {token}"}, **kwargs)
        if response.status_code != 404:
            response.raise_for_status()
        return response


async def get_document(doc_id: str) -> dict | None:
    if cloudant_configured():
        try:
            response = await _request("GET", "/" + quote(doc_id, safe=""))
            if response.status_code != 404:
                return response.json()
        except (httpx.HTTPError, ValueError, KeyError):
            logger.warning("Cloudant read unavailable; using local public-data cache.")
    return await asyncio.to_thread(_local, "get", doc_id)


async def save_document(doc_id: str, data: dict) -> None:
    await asyncio.to_thread(_local, "save", doc_id, data)
    if not cloudant_configured():
        return
    try:
        suffix = "/" + quote(doc_id, safe="")
        for attempt in range(2):
            previous = await _request("GET", suffix)
            payload = {**data, "_id": doc_id}
            if previous.status_code == 404:
                # Provision the configured database when permitted.
                try:
                    await _request("PUT", "")
                except httpx.HTTPStatusError as error:
                    if error.response.status_code != 412:
                        raise
            else:
                payload["_rev"] = previous.json()["_rev"]
            try:
                await _request("PUT", suffix, json=payload)
                return
            except httpx.HTTPStatusError as error:
                if error.response.status_code != 409 or attempt:
                    raise
    except (httpx.HTTPError, ValueError, KeyError):
        logger.warning("Cloudant write unavailable; public data saved locally.")


async def query_by_field(field: str, value) -> list[dict]:
    if cloudant_configured():
        try:
            response = await _request("POST", "/_find", json={"selector": {field: {"$eq": value}}, "limit": 100})
            if response.status_code != 404:
                return response.json().get("docs", [])
        except (httpx.HTTPError, ValueError, KeyError):
            logger.warning("Cloudant query unavailable; using local public-data cache.")

    def query_local():
        _local("get", "__init__")
        with sqlite3.connect(cache_path()) as db:
            documents = [json.loads(row[0]) for row in db.execute("SELECT data FROM documents")]
        return [document for document in documents if document.get(field) == value]

    return await asyncio.to_thread(query_local)
