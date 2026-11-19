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
- Google Civic Information API — resolves ZIP codes to actual elected officials

**New backend lives in a `backend/` directory at the repo root.**

---

## Architecture

```
Browser (index.html + JS modules)
        │
        ▼
   api.js  ──── primary ──▶  FastAPI backend (IBM Code Engine)
        │                            │
        └── fallback ──▶             ├── Google Civic Information API
   data/candidates.json              ├── IBM watsonx.ai
                                     └── IBM Cloudant
```

**Request flow:**
1. User enters ZIP → `api.js` calls `GET /api/candidates?zip=…`
2. Backend queries Google Civic API for elected officials in that ZIP
3. Backend checks Cloudant for cached stance documents; on miss, calls watsonx.ai to
   summarize stances from public records, then caches the result in Cloudant
4. Enriched candidate records returned to frontend
5. Frontend calls `GET /api/quiz?zip=…` → backend uses watsonx.ai to generate
   district-relevant quiz questions
6. User submits answers → frontend POSTs to `POST /api/match` →
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
│   ├── civic.py           # Google Civic Information API client
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
**Status:** `[ ] pending`

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
   - `GOOGLE_CIVIC_API_KEY`
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

### Sub-Task 3 — Google Civic Information API Service
**Status:** `[ ] pending`

**Intent:**
Build `services/civic.py` — a thin async client for the Google Civic Information API's
`representativeInfoByAddress` endpoint. Given a ZIP code it returns a structured list of
elected officials scoped to New York.

**Expected Outcomes:**
- `get_representatives_by_zip(zip_code)` returns a list of dicts, each with:
  `{ id, name, party, office, district, photo_url, urls, channels }`
- Results are filtered to New York offices only (state + local + federal representing NY)
- If the API key is missing or the call fails, returns an empty list (no crash)
- If the ZIP is not in New York, returns an empty list with a flag `{"ny_only": true}`

**Todo List:**
1. Use `httpx.AsyncClient` to call:
   `https://civicinfo.googleapis.com/civicinfo/v2/representatives`
   with params `address={zip}` and `key={GOOGLE_CIVIC_API_KEY}`
2. Parse the response — iterate `offices` and `officials` arrays, join them by index
3. Map each official to the internal dict shape listed above
4. Filter to only offices whose `levels` include `country`, `administrativeArea1`
   (state), or `administrativeArea2` (local) AND whose `roles` or division URI
   contains `ny` or `new_york`
5. Handle HTTP errors and missing fields with safe `.get()` defaults

**Relevant Context:**
- Google Civic API docs: https://developers.google.com/civic-information/docs/v2
- `representativeInfoByAddress` returns `{ offices: [...], officials: [...] }` —
  each office has an `officialIndices` array pointing into the `officials` list
- Candidate `id` should be a URL-safe slug of the name (e.g. `alexandria-ocasio-cortez`)

---

### Sub-Task 4 — IBM watsonx.ai Service Layer
**Status:** `[ ] pending`

**Intent:**
Build `services/watsonx.py` — a single module that exposes three distinct AI operations,
each using the `ibm-watsonx-ai` SDK with appropriate prompts:
1. **Stance analysis** — given a politician's name and office, return structured policy positions
2. **Quiz generation** — given a list of candidates and their stances, return 5–8 quiz questions
   relevant to their district
3. **Match explanation** — given a user's quiz answers and a candidate's positions, return a
   plain-English explanation of why they are a good or poor match

**Expected Outcomes:**
- `analyze_stances(name, office, district)` returns a list of:
  `{ "topic": str, "stance": str, "summary": str }`
  (e.g. `{ "topic": "climate", "stance": "support", "summary": "Supports Green New Deal..." }`)
- `generate_quiz_questions(candidates)` returns a list of:
  `{ "id": str, "topic": str, "question": str, "options": [{"value": str, "label": str}] }`
- `explain_match(user_answers, candidate)` returns a plain-English string paragraph
- If watsonx credentials are missing, all three functions return safe empty defaults
  (empty list, empty list, empty string)

**Todo List:**
1. Initialize `ibm_watsonx_ai.foundation_models.ModelInference` using env vars
   (`WATSONX_API_KEY`, `WATSONX_PROJECT_ID`, `WATSONX_URL`)
2. Write `analyze_stances(name, office, district)`:
   - Craft a system prompt instructing the model to output JSON only
   - Include a few-shot example in the prompt to enforce the output schema
   - Parse the JSON response; on parse failure, return empty list and log the raw response
3. Write `generate_quiz_questions(candidates)`:
   - Build a prompt that includes candidate names, offices, and top stance topics
   - Ask for 5–8 multiple-choice questions with 3–4 options each, output as JSON array
   - Parse and validate; return empty list on failure
4. Write `explain_match(user_answers, candidate)`:
   - Build a prompt that describes the user's positions and the candidate's stances
   - Ask for a 2–3 sentence plain-English explanation
   - Return the raw text string
5. Choose model: `ibm/granite-13b-instruct-v2` (available on watsonx.ai, good for structured
   generation) — make model ID configurable via env var `WATSONX_MODEL_ID`

**Relevant Context:**
- Prompts must enforce JSON output — use the pattern: "Respond with valid JSON only. No
  prose, no markdown fences." followed by a schema example
- The stance `topic` values produced here must match the quiz question `topic` values so
  `match.py` can join them

---

### Sub-Task 5 — Candidates Endpoint
**Status:** `[ ] pending`

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
   - Call `civic.get_representatives_by_zip(zip)`; return 204 if empty
   - For each official, check Cloudant for a cached stance doc (`stance:{id}`)
   - On cache miss, call `watsonx.analyze_stances(name, office, district)` and
     save result to Cloudant
   - Merge stance data into the official record and return as `CandidateResponse` list
3. Register the router in `main.py` with prefix `/api`

**Relevant Context:**
- Watsonx stance calls can run concurrently — use `asyncio.gather()` for cache misses
  across multiple officials to keep latency manageable
- Photo URL comes from Google Civic API (`officials[n].photoUrl`) — may be absent; use
  `null` and let the frontend fall back to a placeholder

---

### Sub-Task 6 — Quiz Endpoint
**Status:** `[ ] pending`

**Intent:**
Implement `GET /api/quiz?zip=` in `routers/quiz.py`. Given a ZIP, it returns dynamically
generated quiz questions tailored to the politicians serving that area.

**Expected Outcomes:**
- `GET /api/quiz?zip=10001` returns a JSON array of 5–8 question objects:
  `{ id, topic, question, options: [{ value, label }] }`
- Quiz questions are cached in Cloudant under `quiz:{district-key}` and reused for the same
  district until manually invalidated (competition scope — no expiry needed)
- If candidates cannot be fetched (Civic API down), returns a default static set of questions
  as a fallback

**Todo List:**
1. Add Pydantic models `QuizQuestion` and `QuizOption` in `models/quiz.py`
2. Write the route in `routers/quiz.py`:
   - Validate ZIP
   - Call `civic.get_representatives_by_zip(zip)` to get the district key
   - Check Cloudant for `quiz:{district-key}`; return cached questions if found
   - On cache miss, fetch candidate stance summaries from Cloudant (or the candidates
     endpoint logic), then call `watsonx.generate_quiz_questions(candidates)`
   - Cache the generated questions in Cloudant and return them
3. Write a static fallback question set (5 questions on common NY policy topics) to return
   if the watsonx call fails
4. Register the router in `main.py`

**Relevant Context:**
- The `district-key` is derived from the most specific shared district of the reps returned
  (e.g. `ny-nyc` for NYC reps, `ny-district-14` for a House rep)
- Question `topic` values must align with the stance `topic` values in `services/watsonx.py`

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
| Backend framework | FastAPI (async, good for concurrent watsonx + Civic API calls) |
| Hosting | IBM Code Engine (containerized) |
| Database | IBM Cloudant (NoSQL, fully on IBM Cloud) |
| AI | IBM watsonx.ai with ibm/granite-13b-instruct-v2 (configurable) |
| Politician lookup | Google Civic Information API by ZIP |
| Cache strategy | Cloudant documents, no TTL (competition scope) |
| Frontend fallback | data/candidates.json if backend unreachable |
| Secrets | Environment variables only, never committed |
| Frontend change | Only JS/api.js and JS/quiz.js change |
