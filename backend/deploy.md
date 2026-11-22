# Civic Lens — IBM Code Engine Deployment Guide

Deploy the Civic Lens backend as a containerized application on IBM Code Engine using IBM
Container Registry. The same container serves the frontend, API, and static assets.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| IBM Cloud account | [cloud.ibm.com](https://cloud.ibm.com) — free tier is sufficient for competition use |
| IBM Cloud CLI | [Download ibmcloud CLI](https://cloud.ibm.com/docs/cli) |
| Container Registry plugin | `ibmcloud plugin install container-registry` |
| Code Engine plugin | `ibmcloud plugin install code-engine` |
| Docker or Podman | For building and pushing the image locally |

Verify plugins are installed:

```bash
ibmcloud plugin list
# Should show: container-registry, code-engine
```

---

## Step 1 — Log in to IBM Cloud

```bash
ibmcloud login --sso
```

> Follow the browser prompt to authenticate. If your account has multiple regions or
> resource groups, target the one you want to deploy into:

```bash
# Replace YOUR_RESOURCE_GROUP with your group name (e.g. "Default")
# Replace REGION with your preferred region (e.g. us-south, eu-de, jp-tok)
ibmcloud target -g YOUR_RESOURCE_GROUP -r REGION
```

> Find your resource groups at: cloud.ibm.com → Manage → Account → Resource groups

---

## Step 2 — Build the Docker image

Run from the **repository root** (the directory containing `backend/` and `frontend/`):

```bash
docker build -f backend/Dockerfile -t civic-lens .
```

Verify the image built and the health endpoint responds:

```bash
docker run --rm -p 8000:8000 civic-lens &
sleep 3
curl http://localhost:8000/health
# Expected: {"status":"ok","version":"1.0.0","data_source":"sample"}
```

---

## Step 3 — Push to IBM Container Registry

Log in to the registry for your chosen region:

```bash
# us-south (Dallas)
ibmcloud cr login --client docker

# Or for other regions:
# eu-de (Frankfurt): ibmcloud cr region-set eu-de && ibmcloud cr login
# jp-tok (Tokyo):    ibmcloud cr region-set jp-tok  && ibmcloud cr login
```

Create a namespace (one-time setup; must be globally unique):

```bash
# Replace YOUR_NAMESPACE with a name you choose, e.g. "civic-lens-demo"
ibmcloud cr namespace-add YOUR_NAMESPACE
```

> Find your existing namespaces: `ibmcloud cr namespaces`

Tag and push the image:

```bash
# us-south registry domain: us.icr.io
# eu-de:  de.icr.io
# jp-tok: jp.icr.io
docker tag civic-lens us.icr.io/YOUR_NAMESPACE/civic-lens:latest
docker push us.icr.io/YOUR_NAMESPACE/civic-lens:latest
```

---

## Step 4 — Create a Code Engine project

```bash
# Create a new project (one-time setup)
ibmcloud ce project create --name civic-lens

# Select it as the active project
ibmcloud ce project select --name civic-lens
```

> Code Engine free tier supports up to 2 applications. If you already have a project,
> skip the `create` command and run only `select`.

---

## Step 5 — Create the application

Code Engine needs access to your private container image. Create an IAM-based registry
secret first (one-time setup):

```bash
ibmcloud ce registry create \
  --name icr-secret \
  --server us.icr.io \
  --username iamapikey \
  --password "$(ibmcloud iam api-key-create ce-registry-key --output json | python3 -c 'import sys,json; print(json.load(sys.stdin)["apikey"])')"
```

Then create the application:

```bash
ibmcloud ce application create \
  --name civic-lens-api \
  --image us.icr.io/YOUR_NAMESPACE/civic-lens:latest \
  --port 8000 \
  --min-scale 0 \
  --max-scale 2 \
  --registry-secret icr-secret
```

> `--min-scale 0` allows the app to scale to zero when idle, staying within the free tier.
> Code Engine automatically routes external HTTPS to port 8000.

---

## Step 6 — Set environment variables

Set each variable on the running application. Only `FRONTEND_ORIGIN` is required for a
basic deployment; all IBM service variables are optional.

```bash
# --- Required ---
# Replace <APP_URL> with the URL printed after the application is created
# (or retrieved with: ibmcloud ce application get --name civic-lens-api)
ibmcloud ce application update --name civic-lens-api \
  --env FRONTEND_ORIGIN=https://<APP_URL>

# --- Optional: IBM Cloudant cache ---
ibmcloud ce application update --name civic-lens-api \
  --env CLOUDANT_URL=https://<your-instance>.cloudantnosqldb.appdomain.cloud \
  --env CLOUDANT_APIKEY=<your-cloudant-apikey> \
  --env CLOUDANT_DB_NAME=civic-lens

# --- Optional: IBM watsonx.ai match explanations ---
# ENABLE_WATSONX=true sends policy topic averages + public candidate positions to IBM.
# Demographic answers, ZIP, and user identity are never sent.
ibmcloud ce application update --name civic-lens-api \
  --env ENABLE_WATSONX=true \
  --env WATSONX_API_KEY=<your-ibmcloud-apikey> \
  --env WATSONX_SPACE_ID=<your-deployment-space-guid> \
  --env WATSONX_URL=https://us-south.ml.cloud.ibm.com \
  --env WATSONX_MODEL_ID=ibm/granite-4-h-small

# --- Optional: IBM watsonx.ai biography summaries ---
# ENABLE_WATSONX_BIOS=true sends public profile facts only. Independent of ENABLE_WATSONX.
ibmcloud ce application update --name civic-lens-api \
  --env ENABLE_WATSONX_BIOS=true

# --- Optional: Open States live NY state legislator lookup ---
ibmcloud ce application update --name civic-lens-api \
  --env OPEN_STATES_API_KEY=<your-openstates-apikey>
```

> All variables are described with inline guidance in `backend/.env.example`.
> Never commit API keys; always pass them as Code Engine environment variables.

---

## Step 7 — Verify the deployment

```bash
# Get the application URL and status
ibmcloud ce application get --name civic-lens-api
```

Look for the `URL` field in the output, then:

```bash
curl https://<APP_URL>/health
# Expected: {"status":"ok","version":"1.0.0","data_source":"sample"}

curl https://<APP_URL>/api/status
# Shows which IBM services are active
```

Open `https://<APP_URL>/` in a browser — the Civic Lens frontend should load.

---

## Step 8 — Updating the deployment

After making code changes, rebuild and re-push the image, then trigger a revision update:

```bash
# From the repository root
docker build -f backend/Dockerfile -t civic-lens .
docker tag civic-lens us.icr.io/YOUR_NAMESPACE/civic-lens:latest
docker push us.icr.io/YOUR_NAMESPACE/civic-lens:latest

# Force Code Engine to pull the new image
ibmcloud ce application update --name civic-lens-api \
  --image us.icr.io/YOUR_NAMESPACE/civic-lens:latest
```

---

## Notes

**`API_BASE` in `frontend/JS/api.js`**
The frontend is served by the same uvicorn process as the API, so `API_BASE = ""` (the
current default) is correct — all `/api/…` calls are same-origin. No change to `api.js`
is needed for a Code Engine deployment unless the frontend is hosted separately (e.g. on
a CDN), in which case set `API_BASE` to the full Code Engine app URL.

**`FRONTEND_ORIGIN`**
When the frontend and API share the same origin (the default for this deployment), CORS
is not needed for browser fetch calls. Set `FRONTEND_ORIGIN` to the Code Engine app URL
anyway so the CORS middleware allows requests from any preview tooling or local dev
pointing at the live API.

**Scale-to-zero cold starts**
With `--min-scale 0` the first request after an idle period takes a few extra seconds
while Code Engine starts the container. Set `--min-scale 1` to avoid cold starts at the
cost of continuous resource usage.

**Secrets best practice**
Use `ibmcloud ce secret create` for sensitive values and reference them with
`--env-from-secret` instead of passing keys directly on the command line.
