"""Manual smoke test for the IBM watsonx.ai integration.

Run from the repository root after filling in backend/.env:

    python -m backend.scripts.smoke_watsonx

This script forces ENABLE_WATSONX and ENABLE_WATSONX_BIOS to true so both
functions are exercised regardless of the values in .env. It is never run in
CI — keep it out of the automated test suite.
"""
import asyncio
import os
import sys

# Force both features on before importing anything that reads config.
os.environ["ENABLE_WATSONX"] = "true"
os.environ["ENABLE_WATSONX_BIOS"] = "true"

from backend.config import watsonx_enabled, watsonx_bios_enabled  # noqa: E402
from backend.services.watsonx import explain_match, summarize_biography  # noqa: E402

_SAMPLE_FACTS = [
    "Zohran Mamdani is a member of the New York State Assembly.",
    "He previously worked as a housing counselor in Queens.",
    "He serves on the Committee on Housing.",
]

_SAMPLE_CANDIDATE = {
    "name": "Zohran Mamdani",
    "positions": [
        {"topic": "housing", "stance": "expand", "description": "Supports rent stabilization and public housing construction."},
        {"topic": "climate", "stance": "support", "description": "Backs aggressive renewable energy investment."},
    ],
}

_SAMPLE_ANSWERS = {"housing": 2.0, "climate": 1.0}

_SAMPLE_BASELINE = "Compared 2 shared policy topics. Closer alignment: housing, climate."


def _check_credentials() -> bool:
    missing = [k for k in ("WATSONX_API_KEY", "WATSONX_SPACE_ID", "WATSONX_URL", "WATSONX_MODEL_ID") if not os.getenv(k)]
    if missing:
        print(f"ERROR: Missing required env vars: {', '.join(missing)}")
        print("Copy backend/.env.example to backend/.env and fill in your credentials.")
        return False
    return True


async def run() -> None:
    print("=== Civic Lens — watsonx.ai smoke test ===\n")

    print(f"  watsonx_enabled:      {watsonx_enabled()}")
    print(f"  watsonx_bios_enabled: {watsonx_bios_enabled()}")
    print(f"  WATSONX_URL:          {os.getenv('WATSONX_URL')}")
    print(f"  WATSONX_MODEL_ID:     {os.getenv('WATSONX_MODEL_ID')}")
    print(f"  WATSONX_SPACE_ID:     {os.getenv('WATSONX_SPACE_ID', '')[:8]}…\n")

    # --- summarize_biography ---
    print("--- summarize_biography() ---")
    print(f"  Input facts: {_SAMPLE_FACTS}")
    bio = await summarize_biography(_SAMPLE_FACTS)
    if bio:
        print(f"  Result: {bio!r}")
    else:
        print("  WARN: returned empty string — check credentials, model ID, and that")
        print("        the model supports /ml/v1/text/chat with response_format.")

    print()

    # --- explain_match ---
    print("--- explain_match() ---")
    print(f"  Answers:   {_SAMPLE_ANSWERS}")
    print(f"  Candidate: {_SAMPLE_CANDIDATE['name']}")
    explanation = await explain_match(_SAMPLE_ANSWERS, _SAMPLE_CANDIDATE, _SAMPLE_BASELINE)
    if explanation:
        print(f"  Result: {explanation!r}")
    else:
        print("  WARN: returned empty string — check credentials, model ID, and that")
        print("        the model supports /ml/v1/text/generation.")

    print("\n=== done ===")


if __name__ == "__main__":
    if not _check_credentials():
        sys.exit(1)
    asyncio.run(run())
