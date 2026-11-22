# Sub-Task 4 — IBM watsonx.ai Service Layer Implementation Plan

## Overview

This plan covers getting the two existing watsonx.ai functions in `services/watsonx.py` working
correctly end-to-end against an IBM Cloud SaaS deployment space. The code structure is already
mostly in place from the scaffolding sub-task. The goal of this sub-task is to verify correctness,
close any remaining gaps, and confirm the integration works with a real IBM Cloud deployment space
GUID (using `space_id` instead of `project_id`).

**Scope:**
- Two functions only: `summarize_biography()` and `explain_match()`
- IBM Cloud SaaS — auth via `iam.cloud.ibm.com`, no on-premises CPD changes needed
- No Cloudant caching wired in — that is Sub-Task 2
- No new functions beyond what is already stubbed

**Non-goals:**
- `analyze_stances()` — not needed; stances come from `data/candidates.json`
- `generate_quiz_questions()` — not needed; quiz questions come from `data/quiz.json`
- Cloudant persistence of watsonx results — Sub-Task 2

---

## Current State

The auth layer (`services/ibm_auth.py`) and both functions (`services/watsonx.py`) are already
written. The `space_id` / `WATSONX_SPACE_ID` env var fix was applied in a prior session.
The existing unit tests all pass (40/40).

What is not yet done:
1. The `.env.example` does not explain how to find the space GUID or what model IDs are valid
2. `summarize_biography()` uses the `/ml/v1/text/chat` endpoint with `response_format`,
   which requires the chosen model to support the chat API and structured JSON output — this
   must be verified for the chosen model
3. There is no end-to-end smoke test that runs with real credentials to confirm the live calls
   actually work
4. The `WATSONX_URL` default in `.env.example` may need to be confirmed for the specific region
   of the deployment space

---

## Sub-Tasks

---

### Sub-Task 4a — Verify Model Compatibility and Confirm API Shapes
**Status:** `[x] done`

**Intent:**
Before writing any code, confirm that the chosen model (set via `WATSONX_MODEL_ID`) supports
both the `/ml/v1/text/generation` endpoint used by `explain_match()` and the `/ml/v1/text/chat`
endpoint with `response_format: {"type": "json_object"}` used by `summarize_biography()`. Not
all Granite models support structured JSON output via the chat API.

**Expected Outcomes:**
- A confirmed model ID is selected that works for both endpoints
- If the chosen model does not support `response_format` on the chat endpoint, the
  `summarize_biography()` prompt fallback strategy is confirmed (parse free-text JSON instead)
- `.env.example` is updated with a concrete model ID recommendation and a note on where to
  find the deployment space GUID

**Todo List:**
1. In the IBM Cloud console, navigate to your deployment space → open watsonx.ai → Foundation
   Models, and confirm which text-generation models are available in your space/region
2. Recommended model: `ibm/granite-3-8b-instruct` — it supports both text generation and
   the chat API with JSON output; verify it appears in your space's available models
3. If `ibm/granite-3-8b-instruct` is not available, any Granite 3.x instruct model works;
   note the exact model ID string from the console
4. Update `backend/.env.example`:
   - Add a comment showing where to find the Space GUID:
     "Deployment space → Manage tab → Space GUID"
   - Add a comment showing where to find the watsonx URL:
     "IBM Cloud watsonx.ai → Settings, or use https://us-south.ml.cloud.ibm.com for Dallas"
   - Add a recommended value or inline comment next to `WATSONX_MODEL_ID=`

**Relevant Context:**
- `summarize_biography()` calls `/ml/v1/text/chat` with `response_format: {"type": "json_object"}`
  at line 26–40 of `backend/services/watsonx.py`
- `explain_match()` calls `/ml/v1/text/generation` at line 74–87 of `backend/services/watsonx.py`
- The chat endpoint and `response_format` require a model that explicitly supports it;
  older Granite 13B instruct models may not

---

### Sub-Task 4b — Harden `summarize_biography()` JSON Parsing
**Status:** `[x] done`

**Intent:**
The `summarize_biography()` function relies on `response_format: {"type": "json_object"}` to
get back a guaranteed JSON object. If the chosen model does not support this field, the API
either ignores it or returns an error — the function would then silently return `""`. Add a
plain-text JSON parse fallback so the function can recover from models that return JSON
embedded in prose (e.g. wrapped in markdown fences or preceded by a sentence).

**Expected Outcomes:**
- If the response parses cleanly as JSON, behavior is unchanged
- If the response is not valid JSON but contains a JSON object within it, the function
  extracts and parses that object
- If neither works, the function returns `""` as today — no crash, no invented text

**Todo List:**
1. After `response.json()["choices"][0]["message"]["content"]` is retrieved, attempt
   `json.loads()` first (current behavior)
2. On `json.JSONDecodeError`, apply a simple regex to extract the first `{...}` block
   from the content string and attempt to parse that
3. If that also fails, log a debug message and return `""`
4. The existing test in `test_biographies.py` for invalid output shapes (`{"bio": "..."}`)
   must still return `""` — verify the new fallback does not accidentally accept it

**Relevant Context:**
- Current parsing at line 43 of `backend/services/watsonx.py`:
  `selected = json.loads(response.json()["choices"][0]["message"]["content"])["sentences"]`
- The existing parametrized test at line 22 of `backend/tests/test_biographies.py` covers
  invalid output shapes and must keep passing
- The intent is extractive only — the function must still validate that selected indexes
  point within the original `facts` list

---

### Sub-Task 4c — Add a Live Smoke Test Script
**Status:** `[x] done`

**Intent:**
Create a standalone script `backend/scripts/smoke_watsonx.py` that can be run manually
(with real credentials in `.env`) to confirm both watsonx functions return valid output
against the live IBM Cloud deployment space. This is a developer tool, not part of the
automated test suite.

**Expected Outcomes:**
- Running `python -m backend.scripts.smoke_watsonx` from the repo root with valid `.env`
  credentials prints the output of both `summarize_biography()` and `explain_match()`
- If credentials are missing or the call fails, it prints a clear error message
- The script is never run in CI — it is explicitly excluded from the test suite

**Todo List:**
1. Create `backend/scripts/` directory with an `__init__.py`
2. Write `backend/scripts/smoke_watsonx.py`:
   - Load `.env` via `python-dotenv`
   - Call `summarize_biography()` with a hardcoded list of two sample facts
   - Call `explain_match()` with a hardcoded sample answer dict, candidate dict, and baseline string
   - Print the results with labels
   - On empty string output, print "WARN: function returned empty — check credentials and model ID"
3. Add a note to `backend/README.md` explaining how to run the smoke test after filling in `.env`

**Relevant Context:**
- `backend/services/watsonx.py` exports `summarize_biography` and `explain_match`
- `backend/config.py` exports `watsonx_enabled()` and `watsonx_bios_enabled()` — the smoke
  script should check these and print whether each feature is enabled before running
- The script must set `ENABLE_WATSONX=true` and `ENABLE_WATSONX_BIOS=true` for itself, since
  `.env` defaults both to `false`

---

### Sub-Task 4d — Document the `.env` Setup End-to-End
**Status:** `[x] done`

**Intent:**
Update `backend/README.md` with a dedicated "Enabling IBM watsonx.ai" section that walks
through every step needed to wire up the deployment space — finding the Space GUID, getting
the IBM Cloud API key, choosing a model ID, and verifying the connection with the smoke test.

**Expected Outcomes:**
- A developer new to the project can follow the README alone to enable and test both watsonx
  features without reading IBM documentation
- The README explicitly states that scoring works without IBM credentials — watsonx is optional

**Todo List:**
1. Add a section "Enabling IBM watsonx.ai" to `backend/README.md` with steps:
   - Log in to cloud.ibm.com → go to your deployment space → Manage tab → copy Space GUID
     → paste as `WATSONX_SPACE_ID`
   - IBM Cloud → Manage → Access (IAM) → API keys → Create → paste as `WATSONX_API_KEY`
   - Confirm `WATSONX_URL` matches your region (Dallas: `https://us-south.ml.cloud.ibm.com`)
   - Set `WATSONX_MODEL_ID` to the confirmed model ID from Sub-Task 4a
   - Set `ENABLE_WATSONX=true` and/or `ENABLE_WATSONX_BIOS=true`
   - Run the smoke test: `python -m backend.scripts.smoke_watsonx`
2. Add a note: "Quiz scoring and match percentages are computed locally and do not require
   IBM credentials. Only match explanations and biography summaries use watsonx.ai."

**Relevant Context:**
- `backend/README.md` exists but does not currently describe the watsonx setup path
- `backend/.env.example` is the companion to this documentation

---

## Key Design Decisions

| Decision | Choice |
|---|---|
| Auth endpoint | IBM Cloud IAM — `iam.cloud.ibm.com` — already implemented in `ibm_auth.py` |
| Space vs project | `space_id` — already fixed in `watsonx.py` and `config.py` |
| Model | `ibm/granite-3-8b-instruct` recommended — confirm availability in your space |
| Chat vs generation | `summarize_biography` uses `/ml/v1/text/chat`; `explain_match` uses `/ml/v1/text/generation` |
| Fallback on failure | Both functions return `""` on any error — scores are unaffected |
| Cloudant caching | Out of scope for this sub-task |
| No new AI functions | `analyze_stances` and `generate_quiz_questions` are not needed in the current architecture |
