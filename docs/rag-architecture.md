# Civic Lens evidence retrieval and maintenance

## Start with evidence and validation

This milestone implements versioned public excerpts, retrieval by person/source version, summary citations, runtime checks and a read-only trace API. It does not implement semantic search, autonomous agents or unattended long-term maintenance. The application runs locally; the frontend layout is unchanged.

RAG supplies retrieved material to a model instead of relying only on model memory. Freshness, faithfulness to a source, and factual truth are separate concerns. A faithful quotation can still be stale or describe the wrong person. [IBM RAG overview](https://www.ibm.com/think/topics/retrieval-augmented-generation), [IBM evaluation metrics](https://www.ibm.com/docs/en/watsonx/saas?topic=models-evaluation-metrics)

## Structure

```text
Official pages / Open States
              |
      restricted retrieval                    EXISTING
              |
      versioned excerpt snapshots              IMPLEMENTED
              |
      person + source-version retrieval        IMPLEMENTED
              |
      optional watsonx sentence selection       LIVE ACCESS STILL BLOCKED
              |
      runtime evidence checks                   IMPLEMENTED
              |
      accepted summary OR supported fallback
              |
      citations + generation run record         IMPLEMENTED
              |
      profile API + read-only trace API         IMPLEMENTED

Separate: reviewed sample policy data -> deterministic comparison -> explanation

Later: source registry -> scheduled refresh -> change detection -> review queue
                              |
                        monitoring and alerts
```

For this small corpus, exact person/source-version retrieval is enough: a profile already has a known subject. A larger assistant answering questions across documents may need lexical or semantic search with identity, office-period, authority and date filters. An embedding score would measure similarity, not credibility.

## Files and responsibilities

| File | Responsibility |
|---|---|
| `backend/models/evidence.py` | Typed citations and generation records |
| `backend/services/source_policy.py` | Government-source allowlist |
| `backend/services/evidence.py` | Excerpt versions, retrieval, checking and history |
| `backend/services/profiles.py` | Retrieval, model and cache coordination |
| `backend/services/watsonx.py` | Optional IBM calls and output boundaries |
| `backend/routers/candidates.py` | Profile and public trace endpoints |
| `backend/services/cloudant.py` | Public reference store; SQLite locally |
| `backend/tests/test_evidence.py` | Source/version, corruption and generation cases |
| `backend/tests/conftest.py` | Isolated test cache and disabled live integrations |
| `scripts/check.py` | One offline verification command and JSON report |
| `.github/workflows/check.yml` | CI checks for push, PR and manual dispatch |

## What is traceable

An excerpt snapshot binds the candidate ID, URL, source type and ordered excerpts into a content-addressed identifier. Re-ingesting the same version reuses it; changed text creates another version and earlier versions remain available. Its content hash covers the indexed excerpts, not the whole remote page. This is a bounded excerpt record, not a complete web archive or signed attestation.

A citation includes `sourceId`, `chunkId`, `candidateId`, `url`, `kind`, `excerpt`, `excerptHash`, `contentHash` and `capturedAt`. Capture time is the first local capture, not the publisher's publication date. Open States person links are retained when available; otherwise the public portal is cited for the normalized office record. Office information is not labeled career history.

A generation record includes run ID, time, model ID when attempted, prompt version, outcome, model-output checks, final-publication checks, selected citations, accepted text and duration. Raw model output, credentials, ZIP searches, demographics and quiz answers are not stored in the public history.

```text
GET /api/candidates/{candidate_id}/profile/runs/{run_id}
```

The endpoint returns only a run bound to that candidate. Its checks describe generation time. Cached automated summaries additionally revalidate their source excerpts and accepted text before being served. These details are available in the API; a new on-screen source inspector remains future UI work.

Human-reviewed summaries retain their source and review date. Sample biographies remain sample data. This does not retroactively verify the entire bundled dataset.

## Tests on every run

1. **Every summary attempt:** check allowed source, candidate binding, stored excerpt hashes, exact output support and word limit. Accept one or two retrieved excerpts. Preserve rejected-model checks separately from the accepted fallback checks. Cached summaries are rechecked before reuse.
2. **Every code verification/build:** run backend, frontend and evidence regression tests. The GitHub Actions workflow uses no live-service secrets and runs on push, PR and manual dispatch.

From the repository root:

```bash
backend/.venv/bin/python scripts/check.py
```

On Windows, use the installed virtual environment's Python path. The script uses portable subprocess argument lists and UTF-8 output. It writes `backend/.cache/verification.json` and fails if any check or required tool fails. The cache/report is ignored by Git.

Cases cover version changes, repeated ingestion, history, wrong-subject retrieval, altered excerpts, untrusted sources, obvious injected page instructions, unsupported/malformed output, valid selections, fallback audit records, cache revalidation and trace API access. The instruction-pattern filter is not a comprehensive prompt-injection detector. The model cannot execute tools or publish changes.

The separate opt-in AI match explanation must quote sentences from its deterministic computed comparison. The response includes `explanation_basis` and `explanation_checks`; private comparisons never enter the public evidence store. This does not validate the sample stances used in scoring.

These are extractive support checks, not a calibrated semantic faithfulness metric. Human evaluation still needs to assess relevance, identity, office period, truth and omissions. Live IBM generation remains blocked by project access; mocked test success must not be presented as a successful live integration.

## Evaluation of the current website

| Area | Current assessment | Start with |
|---|---|---|
| Traceability | Versioned excerpts and run records now exist locally | Inspect a passing run, a rejection, a cache hit and preserved history |
| Identity and freshness | Candidate binding relies on the supplied registry; live provider IDs exist | Persist stable provider IDs, office periods, URLs, retrieval dates and source owners; names/slugs alone are insufficient |
| IBM integration | Bounded adapters and source fallbacks; no live-verified generation | Correct project access, then measure a real generation and failure |
| Comparison validity | Reproducible arithmetic, but sample policy stances and a four-point ZIP bonus | Review stance evidence, topic coverage and whether location should influence agreement |
| Product wording | Some About-page wording suggests documented positions and exact district representation | Align wording with sample positions and approximate ZIP lookup before a public pilot; not edited here |
| Privacy and security | Server-side keys, bounded government fetches, safe text rendering | Keep logs free of private answers/ZIPs; add operational rate and cost limits before hosting |
| Performance | Small corpus and direct-key reads are sufficient for the pilot | Measure cached/uncached latency; collapse duplicate refreshes and bound upstream concurrency |
| Durability | Local cache persists; Cloudant adapter exists; public hosting is unverified | Define backups, retention, restore tests and an operational owner |
| Usability | Device themes and accessibility tests exist | Run real keyboard/mobile and task-comprehension sessions |

## Order of work

1. Review this local provenance/checking milestone and the test report. Publish only with permission.
2. Fix IBM project ID/region/access. Compare model selections with rule-based excerpts on relevance, support, latency and actual usage cost.
3. Add a persistent source registry: stable person ID, office period, URL, owner, source type, interval and last successful retrieval. Human approval is required before extracted policy positions enter scoring.
4. Add a scheduled refresh worker for known public IDs, not saved user ZIP searches. Use bounded retries/backoff and provider budgets; check changed evidence before replacing displayed records.
5. Monitor source failures, model errors, stale records, coverage and cost. Set maximum ages separately for current-office information and historical career facts.
6. Improve comparison validity and understanding: review sample labels, the location bonus and missing-topic coverage; test what users think a percentage means.
7. Choose durable hosting/storage and demonstrate backup restore. Code Engine and Cloudant are options, not verified deployments. Set retention and storage budgets for evidence history.
8. Add broad semantic RAG or a read-only research agent only when evaluation shows that the simpler retrieval flow is insufficient.

Registry, worker, alerts, retention, public deployment, semantic search and successful live IBM generation are not implemented here. RAG does not continuously train the model or keep a website running indefinitely. Years of operation require maintenance, provider access, monitoring and recovery.

## Evidence for the supplied 20-point rubric

- **Completeness and feasibility:** a real supported summary, inspectable trace, graceful failure and recovery demonstration.
- **Creativity and innovation:** prove that evidence inspection improves a specific task compared with existing civic-information tools; do not claim the political quiz itself is unique.
- **Design and usability:** task success, source-finding time, understanding of missing evidence, keyboard/mobile access.
- **Effectiveness and efficiency:** support review with denominators, useful information coverage, cached/uncached latency, cost per successful supported summary and measured comprehension or time saved.

Use a reviewed evaluation set across parties/offices plus stale, blocked, wrong-person, malformed-output and injection cases. Report actual counts. Targets and projections must be labeled; no new model-quality or impact score has been measured in this milestone.
