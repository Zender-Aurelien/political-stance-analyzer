# Backend operator notes

Run commands from the **repository root**, not the backend directory:

```bash
backend/.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Use the root README for first-time installation. The same server serves the website, public assets, API, and `/docs`. Only `JS`, `Styles.css`, `assets`, and `data` are mounted; the repository root and backend directory are never mounted as static files.

`backend/.env` is loaded relative to this file regardless of the working directory. `FRONTEND_ORIGIN` is a comma-separated list of allowed separate frontend origins. Credentials are disabled for CORS and no wildcard is required for the same-origin demo.

## Cache

`CACHE_PATH` defaults to `backend/.cache/public-data.sqlite3`. SQLite persists public quiz reference documents across restarts. The quiz cache ID includes a hash of the reviewed question data, so editing `data/quiz.json` invalidates old content. Quiz answers and match requests are not saved.

Set `CLOUDANT_URL`, `CLOUDANT_APIKEY`, and `CLOUDANT_DB_NAME` to enable the optional Cloudant cache. IAM tokens are refreshed automatically. The adapter handles revisions, retries a conflict once, and falls back locally if unavailable. Database creation is attempted when needed and requires the configured IBM identity to have permission.

## Optional explanations

Set all `WATSONX_*` fields in `.env.example` and `ENABLE_WATSONX=true` to opt in. This transmits policy topic averages and public candidate positions to IBM; demographic context and ZIP are excluded. Scores remain deterministic. IAM/generation failures preserve the result using a standard explanation. The adapter uses IBM's text-generation REST API and a configurable model, never a model ID assumed to be available.

## Profile summaries

`ENABLE_WATSONX_BIOS=true` separately enables source-grounded public biographies with the same `WATSONX_*` credentials and model configuration. It uses `/ml/v1/text/chat` with JSON output to select supplied source sentences; only those original sentences are displayed. `ENABLE_WATSONX=false` continues to disable transmission of quiz comparisons. Keep Cloudant unconfigured to use local SQLite.

Profile refreshes have bounded source requests and a further eight-second summary budget. IBM failures use official excerpts or a labeled Open States office overview. An unavailable career biography is never replaced with invented employment or education. Cache keys are versioned, and identity/office/party/AI-setting changes invalidate the saved summary. Do not expose `backend/.env` or print IBM tokens in logs.

IBM authentication and the model catalog were reachable in the local account, but generation returned `container_not_found`: the supplied project was not accessible to the key. A working project in the configured region is still required to verify actual AI summaries. Source-backed fallbacks remain usable in this state.

## Before public deployment

The current quiz dataset is a sample. Open States supplies optional live New York state office records; it does not establish a complete election candidate list. A production release still needs verified policy records, hosting/account configuration, rate limits and the deployment's own security review. No public deployment was made for this local-demo task.
