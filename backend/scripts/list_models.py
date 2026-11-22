"""List text generation models available in your watsonx.ai deployment space.

Run from the repository root:

    python -m backend.scripts.list_models
"""
import asyncio
import os
import sys

import backend.config  # noqa: F401 — side effect: loads backend/.env via load_dotenv
from backend.services.ibm_auth import get_token


async def run() -> None:
    import httpx

    missing = [k for k in ("WATSONX_API_KEY", "WATSONX_SPACE_ID", "WATSONX_URL") if not os.getenv(k)]
    if missing:
        print(f"ERROR: Missing env vars: {', '.join(missing)}")
        sys.exit(1)

    token = await get_token(os.environ["WATSONX_API_KEY"])
    url = os.environ["WATSONX_URL"].rstrip("/") + "/ml/v1/foundation_model_specs"
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.get(
            url,
            params={"version": "2024-05-31", "limit": 200},
            headers={"Authorization": f"Bearer {token}"},
        )

    if response.status_code != 200:
        print(f"HTTP {response.status_code}: {response.text[:600]}")
        sys.exit(1)

    data = response.json()
    models = data.get("resources", [])

    print(f"Total models returned: {len(models)}\n")

    if not models:
        print("No models found. The endpoint may require a space_id query param.")
        print("Retrying with space_id ...\n")
        async with httpx.AsyncClient(timeout=15) as client:
            response2 = await client.get(
                url,
                params={"version": "2024-05-31", "limit": 200, "space_id": os.environ["WATSONX_SPACE_ID"]},
                headers={"Authorization": f"Bearer {token}"},
            )
        if response2.status_code != 200:
            print(f"HTTP {response2.status_code}: {response2.text[:600]}")
            sys.exit(1)
        models = response2.json().get("resources", [])
        print(f"Total models with space_id: {len(models)}\n")

    for m in sorted(models, key=lambda x: x.get("model_id", "")):
        mid = m.get("model_id", "unknown")
        tasks = [t.get("id", "") for t in m.get("tasks", [])]
        print(f"  {mid}  tasks={tasks}")

    print("\nSet WATSONX_MODEL_ID in backend/.env to one of the model_ids above.")
    print("Recommended: any ibm/granite-3* model that lists 'text_generation' in tasks.")


if __name__ == "__main__":
    asyncio.run(run())
