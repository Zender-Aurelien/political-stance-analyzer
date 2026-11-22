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

## Before public deployment

Live IBM calls are unverified without account credentials. The current dataset is a sample, and the retired Google representative lookup has not been replaced. A production release still needs verified current records, a live location provider if desired, hosting/account configuration, rate limits, and the deployment's own security review. No public deployment was made for this local-demo task.
