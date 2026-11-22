# Civic Lens

**Civic Lens** is a nonpartisan civic technology tool built for the [IBM SkillsBuild](https://skillsbuild.org) competition. It lets New Yorkers explore candidate profiles, take a values-based policy quiz, and see how closely their answers align with elected officials and candidates running in their district.

**Live demo:** https://civic-lens-latest.onrender.com

## Team

Built by:

- **Zender Aurelien-Nikolai**
- **Kerisa Williams**
- **LaMont Walker**
- **Ulyana Shyroka**
- **David Pareja**

## Run locally (Windows)

From the repository root:

```powershell
python -m venv backend/.venv
backend/.venv/Scripts/activate
python -m pip install -r backend/requirements.txt
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Open **http://127.0.0.1:8000**. The banner should say **Backend connected**. Both the frontend and API run on this one server. Do not open `index.html` directly — browser modules and data requests require an HTTP server.

## Run locally (Mac)

Double-click **Start Civic Lens.command** in this folder. Leave its Terminal window open. The website opens at **http://127.0.0.1:8000**. Press Control+C in that window to stop it. Python 3.12+ is required. The launcher finds a compatible installed Python automatically, rebuilds an older local virtual environment if needed (keeping a backup under `backend/.cache/`), and installs or refreshes the declared backend dependencies. It does not install Python itself.

Or from the terminal at the repository root:

```bash
python3.12 -m venv backend/.venv
source backend/.venv/bin/activate
python -m pip install -r backend/requirements.txt
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Live New York state legislator lookup is available for ZIP searches when `OPEN_STATES_API_KEY` is set in `backend/.env`. Results identify live office records separately from bundled sample profiles. Quiz matching continues to use sample policy positions; live officials without verified positions are not assigned invented match scores.

## What works

- Light/dark mode toggle in the navigation bar; preference is saved across sessions.
- Name search and approximate New York ZIP filtering across 17 sample profiles.
- A 22-question quiz: 7 optional context questions and 15 required policy questions.
- Server-side scoring across shared policy topics, ranked results, explanations, and candidate-card badges.
- Back/next navigation, saved progress, saved results, retakes, and accessible progress/error feedback.
- Static preview fallback if the backend is unavailable, with an explicit offline message.
- Public quiz-reference cache persisted in local SQLite; optional Cloudant adapter.
- Optional IBM watsonx.ai explanations with deterministic fallback. The LLM never calculates match percentages.
- Source refresh when a profile opens: short official biography excerpts and recent sponsored/co-sponsored New York bills, with individual links and checked dates.

## Profile sources and refresh

Opening **View Details** requests `/api/candidates/{id}/profile`. The server fetches supported official biography pages and current-session Open States sponsorship records concurrently. Public results are cached locally for six hours (partial results for ten minutes); an unavailable refresh keeps the previous dated evidence. Only public reference information is cached, not quiz answers or ZIP searches.

Each bill is labeled **Primary sponsor** or **Co-sponsor**. Sponsorship is not described as a vote, an ideological score, or a complete policy position. These records do not change the sample-data quiz scores. Government biography excerpts are short and link to the full page. Some government sites block automated readers: a reviewed fallback, when available, is explicitly labeled with its review date.

```text
backend/services/profiles.py       Official biography and legislative evidence refresh
backend/tests/test_profiles.py     Sources, sponsorship, cache, and outage checks
data/reviewed-backgrounds.json     Dated, attributed background fallbacks
tests/detail-sync.test.js          Loading, safe text, and profile-switch checks
```

### Optional watsonx biographies

Set `ENABLE_WATSONX_BIOS=true` and the four `WATSONX_*` settings to enable public profile summaries independently of quiz explanations. Keep `ENABLE_WATSONX=false` if quiz comparisons should stay local to the existing deterministic service. Only supplied public facts are sent for biography selection; quiz answers, ZIP searches, user identities, and sample policy stances are excluded.

The adapter uses IBM's [chat API](https://www.ibm.com/docs/en/watsonx/saas?topic=code-chat). It requests one or two source sentence indexes in JSON and assembles the displayed text from the original sentences. Model-written claims, invalid indexes, and malformed results are rejected. A configured model is required; available models vary by project and region.

When a live legislator's biography is blocked, the profile shows **Public office background**, based on the Open States name, office, district, and party record. AI-assisted summaries are labeled; an IBM outage falls back to the same source-backed text.

## Appearance / theme toggle

The site defaults to **light mode**. A sun/moon button in the navigation bar lets the user switch to dark mode and back. The preference is saved in `localStorage` under `civic-lens-theme` and restored on every page load without a flash.

`JS/theme.js` is a small blocking head script on both pages. It reads `localStorage` and sets the root `data-theme` before styles load so DaisyUI controls inherit the correct mode without a mismatched initial frame. The toggle calls `window.__civicToggleTheme()`, which updates `data-theme`, persists the choice, and refreshes the button icon and label on the page.

```text
JS/
  theme.js                 Theme initialisation and toggle handler
Styles.css/
  variables.css            Shared light/dark color palettes
  themes.css               Theme colors for all page components
```

Keep theme decisions on the document root. Do not add fixed `data-theme="dark"` attributes to individual cards, dialogs, or controls. Use the shared color variables for new components. Hero photos retain dark overlays and white text in both modes for readability.

## Data and production limits

This is a **demo**, not a verified election guide. Quiz positions and sample ZIP coverage come from `data/candidates.json`. With Open States configured, ZIP searches also return current New York state office records. ZIP codes can cross districts. Sourced background and legislative activity are identified separately from sample policy positions; neither establishes an election candidate lineup.

The original plan used Google's Representatives API, which was [retired April 30, 2025](https://groups.google.com/g/google-civicinfo-api/c/lR8kT7Uc0sE). That endpoint is not called. Open States now supplies the optional state-level lookup; complete, verified policy-position records remain separate work.

IBM services are optional and disabled by default. To configure them, copy `backend/.env.example` to `backend/.env`. Never commit credentials. Pick a watsonx text-generation model available in your own project and region.

## Scoring and privacy

Each policy answer maps to −2…+2, including reversed questions. Answers are averaged per topic. The backend calculates `round(100 − mean absolute difference × 25)` across topics with known candidate stances. Sample ZIP coverage adds 4 points, capped at 100. Missing shared policy data produces no score, rather than an invented neutral match.

Quiz answers and results are saved in browser `localStorage`. Only policy topic averages, candidate IDs, and an optional ZIP reach the backend; they are not persisted there. Demographic context stays in the browser. If an operator explicitly enables watsonx, policy scores and public candidate positions are sent to IBM for explanations. The public reference cache contains no user answers.

## API

Interactive API documentation: https://civic-lens-latest.onrender.com/docs

| Method | Route | Behavior |
|---|---|---|
| GET | `/health` | Server health |
| GET | `/api/status` | Demo source and integration configuration |
| GET | `/api/candidates` | All sample profiles |
| GET | `/api/candidates?zip=10027` | Optional live state office records plus sample ZIP matches |
| GET | `/api/candidates/{id}/profile` | Dated background and legislative evidence |
| GET | `/api/candidates/{id}/profile/runs/{run_id}` | Public summary citations, source versions, and per-run validation results |
| GET | `/api/quiz` | Reviewed quiz questions shared with the frontend |
| POST | `/api/match` | Ranked scores and explanations |

Example match request:

```json
{
  "answers": { "housing": 1.5, "healthcare": 0, "climate": 2 },
  "candidate_ids": ["zohran-mamdani", "mike-lawler"],
  "zip": "10027"
}
```

Unknown topics, invalid scores, duplicate candidate IDs, and malformed ZIPs return 422. Unknown candidates return 404. Non-New York ZIP searches return an empty list; non-New York ZIPs on match requests return 422. No matching user responses are logged or stored.

## Verification

```bash
backend/.venv/bin/python -m pip install -r backend/requirements-dev.txt
backend/.venv/bin/python -m pytest backend/tests -q
npm ci
npm test
```

Node 22.13+ is needed only for frontend tests; the website itself has no build step. The existing design uses third-party CSS/fonts from CDNs, so an internet connection gives the full styling.

## Deployment

The app is deployed on [Render](https://render.com) at **https://civic-lens-latest.onrender.com**. To push an update:

```powershell
docker build -f backend/Dockerfile -t civic-lens .
docker tag civic-lens zendera/civic-lens:latest
docker push zendera/civic-lens:latest
```

Then go to the Render dashboard → **civic-lens** service → **Manual Deploy → Deploy latest image**.

See [`backend/deploy.md`](backend/deploy.md) for the full deployment guide and [`backend/README.md`](backend/README.md) for operator details.
