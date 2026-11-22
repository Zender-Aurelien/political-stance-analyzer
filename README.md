# Civic Lens

An IBM SkillsBuild project: explore sample New York profiles, answer policy questions, and compare values matches.

## Run the complete demo on your Mac

Live New York state legislator lookup is available for ZIP searches when `OPEN_STATES_API_KEY` is set in the private `backend/.env` file. Only this key is needed for Open States; IBM services remain optional. The lookup uses a representative ZIP location, so it cannot identify every district crossed by a ZIP. Results identify live office records separately from bundled sample profiles. Quiz matching continues to use the sample policy positions; live officials without verified positions are not assigned invented match scores.

Double-click **Start Civic Lens.command** in this folder. Leave its Terminal window open. The website opens at **http://127.0.0.1:8000**. Press Control+C in that window to stop it. Python 3.12+ is required. The launcher finds a compatible installed Python automatically, rebuilds an older local virtual environment if needed (keeping a backup under `backend/.cache/`), and installs or refreshes the declared backend dependencies. It does not install Python itself.

Or use IBM Bob's terminal from the repository root:

```bash
python3.12 -m venv backend/.venv
source backend/.venv/bin/activate
python -m pip install -r backend/requirements.txt
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000. The banner should say **Backend connected**. Both the frontend and API run on this one server. Do not open index.html directly: browser modules and data requests require an HTTP server.

## What works

- Automatic light/dark appearance follows the device, including live changes, with no theme switch.
- Name search and approximate New York ZIP filtering across 17 sample profiles.
- A 22-question quiz: 7 optional context questions and 15 required policy questions.
- Server-side scoring across shared policy topics, ranked results, explanations, and candidate-card badges.
- Back/next navigation, saved progress, saved results, retakes, and accessible progress/error feedback.
- Static preview fallback if the backend is unavailable, with an explicit offline message.
- Public quiz-reference cache persisted in local SQLite; optional Cloudant adapter.
- Optional IBM watsonx.ai explanations with deterministic explanations on failure. The LLM never calculates match percentages.
- Source refresh when a profile opens: short official biography excerpts and recent sponsored/co-sponsored New York bills, with individual links and checked dates.

## Profile sources and refresh

Opening **View Details** requests `/api/candidates/{id}/profile`. The server fetches supported official biography pages and current-session Open States sponsorship records concurrently. Public results are cached locally for six hours (partial results for ten minutes); an unavailable refresh keeps the previous dated evidence. Only public reference information is cached, not quiz answers or ZIP searches.

Each bill is labeled **Primary sponsor** or **Co-sponsor**. Sponsorship is not described as a vote, an ideological score, or a complete policy position. These records do not change the sample-data quiz scores. Government biography excerpts are short and link to the full page. Some government sites block automated readers: a reviewed fallback, when available, is explicitly labeled with its review date. The included Steve Chan summary was checked against his official biography on November 22, 2026; it is not represented as a freshly downloaded biography.

```text
backend/services/profiles.py       Official biography and legislative evidence refresh
backend/tests/test_profiles.py     Sources, sponsorship, cache, and outage checks
data/reviewed-backgrounds.json     Dated, attributed background fallbacks
tests/detail-sync.test.js          Loading, safe text, and profile-switch checks
```

## Automatic appearance

The site follows the operating system/browser preference using `prefers-color-scheme`. Light is the fallback when no preference can be detected. The existing dark design is used when the device requests dark mode. Changes apply while the page is open, without a reload or resetting search/quiz progress. There is no theme button or persisted override; legacy stored theme values are ignored.

`JS/theme.js` is a small blocking head script on both pages. It sets the root `data-theme` before styles load so DaisyUI controls inherit the same mode without a mismatched initial frame. It listens for system changes, including the older Safari listener API. Native controls and scrollbars follow CSS `color-scheme`; a CSS media-query fallback supplies the correct palette if JavaScript is unavailable.

```text
JS/
  theme.js                 Device preference detection and live updates
Styles.css/
  variables.css            Shared light/dark color palettes and CSS fallback
  themes.css               Theme colors for all page components
tests/
  theme.test.js            Initial preference, live changes, fallback, and page wiring
```

Keep theme decisions on the document root. Do not add fixed `data-theme="dark"` attributes to individual cards, dialogs, or controls. Use the shared color variables for new components. Hero photos retain dark overlays and white text in both modes for readability.

## Data and production limits

This is a **local working demo**, not a verified election guide. Quiz positions and sample ZIP coverage come from `data/candidates.json`. With Open States configured, ZIP searches also return current New York state office records. ZIP codes can cross districts. Sourced background and legislative activity are identified separately from sample policy positions; neither establishes an election candidate lineup.

The original plan used Google's Representatives API, which was [retired April 30, 2025](https://groups.google.com/g/google-civicinfo-api/c/lR8kT7Uc0sE). That endpoint is not called. Open States now supplies the optional state-level lookup; complete, verified policy-position records remain separate work.

IBM services are optional and disabled/unconfigured by default. To configure them, copy `backend/.env.example` to `backend/.env`. Never commit credentials. Pick a watsonx text-generation model available in your own project and region. Cloud adapters have mocked failure tests; live IBM credentials and deployment have not been verified.

## Scoring and privacy

Each policy answer maps to −2…+2, including reversed questions. Answers are averaged per topic. The backend calculates `round(100 − mean absolute difference × 25)` across topics with known candidate stances. Sample ZIP coverage adds 4 points, capped at 100. Missing shared policy data produces no score, rather than an invented neutral match.

Quiz answers and results are saved in browser localStorage. Only policy topic averages, candidate IDs, and an optional ZIP reach the backend; they are not persisted there. Demographic context stays in the browser. If an operator explicitly enables watsonx, policy scores and public candidate positions are sent to IBM for explanations. The public reference cache contains no user answers.

## API

Interactive API documentation: http://127.0.0.1:8000/docs

| Method | Route | Behavior |
|---|---|---|
| GET | `/health` | Server health |
| GET | `/api/status` | Demo source and integration configuration |
| GET | `/api/candidates` | All sample profiles |
| GET | `/api/candidates?zip=10027` | Optional live state office records plus sample ZIP matches |
| GET | `/api/candidates/{id}/profile` | Dated background and legislative evidence; a ZIP query can resolve a live profile after restart |
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

For a separate verification copy, the launcher accepts `CIVIC_LENS_PORT` (default `8000`) and `CIVIC_LENS_NO_BROWSER=1` (skip opening a browser). These settings do not change the normal double-click workflow.

## Container preparation

```bash
docker build -f backend/Dockerfile -t civic-lens .
docker run --rm -p 127.0.0.1:8000:8000 civic-lens
```

The container serves the same demo and excludes credentials. Docker/IBM Cloud deployment is not part of the verified local setup. See `backend/README.md` for operator details.
