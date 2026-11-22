# Sub-Task 6 — watsonx Quiz Generation Implementation Plan

## Overview

Use IBM watsonx.ai to rephrase the existing static policy questions so the quiz feels fresh
each session, while keeping all topic keys, scoring math, and match logic completely unchanged.

**Approach:** `generate_quiz_questions()` receives the existing questions and asks the model
to rewrite each `prompt` field in a neutral, different phrasing. Topic keys, `score` arrays,
`options`, `section`, and `type` are all taken from the original static data — the model only
touches the question wording. This means zero changes to `STANCE_SCORE`, `policy_topics()`,
`data/candidates.json`, `routers/match.py`, or `models/quiz.py`.

**New topics beyond the current set are out of scope for this sub-task.** That work (extending
STANCE_SCORE, candidate positions, and match validation) is deferred to a future iteration.

**Scope:**
- Add `generate_quiz_questions(questions)` to `services/watsonx.py`
- Extend `routers/quiz.py` to call it when `ENABLE_WATSONX=true`, cache the result, and
  return rephrased questions in place of the static ones
- Static `data/quiz.json` is always the fallback — no regression if watsonx fails
- All 57 existing tests must continue to pass

---

## Sub-Tasks

---

### Sub-Task 6a — Add `generate_quiz_questions()` to `services/watsonx.py`
**Status:** `[ ] pending`

**Intent:**
Add an async function `generate_quiz_questions(questions: list[dict]) -> list[dict]` that
sends the existing question prompts to watsonx.ai and receives rephrased versions back.
The model only rewrites the `prompt` field — all other fields are taken from the originals
and merged back in after the call, so scoring is never affected.

**Expected Outcomes:**
- `generate_quiz_questions(questions)` returns a list of dicts, one per input question that
  has a non-null `topic` and `type == "likert"`, with the `prompt` field rewritten
- All other fields (`id`, `type`, `topic`, `section`, `score`, `options`, `helpText`) are
  copied unchanged from the original question
- Returns `[]` on any watsonx failure — static fallback applies
- If `ENABLE_WATSONX=false` or credentials are missing, returns `[]` immediately
- The model is never sent `score` arrays, `options`, or any user data

**Todo List:**
1. Add `generate_quiz_questions(questions: list[dict]) -> list[dict]` to
   `backend/services/watsonx.py`, guarded by `watsonx_enabled()`
2. Filter input to only scorable questions: `type == "likert"` and `topic` is not null
3. Build a prompt that:
   - Lists each question's `id` and current `prompt` text
   - Instructs the model to rephrase each prompt neutrally without changing its meaning
   - Asks for output as a JSON array: `[{"id": "q_housing_rent", "prompt": "...rephrased..."}]`
   - Instructs: "Return valid JSON only. No prose, no markdown fences. Keep all original ids."
4. Call `/ml/v1/text/generation` with `max_new_tokens: 800`, `decoding_method: "greedy"`
5. Parse the JSON array response using a regex fallback extractor
   (`_JSON_ARRAY_RE = re.compile(r"\[.*\]", re.DOTALL)`) consistent with existing patterns
6. For each returned item, look up the original question by `id` and merge: take the original
   question dict and replace only its `prompt` with the model's rephrased version
7. Validate that the returned `id` exists in the originals — skip any item with an unknown id
8. Return the merged list; return `[]` if fewer than half the questions were successfully
   rephrased (indicates a bad model response)

**Relevant Context:**
- `watsonx_enabled()` and `/ml/v1/text/generation` pattern already established in the file —
  follow the same structure as `explain_match()`
- Only `likert` questions drive match scoring; `text`, `choice`, and `multicheck` questions
  are "About You" demographic questions that the model does not need to rephrase
- There are 15 likert questions in `data/quiz.json` across 9 topics — the prompt will list
  all 15 current prompts with their ids

---

### Sub-Task 6b — Extend `routers/quiz.py` to use generated questions
**Status:** `[ ] pending`

**Intent:**
When `ENABLE_WATSONX=true`, the quiz endpoint calls `generate_quiz_questions()` and returns
rephrased versions of the policy questions. The "About You" demographic questions (non-likert)
are always returned unchanged from the static set. Results are cached so watsonx is called
at most once per quiz version, not once per user.

**Expected Outcomes:**
- `GET /api/quiz` with `ENABLE_WATSONX=false` — unchanged behavior, static questions returned
- `GET /api/quiz` with `ENABLE_WATSONX=true` — likert questions have rephrased prompts;
  all other fields are identical to the static set
- Second call with same watsonx state hits the cache and does not call watsonx again
- If `generate_quiz_questions()` returns `[]`, the static questions are returned unchanged
- The `X-Quiz-Version` header reflects the rephrased set when watsonx is active

**Todo List:**
1. Import `watsonx_enabled` from `backend.config` and `generate_quiz_questions` from
   `backend.services.watsonx` in `routers/quiz.py`
2. After loading the static questions from `get_questions()`, check `watsonx_enabled()`:
   - If false: proceed as today (cache static set, return it)
   - If true: check Cloudant for `"quiz:rephrased:{version}"` where `version` is the
     hash of the **static** payload (this ties cache invalidation to `data/quiz.json` changes)
   - On cache hit: validate and return the cached rephrased questions
   - On cache miss: call `await generate_quiz_questions([q.model_dump() for q in questions])`
   - If non-empty: merge rephrased likert prompts back over the static list,
     save to Cloudant as `{"type": "rephrased_quiz", "version": version, "questions": merged}`,
     and return the merged list
   - If empty: return the static list unchanged
3. The version hash in `X-Quiz-Version` is computed over the **final returned** payload
   (rephrased or static) so the frontend can detect which version it has

**Relevant Context:**
- `get_questions()` returns `list[QuizQuestion]` — call `.model_dump()` to pass to generator
- Merge strategy: iterate the static list; for each question, if it appears in the rephrased
  output (matched by `id`), replace its `prompt` with the rephrased version; otherwise keep
  the original — this ensures the demographic questions are always untouched
- Cache key `"quiz:rephrased:{version}"` is distinct from the existing `"quiz:{version}"` key
  so the two cache paths never collide

---

### Sub-Task 6c — Add tests for the rephrasing path
**Status:** `[ ] pending`

**Intent:**
Add focused tests that verify the rephrasing path, cache hit, and fallback without making
live IBM calls. All tests use monkeypatching consistent with the existing patterns.

**Expected Outcomes:**
- A test verifies that when `generate_quiz_questions()` returns rephrased prompts, the quiz
  response contains those prompts but all other fields (topic, score, options) are unchanged
- A test verifies that when `generate_quiz_questions()` returns `[]`, the response equals
  the static question set exactly
- A test verifies that the cache hit path does not call `generate_quiz_questions()` again
- All 57 existing tests continue to pass

**Todo List:**
1. Add `test_watsonx_quiz_rephrasing(client, monkeypatch)` in `backend/tests/test_api.py`:
   - Set `ENABLE_WATSONX=true` and all `WATSONX_*` env vars via monkeypatch
   - Monkeypatch `routers.quiz.generate_quiz_questions` to return a list with one rephrased
     question (e.g. `q_housing_rent` with a different prompt, all other fields from original)
   - `GET /api/quiz` — verify the rephrased prompt appears and topic/score/options are unchanged
2. Add `test_watsonx_quiz_fallback(client, monkeypatch)`:
   - Monkeypatch `generate_quiz_questions` to return `[]`
   - `GET /api/quiz` with `ENABLE_WATSONX=true` — verify response equals the static set

**Relevant Context:**
- Monkeypatch target is `backend.routers.quiz.generate_quiz_questions` (the imported name),
  not `backend.services.watsonx.generate_quiz_questions`
- The existing `test_full_workflow` test uses `ENABLE_WATSONX=false` (the client fixture
  default) so it never touches the rephrasing path and must keep passing unchanged

---

## Key Design Decisions

| Decision | Choice |
|---|---|
| Model writes | Prompt text only — topic, score, options, section, type copied from originals |
| Scope | Rephrase existing questions only — new topics deferred to a future sub-task |
| Changes to match logic | None — topic keys are identical, policy_topics() unchanged |
| Changes to STANCE_SCORE | None |
| Changes to data/candidates.json | None |
| Fallback | Static data/quiz.json returned on any watsonx failure |
| Cache key | "quiz:rephrased:{static-version}" — invalidated when data/quiz.json changes |
| Demographic questions | Always returned from static set unchanged |
