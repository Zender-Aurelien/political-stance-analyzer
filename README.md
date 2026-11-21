# Civic Lens

**An IBM SkillsBuild project** — a civics web application that helps users discover politicians who match their values and beliefs.

Civic Lens lets users enter their ZIP code, take a short values-based quiz, and receive a list of elected officials serving their area along with AI-generated match scores and plain-English explanations of why each politician aligns — or doesn't — with their positions.

> Currently scoped to New York State.

---

## Features

- **ZIP-based politician lookup** — enter any New York ZIP code to see the elected officials representing that area (federal, state, and local)
- **AI-powered stance analysis** — IBM watsonx.ai summarizes each politician's public positions on key policy topics
- **Values quiz** — answer questions about issues that matter to you; questions are generated dynamically based on the politicians in your district
- **Match scoring** — get a percentage match score and a plain-English explanation for each politician
- **Candidate detail panel** — view full profiles including office, district, policy positions, and sources
- **Dark / light mode** — persisted across sessions
- **Recent searches** — your last 5 ZIP searches are saved locally for quick re-access
- **Offline fallback** — if the backend is unavailable, the app falls back to a local static dataset

---

## Tech Stack

### Frontend
| Layer | Technology |
|---|---|
| Markup | Vanilla HTML5 |
| Styles | Vanilla CSS (custom properties, no framework) |
| Scripts | Vanilla JavaScript ES modules |
| Persistence | `localStorage` (no accounts required) |

### Backend
| Layer | Technology |
|---|---|
| Framework | Python + FastAPI |
| Hosting | IBM Code Engine (containerized) |
| Database | IBM Cloudant (NoSQL) |
| AI | IBM watsonx.ai (`ibm/granite-13b-instruct-v2`) |
| Politician data | Google Civic Information API |

---

## Project Structure

```
civic-lens/
├── index.html                # Home page — search, candidate cards, quiz, detail panel
├── about.html                # About page — mission, data sources, privacy notice
│
├── JS/                       # Frontend JavaScript modules
│   ├── main.js               # Entry point — bootstraps all modules
│   ├── api.js                # Data-access layer (calls backend, falls back to local JSON)
│   ├── candidates.js         # Candidate card rendering & carousel
│   ├── detail.js             # Candidate detail modal
│   ├── quiz.js               # Quiz rendering, answer collection, match display
│   ├── search.js             # ZIP/name search logic
│   ├── nav.js                # NAV dropdown, recent searches
│   ├── storage.js            # localStorage helpers
│   ├── theme.js              # Dark/light mode toggle
│   └── slideshow.js          # Hero image slideshow
│
├── Styles.css/               # Stylesheets
│   ├── variables.css         # CSS custom properties (colors, spacing, typography)
│   ├── base.css              # Global body, typography, links
│   ├── nav.css               # Navigation bar styles
│   ├── hero.css              # Hero banner styles
│   ├── candidates.css        # Candidate card grid
│   ├── detail.css            # Candidate detail panel
│   ├── quiz.css              # Quiz section styles
│   ├── search.css            # Search bar styles
│   ├── about.css             # About page styles
│   ├── themes.css            # Light-mode overrides
│   └── reset.css             # Browser normalization
│
├── data/
│   └── candidates.json       # Static fallback candidate data (6 NY politicians)
│
├── assets/
│   └── images/               # Candidate headshots
│
├── backend/                  # Python FastAPI backend
│   ├── main.py               # App entry point, CORS, health check
│   ├── requirements.txt      # Python dependencies
│   ├── Dockerfile            # Container image for IBM Code Engine
│   ├── .env.example          # Required environment variable template
│   ├── routers/
│   │   ├── candidates.py     # GET /api/candidates?zip=
│   │   ├── quiz.py           # GET /api/quiz?zip=
│   │   └── match.py          # POST /api/match
│   ├── services/
│   │   ├── civic.py          # Google Civic Information API client
│   │   ├── watsonx.py        # IBM watsonx.ai client
│   │   └── cloudant.py       # IBM Cloudant read/write helpers
│   └── models/
│       ├── candidate.py      # Pydantic models for candidate/stance data
│       └── quiz.py           # Pydantic models for quiz questions and match results
│
├── civic-lens-plan.md        # Frontend build plan
└── backend-plan.md           # Backend build plan
```

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Health check — returns `{"status":"ok"}` |
| `GET` | `/api/candidates?zip={zip}` | Returns enriched politician list for a ZIP code |
| `GET` | `/api/quiz?zip={zip}` | Returns AI-generated quiz questions for a district |
| `POST` | `/api/match` | Scores user answers against candidates, returns match % + explanation |

---

## Local Development Setup

### Prerequisites
- Python 3.11+
- A modern browser (no build step needed for the frontend)

### Backend

```bash
cd backend

# Create and activate a virtual environment
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS/Linux

# Install dependencies
pip install -r requirements.txt

# Configure environment variables
copy .env.example .env        # Windows
# cp .env.example .env        # macOS/Linux
# Edit .env and fill in your API keys (see Environment Variables below)

# Start the development server
uvicorn main:app --reload
# Server runs at http://localhost:8000
# Health check: http://localhost:8000/health
```

### Frontend

Open `index.html` directly in a browser, or serve it with any static file server:

```bash
# Using Python's built-in server from the repo root
python -m http.server 5500
# Then open http://localhost:5500
```

---

## Environment Variables

Copy `backend/.env.example` to `backend/.env` and fill in the values below. **Never commit `.env` to version control.**

| Variable | Description | Where to get it |
|---|---|---|
| `GOOGLE_CIVIC_API_KEY` | Google Civic Information API key | [Google Cloud Console](https://console.cloud.google.com/apis/credentials) — enable the Civic Information API |
| `WATSONX_API_KEY` | IBM Cloud API key | [IBM Cloud IAM](https://cloud.ibm.com/iam/apikeys) |
| `WATSONX_PROJECT_ID` | watsonx.ai project ID | Project → Manage tab → General → Details |
| `WATSONX_URL` | watsonx.ai regional endpoint | `https://us-south.ml.cloud.ibm.com` (Dallas) or your region |
| `WATSONX_MODEL_ID` | Foundation model ID | Default: `ibm/granite-13b-instruct-v2` |
| `CLOUDANT_URL` | Cloudant external endpoint URL | IBM Cloud resource list → your Cloudant instance → Manage tab |
| `CLOUDANT_APIKEY` | Cloudant API key | Cloudant instance → Service credentials tab |
| `CLOUDANT_DB_NAME` | Cloudant database name | Choose a name, e.g. `civic-lens` (created automatically) |
| `FRONTEND_ORIGIN` | Allowed CORS origin | `http://localhost:5500` for local dev; your deployed URL for production |

---

## Architecture

```
Browser (index.html + JS modules)
        │
        ▼
   JS/api.js  ── primary ──▶  FastAPI backend (IBM Code Engine)
        │                              │
        └── fallback ──▶               ├── Google Civic Information API
   data/candidates.json                ├── IBM watsonx.ai
                                       └── IBM Cloudant
```

**Request flow:**
1. User enters ZIP → `api.js` calls `GET /api/candidates?zip=…`
2. Backend queries Google Civic API for elected officials in that ZIP
3. Backend checks Cloudant for cached stances; on cache miss, calls watsonx.ai to summarize positions from public records, then stores the result
4. Enriched candidate records returned to the frontend
5. Frontend calls `GET /api/quiz?zip=…` → backend generates district-relevant quiz questions via watsonx.ai
6. User submits answers → `POST /api/match` → backend computes match % and generates a plain-English explanation per politician

---

## Team

Built by a team of 5 for the IBM SkillsBuild competition.
