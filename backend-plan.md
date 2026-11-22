> Implementation status (November 22, 2026): the local demo backend is implemented with candidate search, shared quiz questions, deterministic scoring, public-data caching, and optional IBM adapters. The frontend and API run together. The Google Representatives API named below was retired April 30, 2025, so local ZIP search uses explicitly labeled sample coverage. Live representative lookup and public deployment are not complete; the remaining text is the original design proposal, not a description of currently deployed services.

# Civic Lens — Backend Plan

## Overview

Add a Python FastAPI backend to the existing Civic Lens frontend. The backend becomes the
primary data source for candidate lookups, quiz generation, and match scoring. The frontend's
`api.js` module is updated to call the backend first, with `data/candidates.json` as a
graceful fallback when the backend is unreachable.

**Backend stack:**
- Python + FastAPI (async, good for concurrent external API calls)
- Hosted on IBM Code Engine (containerized)
- IBM Cloudant — NoSQL document store for candidate stance data and cached quiz sets
- IBM watsonx.ai — LLM for stance summarization, quiz question generation, and match explanations
- Open States API — resolves ZIP codes to NY state-level elected officials (state senators and assembly members)
- `data/candidates.json` — enrichment and fallback for federal and local officials not covered by Open States

**New backend lives in a `backend/` directory at the repo root.**

---

## Architecture

```
Browser (index.html + JS modules)
        │
        ▼
   api.js  ──── primary ──▶  FastAPI backend (IBM Code Engine)
        │                            │
        └── fallback ──▶             ├── Open States API  (NY state reps by ZIP)
   data/candidates.json              ├── data/candidates.json  (federal + local enrichment/fallback)
                                     ├── IBM watsonx.ai
                                     └── IBM Cloudant
```

**Request flow:**
1. User enters ZIP → `api.js` calls `GET /api/candidates?zip=…`
2. Backend queries Open States API for NY state-level officials in that ZIP (state senate + assembly)
3. Backend merges results with any matching records from `data/candidates.json` (federal and local
   officials whose `zips` array includes the given ZIP)
4. Backend checks Cloudant for cached stance documents; on miss, calls watsonx.ai to
   summarize stances from public records, then caches the result in Cloudant
5. Enriched candidate records returned to frontend
6. Frontend calls `GET /api/quiz?zip=…` → backend uses watsonx.ai to generate
   district-relevant quiz questions
7. User submits answers → frontend POSTs to `POST /api/match` →
   backend uses watsonx.ai to compute match percentages and produce plain-English
   explanations per politician

---

## File Structure (new additions)

```
backend/
├── main.py                # FastAPI app entry point, CORS config, router registration
├── requirements.txt       # Python dependencies
├── Dockerfile             # Container image for IBM Code Engine
├── .env.example           # Required environment variable names (no values)
│
├── routers/
│   ├── candidates.py      # GET /api/candidates?zip=
│   ├── quiz.py            # GET /api/quiz?zip=
│   └── match.py           # POST /api/match
│
├── services/
│   ├── openstates.py      # Open States API client (NY state reps by ZIP)
│   ├── candidates_local.py  # Local data/candidates.json lookup (federal + local enrichment/fallback)
│   ├── watsonx.py         # IBM watsonx.ai client (stance analysis, quiz gen, match explain)
│   └── cloudant.py        # IBM Cloudant read/write helpers
│
└── models/
    ├── candidate.py       # Pydantic models for candidate and stance data
    └── quiz.py            # Pydantic models for quiz questions and match results
```

**Frontend change — one file only:**
- `JS/api.js` — updated to call backend endpoints first, fall back to local JSON on error

---

## Sub-Tasks

---

### Sub-Task 1 — Backend Scaffolding
**Status:** `[x] done`

**Intent:**
Create the full `backend/` directory structure with all files as stubs. This establishes the
project shape so each subsequent sub-task has a known target. The FastAPI app should start
and return a health-check response before any real logic is wired up.

**Expected Outcomes:**
- `backend/` directory exists with the full folder/file structure above
- `backend/main.py` starts a FastAPI app that responds `{ "status": "ok" }` at `GET /health`
- `backend/requirements.txt` lists all needed packages (fastapi, uvicorn, httpx, pydantic,
  ibm-cloud-sdk-core, ibmcloudant, ibm-watsonx-ai, python-dotenv)
- `backend/Dockerfile` builds a minimal Python image that runs `uvicorn main:app`
- `backend/.env.example` lists all required env var names with empty values and comments
- Running `uvicorn main:app --reload` from `backend/` starts the server with no errors

**Todo List:**
1. Create `backend/` and all subdirectories (`routers/`, `services/`, `models/`)
2. Create stub `__init__.py` files in each package directory
3. Write `requirements.txt` with all dependencies pinned to compatible versions
4. Write `main.py` — FastAPI app, CORS middleware allowing the frontend origin, health endpoint,
   placeholder router registrations (commented out until implemented)
5. Write `Dockerfile` — `python:3.11-slim` base, copy source, install requirements, expose port,
   CMD uvicorn
6. Write `.env.example` with keys:
   - `OPEN_STATES_API_KEY`
   - `WATSONX_API_KEY`, `WATSONX_PROJECT_ID`, `WATSONX_URL`
   - `CLOUDANT_URL`, `CLOUDANT_APIKEY`, `CLOUDANT_DB_NAME`
   - `FRONTEND_ORIGIN` (for CORS)

**Relevant Context:**
- Backend will be deployed to IBM Code Engine as a container — the Dockerfile is the
  deployment artifact
- All secrets must come from environment variables, never hardcoded

---

### Sub-Task 2 — IBM Cloudant Service Layer
**Status:** `[ ] pending`

**Intent:**
Build the Cloudant client wrapper in `services/cloudant.py`. This is the persistence layer
for cached stance documents and quiz sets. All other services and routers call this module —
never the Cloudant SDK directly.

**Expected Outcomes:**
- `services/cloudant.py` exports:
  - `get_document(doc_id)` — retrieves a document by ID, returns `None` if not found
  - `save_document(doc_id, data)` — creates or updates a document (upsert)
  - `query_by_field(field, value)` — Cloudant `_find` selector query, returns list of docs
- Cloudant client is initialized once using env vars (URL + API key)
- If Cloudant credentials are missing, the module logs a warning and all calls return
  `None`/empty gracefully (supports local dev without IBM Cloud)

**Todo List:**
1. Import `ibmcloudant` SDK and `python-dotenv`; load env vars
2. Write a lazy-initialized `_get_client()` function that returns a configured Cloudant client
3. Implement `get_document(doc_id)` — catches `404` and returns `None`
4. Implement `save_document(doc_id, data)` — fetches the existing `_rev` if the doc exists
   to perform an update, otherwise creates a new doc
5. Implement `query_by_field(field, value)` — uses Cloudant `_find` with a simple equality
   selector; ensure the required index exists or handle the missing-index error gracefully

**Relevant Context:**
- Cloudant DB name comes from env var `CLOUDANT_DB_NAME`
- Document IDs for stances: `stance:{candidate-id}` (e.g. `stance:alexandria-ocasio-cortez`)
- Document IDs for quiz sets: `quiz:{district-key}` (e.g. `quiz:ny-district-14`)

---

### Sub-Task 3 — Open States API Service + Local Candidate Lookup
**Status:** `[x] done`

**Intent:**
Replace the defunct Google Civic Information API with two complementary lookup services:

1. **`services/openstates.py`** — a thin async client for the Open States API. Given a ZIP code
   it returns NY state-level elected officials (NY State Senate and NY State Assembly members)
   who represent that ZIP.

2. **`services/candidates_local.py`** — a local lookup service that reads `data/candidates.json`
   (bundled with the repo) and returns any candidate whose `zips` array includes the given ZIP.
   This covers federal officials (U.S. House, U.S. Senate) and NYC/local officials not served
   by Open States.

Together these two services replace the single Civic API call. `routers/candidates.py`
calls both and merges the results, deduplicating by candidate ID.

**Expected Outcomes:**
- `openstates.get_representatives_by_zip(zip_code)` returns a list of dicts, each with:
  `{ id, name, party, office, district, photo_url, website }`
  sourced from the Open States API, scoped to NY state legislators only
- `candidates_local.get_candidates_by_zip(zip_code)` returns a list of the same dict shape,
  sourced from `data/candidates.json` filtered by the `zips` field
- Both functions return an empty list on failure — no crash
- If the Open States API key is missing, `openstates.py` logs a warning and returns `[]`,
  leaving `candidates_local.py` to serve what it can
- Deduplication: if the same politician appears in both sources (matched by name slug),
  the Open States record is preferred (fresher) but the local record's `positions` data is merged in

**Todo List:**
1. Register for a free Open States API key at https://openstates.org/api/register/
2. Implement `services/openstates.py`:
   a. Use `httpx.AsyncClient` to call `https://v3.openstates.org/people.geo`
      with params `lat={lat}&lng={lng}&apikey={OPEN_STATES_API_KEY}`
   b. Convert the ZIP code to lat/lng using the `pgeocode` library (add to `requirements.txt`)
      or the free `zippopotam.us` REST API (no key needed)
   c. Filter results to `jurisdiction.name` matching `New York` to stay NY-only
   d. Map each result to `{ id, name, party, office, district, photo_url, website }`:
      - `id`: URL-safe slug of the name (e.g. `kirsten-gillibrand`)
      - `office`: `official.current_role.title` (e.g. `"State Senator"`, `"State Representative"`)
      - `district`: `official.current_role.district`
      - `party`: `official.party`
      - `photo_url`: `official.image` (may be `null`)
      - `website`: first entry of `official.links` list (may be `null`)
   e. Handle HTTP errors and missing fields with safe `.get()` defaults
3. Implement `services/candidates_local.py`:
   a. Load `data/candidates.json` from the repo root on first call (lazy-load, cached in memory)
   b. Implement `get_candidates_by_zip(zip_code)` — filter by `candidate["zips"]` containing the ZIP
   c. Map each matching record to the same internal dict shape (using `positions` from JSON directly)
   d. Return `[]` if the file cannot be loaded (log the error)
4. Add `OPEN_STATES_API_KEY` to `backend/.env.example`
5. Add `pgeocode` (or document the `zippopotam.us` approach) to `requirements.txt`

**Relevant Context:**
- Open States API v3 docs: https://docs.openstates.org/api-v3/
- `people.geo` endpoint accepts `lat` + `lng` and returns legislators for that point
- `data/candidates.json` is at the repo root (one level above `backend/`); load with
  `Path(__file__).parent.parent / "data" / "candidates.json"`
- Candidate `id` slug pattern: lowercase name, spaces → hyphens, strip punctuation
  (e.g. `"Alexandria Ocasio-Cortez"` → `"alexandria-ocasio-cortez"`)
- ZIP → lat/lng via `zippopotam.us`: `GET https://api.zippopotam.us/us/{zip}` returns
  `{ places: [{ latitude, longitude }] }` — no key required, add to the httpx calls
  already being made

---

### Sub-Task 4 — IBM watsonx.ai Service Layer
**Status:** `[x] done`

> **Architecture note (November 2026):** The implemented architecture diverges from the original
> design. Stances come from `data/candidates.json` (pre-authored), so `analyze_stances()` is not
> needed. Quiz questions come from `data/quiz.json` (pre-authored), so `generate_quiz_questions()`
> is deferred to Sub-Task 6 where it belongs alongside the topic/scoring coordination work.
> The `ibm-watsonx-ai` SDK is not used — direct `httpx` REST calls are made instead, keeping
> auth in one place (`services/ibm_auth.py`). `WATSONX_PROJECT_ID` has been replaced with
> `WATSONX_SPACE_ID` throughout. See `watsonx-subtask4-plan.md` for the detailed implementation plan.

**Intent:**
Wire up `services/watsonx.py` — the module is already scaffolded with two AI operations using
direct REST calls to the watsonx.ai API:
1. **Biography summarization** — given a list of sourced public facts about a politician, select
   1–2 facts to compose a neutral extractive biography summary
2. **Match explanation** — given a user's quiz answers and a candidate's positions, return a
   plain-English explanation of why they are a good or poor match

**Expected Outcomes:**
- `summarize_biography(facts)` returns a plain-English string composed only of supplied facts,
  or `""` if watsonx is unavailable or the model output is invalid
- `explain_match(answers, candidate, baseline)` returns a 2-sentence neutral explanation string,
  or `""` on failure — match scores are never affected
- Both functions are guarded by `watsonx_bios_enabled()` / `watsonx_enabled()` in `config.py`
- If watsonx credentials are missing or the call fails, both functions return `""` gracefully
- All 40 existing tests pass with the live credentials wired in

**Todo List:**
1. Confirm a model ID available in your deployment space that supports both
   `/ml/v1/text/generation` and `/ml/v1/text/chat` with JSON output
   (recommended: `ibm/granite-3-8b-instruct`)
2. Harden `summarize_biography()` JSON parsing with a regex fallback for models that return
   JSON embedded in prose rather than strict `response_format` output
3. Add `backend/scripts/smoke_watsonx.py` — a manual developer script to verify both functions
   return valid output against the live deployment space before enabling in production
4. Update `backend/.env.example` with inline comments showing where to find the Space GUID
   and which model IDs are recommended
5. Add an "Enabling IBM watsonx.ai" section to `backend/README.md` with step-by-step setup
   instructions covering API key, Space GUID, URL, model ID, and smoke test

**Relevant Context:**
- `services/watsonx.py` uses `httpx` REST calls, not the `ibm-watsonx-ai` SDK
- Auth is handled by `services/ibm_auth.py` — IBM Cloud IAM (`iam.cloud.ibm.com`), no changes needed
- `WATSONX_SPACE_ID` replaces `WATSONX_PROJECT_ID` everywhere (already applied)
- `generate_quiz_questions()` is deferred to Sub-Task 6 — it requires topic/scoring coordination
  with `data/quiz.json`, `scoring.py`, and `data/candidates.json` that belongs in that sub-task

---

### Sub-Task 5 — Candidates Endpoint
**Status:** `[x] done`

> **Architecture note (November 2026):** Fully implemented during scaffolding. `routers/candidates.py`
> handles both `GET /api/candidates` and `GET /api/candidates/{id}/profile`. ZIP validation, Open States
> merge, local JSON fallback, deduplication, and profile enrichment via `synchronize_profile()` are all
> in place. `analyze_stances()` and Cloudant stance caching are not needed — positions come from
> `data/candidates.json`. The router is registered in `main.py`.

**Intent:**
Implement `GET /api/candidates?zip=` in `routers/candidates.py`. This is the primary endpoint
the frontend calls on ZIP search. It orchestrates Civic API → Cloudant cache → watsonx.ai
stance analysis and returns a fully enriched candidate list.

**Expected Outcomes:**
- `GET /api/candidates?zip=10001` returns a JSON array of candidate objects with fields:
  `id, name, party, office, district, photo, website, positions`
  where `positions` is `[{ topic, stance, summary }]`
- Cache hit path (Cloudant has stance doc): returns in <300ms
- Cache miss path: calls watsonx.ai for stances, stores result in Cloudant, then returns
- Returns `[]` with a `204 No Content` if ZIP has no NY representatives
- ZIP validation: must be 5 digits; returns `422` with an error message on invalid input

**Todo List:**
1. Add a Pydantic model `CandidateResponse` in `models/candidate.py` matching the shape above
2. Write the route in `routers/candidates.py`:
   - Validate ZIP with a regex pattern on the query param
   - Call both `openstates.get_representatives_by_zip(zip)` and
     `candidates_local.get_candidates_by_zip(zip)` concurrently via `asyncio.gather()`
   - Merge and deduplicate the two result lists (prefer Open States record, merge in
     local `positions` data if the same candidate appears in both)
   - Return 204 if the merged list is empty
   - For each official, check Cloudant for a cached stance doc (`stance:{id}`)
   - On cache miss, call `watsonx.analyze_stances(name, office, district)` and
     save result to Cloudant
   - Merge stance data into the official record and return as `CandidateResponse` list
3. Register the router in `main.py` with prefix `/api`

**Relevant Context:**
- Watsonx stance calls can run concurrently — use `asyncio.gather()` for cache misses
  across multiple officials to keep latency manageable
- Photo URL comes from Open States (`official.image`) or is `null` for local-JSON records
  without a photo — use `null` and let the frontend fall back to a placeholder
- Local `data/candidates.json` records already have `positions` populated; skip the
  watsonx stance call for those candidates if positions are present (treat as a cache hit)

---

### Sub-Task 6 — Quiz Endpoint
**Status:** `[x] done`

> **Architecture note (November 2026):** The implemented approach follows `watsonx-subtask6-plan.md`
> rather than the original design above. Generating questions on new topics (which would require
> extending `STANCE_SCORE`, `data/candidates.json`, and match validation) is deferred to a future
> iteration. Instead, `generate_quiz_questions()` rephrases the existing 15 likert question
> prompts so the quiz feels fresh each session while keeping all topic keys, scoring math, and
> match logic completely unchanged. The route and function are both implemented and all 60 tests
> pass. See `watsonx-subtask6-plan.md` for the full detailed design.

**Intent:**
Implement `GET /api/quiz?zip=` in `routers/quiz.py`. Given a ZIP, it returns dynamically
generated quiz questions tailored to the politicians serving that area. This sub-task also
introduces `generate_quiz_questions()` into `services/watsonx.py` — deferred from Sub-Task 4
because it requires coordinating new topic keys with `data/quiz.json`, `scoring.py`'s
`STANCE_SCORE` map, and candidate `positions` data in `data/candidates.json`.

**Expected Outcomes:**
- `GET /api/quiz` returns the full question set; with `ENABLE_WATSONX=true` the 15 likert
  question prompts are rephrased by watsonx — all other fields (`id`, `topic`, `score`,
  `options`, `section`, `type`) are identical to the static set
- Topic keys, `STANCE_SCORE`, and match scoring are entirely unchanged — no 422 risk
- Rephrased questions are cached in Cloudant under `quiz:rephrased:{static_version}` and
  reused until `data/quiz.json` changes (cache key is a hash of the static payload)
- If `ENABLE_WATSONX=false` or watsonx is unavailable, the existing static `data/quiz.json`
  question set is returned — no regression from current behavior
- `X-Quiz-Version` header reflects the hash of the final returned payload (rephrased or static)

**Implemented:**
1. `generate_quiz_questions(questions)` in `services/watsonx.py`:
   - Filters to `type == "likert"` questions with a non-null `topic` only — demographic
     "About You" questions are never sent to the model
   - Sends only `id` + `prompt` pairs — no `score` arrays, options, or user data
   - Calls `/ml/v1/text/generation` with `max_new_tokens: 800`, `decoding_method: "greedy"`
   - Parses the JSON array response with a `_JSON_ARRAY_RE` regex fallback
   - Requires ≥ 50% of scorable questions rephrased; discards the response if too few returned
   - Merges rephrased prompts back over the full static list; returns `[]` on any failure
   - Guarded by `watsonx_enabled()`
2. `routers/quiz.py` extended with the rephrasing path:
   - `ENABLE_WATSONX=false` → unchanged behavior, `quiz:{static_version}` cache key
   - `ENABLE_WATSONX=true` → checks `quiz:rephrased:{static_version}` in Cloudant first;
     on cache miss calls `generate_quiz_questions()`, caches and returns the result;
     on empty result falls back to the static set
3. Three new tests added in `tests/test_api.py` (60 total, all passing):
   - `test_watsonx_quiz_rephrasing` — rephrased prompt present; topic/score/options unchanged
   - `test_watsonx_quiz_fallback` — empty generator returns the static set exactly
   - `test_watsonx_quiz_cache_hit_skips_generate` — second request hits cache, generator called once

**Relevant Context:**
- `policy_topics()` in `services/civic.py` derives the valid topic set from `data/quiz.json`
- `STANCE_SCORE` in `scoring.py` defines valid stance strings — unchanged by this sub-task
- `QuizQuestion` and `QuizOption` Pydantic models in `models/quiz.py` — unchanged
- New topics beyond the current set are out of scope; that work is deferred to a future iteration

---

### Sub-Task 7 — Match Endpoint
**Status:** `[ ] pending`

**Intent:**
Implement `POST /api/match` in `routers/match.py`. Receives the user's quiz answers and a
list of candidate IDs, and returns a match percentage and AI-written explanation for each.

**Expected Outcomes:**
- `POST /api/match` with body `{ answers: { topic: value }, candidate_ids: [str] }` returns:
  `[{ candidate_id, match_pct, explanation }]`
- `match_pct` is calculated server-side: `(matching topics / total topics) * 100`, rounded
  to the nearest integer
- `explanation` is a 2–3 sentence plain-English string from `watsonx.explain_match()`
- Explanation calls run concurrently per candidate using `asyncio.gather()`
- If watsonx fails for a candidate, `explanation` defaults to an empty string (no crash)

**Todo List:**
1. Add Pydantic models `MatchRequest` and `MatchResult` in `models/quiz.py`
2. Write the route in `routers/match.py`:
   - Validate that `answers` is a non-empty dict and `candidate_ids` is a non-empty list
   - For each candidate ID, load their stance doc from Cloudant
   - Compute `match_pct` by comparing `answers[topic]` to `stance[topic]` for each shared topic
   - Call `watsonx.explain_match(answers, candidate_stances)` for each candidate concurrently
   - Return list of `MatchResult` objects
3. Register the router in `main.py`

**Relevant Context:**
- Stance values from watsonx use terms like `"support"`, `"oppose"`, `"neutral"` — quiz
  answer options must use the same values (defined in Sub-Task 6)
- If a candidate has no stance data in Cloudant, return `match_pct: null` and
  `explanation: "Stance data unavailable"`

---

### Sub-Task 8 — Frontend api.js Update
**Status:** `[ ] pending`

**Intent:**
Update `JS/api.js` to call the backend REST API as the primary data source, with the existing
`data/candidates.json` as a fallback. Update `JS/quiz.js` to fetch questions from the backend
and POST answers for scoring. This is the only frontend file that changes structurally.

**Expected Outcomes:**
- `getCandidatesByZip(zip)` calls `GET /api/candidates?zip={zip}` and falls back to
  `data/candidates.json` (filtered to preview records) if the fetch fails or returns non-200
- `getQuizQuestions(zip)` calls `GET /api/quiz?zip={zip}` and falls back to a small static
  default question set embedded in the JS if the backend is unreachable
- `submitQuizAnswers(answers, candidateIds)` POSTs to `/api/match` and returns the results
  array; on failure returns an empty array so the UI degrades gracefully
- The backend base URL is read from a single constant `const API_BASE` at the top of
  `api.js` — empty string `""` means same-origin (dev), set to the Code Engine URL in prod
- Existing `getCandidatesByName()` function is preserved unchanged

**Todo List:**
1. Add `const API_BASE = ""` at the top of `api.js` (single place to swap in the Code Engine URL)
2. Rewrite `getCandidates()` to try `${API_BASE}/api/candidates?zip=${zip}` first; on any
   error, `fetch("../data/candidates.json")` and return the full array as fallback
3. Keep `getCandidatesByName()` as-is — it uses the already-cached candidates array
4. Add `getQuizQuestions(zip)` — fetches `/api/quiz?zip=${zip}`, returns parsed JSON;
   on error returns a 5-question static fallback array defined in the same file
5. Add `submitQuizAnswers(answers, candidateIds)` — POSTs JSON to `/api/match`, returns
   parsed result array; on error returns `[]`
6. Update `JS/quiz.js` to call `getQuizQuestions(zip)` for question data and
   `submitQuizAnswers(answers, candidateIds)` for scoring, then render the results

**Relevant Context:**
- `JS/quiz.js` is currently empty — it needs to be written from scratch as part of this task
- `JS/search.js` already extracts the ZIP value and passes it to the candidates flow —
  it should also pass the ZIP to the quiz module when the quiz is started

---

### Sub-Task 9 — IBM Code Engine Deployment
**Status:** `[ ] pending`

**Intent:**
Document and configure the steps needed to build the Docker image and deploy the backend
to IBM Code Engine so the team can run the full stack from the cloud.

**Expected Outcomes:**
- `backend/Dockerfile` builds successfully with `docker build`
- A `backend/deploy.md` file documents every step: install IBM Cloud CLI, build image,
  push to IBM Container Registry, create Code Engine project, create application, set env vars
- The deployed app responds to `GET /health` from the public internet
- The frontend `API_BASE` constant in `api.js` can be set to the Code Engine app URL

**Todo List:**
1. Verify `Dockerfile` runs the app correctly with `docker build` and `docker run` locally
2. Write `backend/deploy.md` with step-by-step instructions:
   - `ibmcloud login` and target the right region/resource group
   - `ibmcloud cr` push to IBM Container Registry
   - `ibmcloud ce application create` with image, port, and env var flags
   - List all required env var names that must be set on the Code Engine app
3. Add a `backend/README.md` covering local dev setup: `python -m venv`, `pip install`,
   copy `.env.example` to `.env`, `uvicorn main:app --reload`

**Relevant Context:**
- IBM Code Engine free tier supports up to 2 apps — suitable for competition
- Port inside the container: `8000` (uvicorn default); Code Engine routes external HTTPS
  to this port automatically

---

## Key Design Decisions

| Decision | Choice |
|---|---|
| Backend framework | FastAPI (async, good for concurrent watsonx + Open States calls) |
| Hosting | IBM Code Engine (containerized) |
| Database | IBM Cloudant (NoSQL, fully on IBM Cloud) |
| AI | IBM watsonx.ai with ibm/granite-13b-instruct-v2 (configurable) |
| State-level politician lookup | Open States API v3 by ZIP (via lat/lng geocoding) |
| Federal + local politician lookup | data/candidates.json filtered by zips field |
| ZIP geocoding | zippopotam.us free REST API (no key required) |
| Cache strategy | Cloudant documents, no TTL (competition scope) |
| Frontend fallback | data/candidates.json if backend unreachable |
| Secrets | Environment variables only, never committed |
| Frontend change | Only JS/api.js and JS/quiz.js change |
