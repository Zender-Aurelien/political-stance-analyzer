"""Manual smoke test for the IBM watsonx.ai integration.

Run from the repository root after filling in backend/.env:

    python -m backend.scripts.smoke_watsonx

This script forces ENABLE_WATSONX and ENABLE_WATSONX_BIOS to true so all
functions are exercised regardless of the values in .env. It is never run in
CI — keep it out of the automated test suite.
"""
import asyncio
import logging
import os
import sys

# Force both features on before importing anything that reads config.
os.environ["ENABLE_WATSONX"] = "true"
os.environ["ENABLE_WATSONX_BIOS"] = "true"

from backend.config import watsonx_enabled, watsonx_bios_enabled  # noqa: E402
from backend.services.civic import get_questions  # noqa: E402
from backend.services.watsonx import explain_match, generate_quiz_questions, summarize_biography  # noqa: E402

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

    print()

    # --- generate_quiz_questions ---
    print("--- generate_quiz_questions() ---")
    static_questions = get_questions()
    static_dicts = [q.model_dump() for q in static_questions]
    likert_count = sum(1 for q in static_dicts if q.get("type") == "likert" and q.get("topic"))
    print(f"  Input: {len(static_dicts)} questions ({likert_count} likert/scorable)")
    rephrased = await generate_quiz_questions(static_dicts)
    if rephrased:
        changed = [
            (o["id"], o["prompt"], r["prompt"])
            for o, r in zip(static_dicts, rephrased)
            if o["prompt"] != r["prompt"]
        ]
        print(f"  Result: {len(rephrased)} questions returned, {len(changed)} prompts rephrased")
        for qid, original, new in changed[:3]:
            print(f"    [{qid}]")
            print(f"      original:  {original}")
            print(f"      rephrased: {new}")
        # Verify scoring fields are untouched.
        mismatches = [
            o["id"]
            for o, r in zip(static_dicts, rephrased)
            if o.get("score") != r.get("score") or o.get("topic") != r.get("topic")
        ]
        if mismatches:
            print(f"  ERROR: score/topic changed for: {mismatches}")
        else:
            print("  OK: score and topic fields are unchanged for all questions")
    else:
        print("  WARN: returned [] — check credentials, model ID, WATSONX_SPACE_ID,")
        print("        and run with logging enabled to see the raw API error:")
        print("        python -c \"import logging; logging.basicConfig(level=logging.DEBUG)\" -m backend.scripts.smoke_watsonx")

    print("\n=== done ===")


if __name__ == "__main__":
    # Enable WARNING-level logging so the detailed error messages from watsonx.py are visible.
    logging.basicConfig(level=logging.WARNING, format="%(name)s: %(message)s")
    if not _check_credentials():
        sys.exit(1)
    asyncio.run(run())
