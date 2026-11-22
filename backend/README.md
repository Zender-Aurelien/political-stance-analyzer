# Backend operator notes

Run commands from the **repository root**, not the backend directory:

```bash
backend/.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Use the root README for first-time installation. The same server serves the website, public assets, API, and `/docs`. Only `JS`, `Styles.css`, `assets`, and `data` are mounted; the repository root and backend directory are never mounted as static files.

`backend/.env` is loaded relative to this file regardless of the working directory. `FRONTEND_ORIGIN` is a comma-separated list of allowed separate frontend origins. Credentials are disabled for CORS and no wildcard is required for the same-origin demo.

## Local Docker test

Build and run the image from the **repository root**:

```bash
docker build -f backend/Dockerfile -t civic-lens .
docker run -p 8000:8000 --env-file backend/.env civic-lens
```

Then open `http://localhost:8000/health` to confirm the container is healthy. The
`--env-file backend/.env` flag is optional; omit it to run with no credentials (sample
data only, no IBM services). See `backend/deploy.md` for the full IBM Code Engine
deployment guide.

## Cache

`CACHE_PATH` defaults to `backend/.cache/public-data.sqlite3`. SQLite persists public quiz reference documents across restarts. The quiz cache ID includes a hash of the reviewed question data, so editing `data/quiz.json` invalidates old content. Quiz answers and match requests are not saved.

Set `CLOUDANT_URL`, `CLOUDANT_APIKEY`, and `CLOUDANT_DB_NAME` to enable the optional Cloudant cache. IAM tokens are refreshed automatically. The adapter handles revisions, retries a conflict once, and falls back locally if unavailable. Database creation is attempted when needed and requires the configured IBM identity to have permission.

## Enabling IBM watsonx.ai

Quiz scoring and match percentages are computed locally — IBM credentials are never required to run the app. The two optional features below send data to IBM only when explicitly enabled.

**Step 1 — Get an IBM Cloud API key**

Log in to [cloud.ibm.com](https://cloud.ibm.com) → Manage → Access (IAM) → API keys → Create. Paste the key as `WATSONX_API_KEY` in `backend/.env`.

**Step 2 — Get your deployment space GUID**

In the IBM Cloud console, navigate to your watsonx.ai deployment space → Manage tab → copy the **Space GUID**. Paste it as `WATSONX_SPACE_ID`.

**Step 3 — Confirm your region URL**

| Region | WATSONX_URL |
|---|---|
| Dallas (us-south) | `https://us-south.ml.cloud.ibm.com` |
| Frankfurt (eu-de) | `https://eu-de.ml.cloud.ibm.com` |
| Tokyo (jp-tok) | `https://jp-tok.ml.cloud.ibm.com` |

**Step 4 — Choose a model**

Set `WATSONX_MODEL_ID` to a model available in your deployment space. The default `ibm/granite-3-8b-instruct` supports both features. Confirm available models in your space: watsonx.ai console → your space → Foundation Models.

**Step 5 — Enable the features you want**

```
ENABLE_WATSONX=true        # match explanation sentences (sends policy scores + public positions)
ENABLE_WATSONX_BIOS=true   # biography summarization (sends public profile facts only)
```

Both can be enabled independently. Neither sends ZIP codes, demographic answers, or user-identifying data to IBM.

**Step 6 — Verify with the smoke test**

```bash
python -m backend.scripts.smoke_watsonx
```

This calls both functions with sample data and prints the live responses. If either returns an empty string, the output includes a diagnosis hint.

## Optional explanations

`ENABLE_WATSONX=true` transmits policy topic averages and public candidate positions to IBM to generate a 2-sentence plain-English match explanation per candidate. Demographic context and ZIP are excluded. Scores remain deterministic regardless of watsonx availability. IAM or generation failures fall back to a rules-based explanation automatically.

## Profile summaries

`ENABLE_WATSONX_BIOS=true` separately enables source-grounded public biographies using the same `WATSONX_*` credentials. It calls `/ml/v1/text/chat` with JSON output to select supplied source sentences — only those original sentences are shown, never model-generated claims. `ENABLE_WATSONX=false` continues to disable quiz comparisons independently.

Profile refreshes have bounded source requests and an eight-second summary budget. IBM failures use official excerpts or a labeled Open States office overview. An unavailable career biography is never replaced with invented employment or education. Cache keys are versioned; identity, office, party, and AI-setting changes invalidate the saved summary. Do not expose `backend/.env` or print IBM tokens in logs.

## Deployment

The app is deployed on [Render](https://render.com) at **https://civic-lens-latest.onrender.com**. The same Docker image (`backend/Dockerfile`) is used for both local testing and the live deployment. See `backend/deploy.md` for the step-by-step deployment guide.

The current quiz dataset is a sample. Open States supplies optional live New York state office records; it does not establish a complete election candidate list. A production release still needs verified policy records, rate limits, and a full security review before being used as an authoritative election guide.
