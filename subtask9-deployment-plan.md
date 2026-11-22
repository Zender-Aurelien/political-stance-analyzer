# Sub-Task 9 — IBM Code Engine Deployment Plan

## Overview

Sub-Task 9 documents and configures the steps required to build the Docker image and deploy
the Civic Lens backend to IBM Code Engine. Before any deployment documentation can be accurate,
a path mismatch in the existing `Dockerfile` must be fixed — the November 22 directory
restructure moved frontend assets from the repo root into `frontend/`, but the `COPY`
instructions still reference the old root-level paths. This is a build blocker.

**Scope:**
1. Fix `backend/Dockerfile` COPY paths to match the current `frontend/` layout
2. Verify the image builds and runs locally with Docker
3. Write `backend/deploy.md` — step-by-step IBM Cloud CLI + Code Engine deployment guide
4. Extend `backend/README.md` with a Docker local test section

**Out of scope:** Performing the actual cloud deployment (requires IBM Cloud credentials and
a live IBM account). The plan produces documentation and a corrected Dockerfile; actual
deployment is left to the operator.

---

## Sub-Tasks

---

### Sub-Task 9.1 — Fix Dockerfile COPY Paths
**Status:** `[x] done`

**Intent:**
The `backend/Dockerfile` was written before the November 22 directory restructure.
Frontend assets (`JS/`, `Styles.css`, `accessibility/`, `assets/`, `index.html`,
`about.html`) now live under `frontend/` at the repo root. The `COPY` instructions must
be updated so `docker build` succeeds.

**Expected Outcomes:**
- `docker build -f backend/Dockerfile -t civic-lens .` completes with no errors
- The image serves the frontend correctly when run locally
- No `COPY` instruction references a path that no longer exists at the repo root

**Todo List:**
1. Open `backend/Dockerfile` and update every COPY instruction that references a
   root-level frontend path:
   - `COPY JS JS` → `COPY frontend/JS JS`
   - `COPY Styles.css Styles.css` → `COPY frontend/Styles.css Styles.css`
   - `COPY accessibility accessibility` → `COPY frontend/accessibility accessibility`
   - `COPY assets assets` → `COPY frontend/assets assets`
   - `COPY index.html about.html ./` → `COPY frontend/index.html frontend/about.html ./`
2. Confirm the build comment at line 1 still reflects the correct invocation
   (`docker build -f backend/Dockerfile -t civic-lens .` from the repo root)

**Relevant Context:**
- `backend/main.py` already references `ROOT / "frontend" / ...` for `FileResponse`
  and `StaticFiles` mounts — the runtime is correct; only the Docker build paths are wrong
- `ROOT` is defined in `backend/config.py` and points to the repository root

---

### Sub-Task 9.2 — Verify Docker Build and Run Locally
**Status:** `[ ] pending — Docker not available in this environment; run manually per deploy.md Step 2`

**Intent:**
Confirm the corrected image builds cleanly and the health endpoint responds before writing
deployment docs that depend on the container working correctly.

**Expected Outcomes:**
- `docker build -f backend/Dockerfile -t civic-lens .` exits 0
- `docker run -p 8000:8000 civic-lens` starts without errors
- `GET http://localhost:8000/health` returns `{ "status": "ok" }`
- `GET http://localhost:8000/` serves the frontend HTML page

**Todo List:**
1. Run `docker build -f backend/Dockerfile -t civic-lens .` from the repo root
2. Run `docker run -p 8000:8000 civic-lens` and verify the logs show uvicorn starting
3. `curl http://localhost:8000/health` or open in browser — confirm JSON response
4. Note any issues encountered (e.g. missing packages, path errors) and fix them before
   proceeding to the documentation sub-tasks

**Relevant Context:**
- Build context must be the repo root (not `backend/`) because the Dockerfile copies
  paths relative to the repo root
- Port inside the container is 8000 (uvicorn default); Code Engine routes external HTTPS
  to this port automatically

---

### Sub-Task 9.3 — Write backend/deploy.md
**Status:** `[x] done`

**Intent:**
Create `backend/deploy.md` — a standalone step-by-step guide for deploying the Civic Lens
backend to IBM Code Engine using IBM Container Registry. The document must be self-contained
so a new operator can follow it without prior IBM Cloud experience.

**Expected Outcomes:**
- `backend/deploy.md` exists and covers:
  - Prerequisites (IBM Cloud account, IBM Cloud CLI + plugins, Docker)
  - IBM Cloud CLI login and targeting the correct region and resource group
  - Pushing the image to IBM Container Registry under a user-supplied namespace
  - Creating an IBM Code Engine project
  - Creating a Code Engine application from the pushed image with port 8000
  - Setting all required environment variables (`FRONTEND_ORIGIN`, `CLOUDANT_*`,
    `WATSONX_*`, `OPEN_STATES_API_KEY`) as Code Engine app env vars
  - Verifying the deployed app responds to `GET /health`
  - Updating `API_BASE` in `frontend/JS/api.js` to the Code Engine app URL

**Todo List:**
1. Create `backend/deploy.md` with the following sections:

   **Prerequisites**
   - IBM Cloud account with an active resource group
   - IBM Cloud CLI: `ibmcloud` with `container-registry` and `code-engine` plugins
   - Docker or Podman installed locally

   **Step 1 — Log in to IBM Cloud**
   ```
   ibmcloud login --sso
   ibmcloud target -g YOUR_RESOURCE_GROUP -r us-south
   ```

   **Step 2 — Build the Docker image**
   ```
   docker build -f backend/Dockerfile -t civic-lens .
   ```
   (run from repo root)

   **Step 3 — Push to IBM Container Registry**
   ```
   ibmcloud cr login
   ibmcloud cr namespace-add YOUR_NAMESPACE
   docker tag civic-lens us.icr.io/YOUR_NAMESPACE/civic-lens:latest
   docker push us.icr.io/YOUR_NAMESPACE/civic-lens:latest
   ```

   **Step 4 — Create a Code Engine project and application**
   ```
   ibmcloud ce project create --name civic-lens
   ibmcloud ce project select --name civic-lens
   ibmcloud ce application create \
     --name civic-lens-api \
     --image us.icr.io/YOUR_NAMESPACE/civic-lens:latest \
     --port 8000 \
     --min-scale 0 --max-scale 2 \
     --registry-secret ce-auto-icr-private-us-south
   ```

   **Step 5 — Set environment variables**
   List every env var from `.env.example` and show the `--env KEY=VALUE` flag syntax;
   note which are required vs optional.

   **Step 6 — Verify deployment**
   ```
   ibmcloud ce application get --name civic-lens-api
   curl https://<app-url>/health
   ```

   **Step 7 — Update frontend API_BASE**
   - Open `frontend/JS/api.js`, set `API_BASE` to the Code Engine app URL
   - For local dev, leave `API_BASE = ""` (same-origin via uvicorn)

   **Updating the deployment**
   - Re-push the image with the same tag
   - `ibmcloud ce application update --name civic-lens-api --image ...`

2. Use placeholder values (`YOUR_NAMESPACE`, `YOUR_RESOURCE_GROUP`) throughout; annotate
   with comments explaining where to find each value in the IBM Cloud console

**Relevant Context:**
- IBM Code Engine free tier supports up to 2 apps — suitable for competition use
- Port inside the container is 8000
- `FRONTEND_ORIGIN` on Code Engine should be the Code Engine app URL itself (same origin)
  so CORS allows the browser to call the API
- The `.dockerignore` already excludes `.env`, `.venv`, `__pycache__`, `tests`, and `.cache`
  — the image will not contain secrets or test artifacts
- `API_BASE = ""` in `frontend/JS/api.js` is correct for same-origin serving (frontend
  is served by the same uvicorn process); no change is needed for the Code Engine deployment
  unless a separate frontend CDN is used

---

### Sub-Task 9.4 — Extend backend/README.md with Docker Section
**Status:** `[x] done`

**Intent:**
Add a "Local Docker test" section to the existing `backend/README.md` so a developer can
verify the container image locally before pushing to IBM Cloud. This complements the existing
non-Docker local dev instructions.

**Expected Outcomes:**
- `backend/README.md` has a new "Local Docker test" section with the two commands
  needed to build and run the container locally
- The section notes the `--env-file` flag for passing local credentials during testing
- Existing README content is unchanged

**Todo List:**
1. Add a `## Local Docker test` section to `backend/README.md` after the existing
   "Backend operator notes" intro and before the "Cache" section:
   ```markdown
   ## Local Docker test

   Build and run the image from the **repository root**:

   \`\`\`bash
   docker build -f backend/Dockerfile -t civic-lens .
   docker run -p 8000:8000 --env-file backend/.env civic-lens
   \`\`\`

   Then open `http://localhost:8000/health` to confirm the container is healthy.
   The `--env-file backend/.env` flag is optional; omit it to run with no credentials
   (sample data only, no IBM services).
   ```
2. Confirm no existing content is altered

**Relevant Context:**
- `backend/README.md` currently has these sections: operator notes intro, Cache, Enabling
  IBM watsonx.ai, Optional explanations, Profile summaries, Before public deployment
- The Docker section logically belongs near the top, before cache and IBM service setup,
  since it's a build/run verification step

---

## Key Files Touched

| File | Change |
|---|---|
| `backend/Dockerfile` | Fix `COPY` paths from root-level to `frontend/` |
| `backend/deploy.md` | New file — IBM Code Engine deployment guide |
| `backend/README.md` | Add "Local Docker test" section |
| `frontend/JS/api.js` | No code change — `API_BASE = ""` is correct for same-origin; deploy.md documents when/how to change it |
