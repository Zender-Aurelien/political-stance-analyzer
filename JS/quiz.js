/**
 * quiz.js — Civic Lens values-matching quiz
 *
 * Architecture:
 *  - 15 policy questions (5-point Likert scale)
 *  - 7 optional context questions; demographic answers stay on-device
 *  - Scoring: each policy answer maps to a stance spectrum (-2 … +2)
 *    Candidate stances are pre-mapped to the same scale.
 *    Match % = 100 − (mean absolute deviation across shared topics) × 25
 *  - Location boost: if the sample profile includes the user's ZIP, +4 raw points
 *    (never more than ~5% of a 100-point score, keeping values primary)
 *  - Age context: shown in results copy only — no score effect
 *  - Results saved to localStorage under cl_quiz_result and cl_quiz_answers
 */

import { get, set, remove } from "./storage.js";
import { scrollBehavior } from "../accessibility/motion.js";
import { getCandidates, getQuizQuestions, submitQuizAnswers, isNewYorkZip } from "./api.js";
import { scoreCandidate } from "./matching.js";
import { createMatchDetails } from "./match-details.js";

// ─── Storage keys ────────────────────────────────────────────────────────────
const KEY_ANSWERS = "cl_quiz_answers";
const KEY_RESULT  = "cl_quiz_result";
const KEY_PROGRESS = "cl_quiz_progress";

// ─── Quiz questions ───────────────────────────────────────────────────────────
// Each question maps to a candidate topic key.
// Options are ordered strongly-agree → strongly-disagree and labelled neutrally.
// The `score` array maps option index (0-4) to the -2…+2 spectrum for that topic.
let QUESTIONS = [];

// Likert labels — same for every scale question
const LIKERT_OPTIONS = [
  { label: "Strongly agree",   value: 2  },
  { label: "Agree",            value: 1  },
  { label: "Neutral / unsure", value: 0  },
  { label: "Disagree",         value: -1 },
  { label: "Strongly disagree",value: -2 },
];

// ─── Scoring ─────────────────────────────────────────────────────────────────

/**
 * Build a topic → userScore map from saved answers.
 * Only likert questions with a topic contribute.
 */
function buildUserScores(answers) {
  const topicSums   = {};
  const topicCounts = {};

  for (const q of QUESTIONS) {
    if (q.type !== "likert" || !q.topic) continue;
    const raw = answers[q.id];
    if (raw === undefined || raw === null) continue;

    // raw is the option index (0-4); map through q.score
    const numericScore = q.score[Number(raw)];
    if (numericScore === undefined) continue;

    topicSums[q.topic]   = (topicSums[q.topic]   || 0) + numericScore;
    topicCounts[q.topic] = (topicCounts[q.topic] || 0) + 1;
  }

  // Average per topic so multi-question topics stay on -2…+2
  const scores = {};
  for (const topic of Object.keys(topicSums)) {
    scores[topic] = topicSums[topic] / topicCounts[topic];
  }
  return scores;
}

// ─── State machine ────────────────────────────────────────────────────────────

let state = {
  step:    0,          // current question index
  answers: {},         // { questionId: answerValue }
  started: false,
  finished: false,
};
let resultRequest = 0;

// Only restore answers that still match the current questionnaire.
function readAnswers(value) {
  const answers = {};
  for (const q of QUESTIONS) {
    const answer = value?.[q.id];
    if (q.type === "text" && typeof answer === "string" && isNewYorkZip(answer)) {
      answers[q.id] = answer;
    } else if (q.type === "likert" && /^[0-4]$/.test(String(answer))) {
      answers[q.id] = String(answer);
    } else if (q.type === "choice" && q.options.some(opt => opt.value === answer)) {
      answers[q.id] = answer;
    } else if (q.type === "multicheck" && Array.isArray(answer)) {
      answers[q.id] = q.options.filter(opt => answer.includes(opt.value)).map(opt => opt.value);
    }
  }
  return answers;
}

function saveProgress() {
  set(KEY_PROGRESS, { step: state.step, answers: state.answers });
}

// ─── DOM helpers ──────────────────────────────────────────────────────────────

function getContainer()   { return document.querySelector("#quiz-container"); }
function getStepEl()      { return document.querySelector("#quiz-step"); }
function getProgressBar() { return document.querySelector("#quiz-progress-bar"); }
function getProgressText(){ return document.querySelector("#quiz-progress-text"); }

// ─── Render helpers ───────────────────────────────────────────────────────────

function renderProgress() {
  const policyQs = QUESTIONS.filter(q => q.type === "likert");
  const answered  = policyQs.filter(q => state.answers[q.id] !== undefined).length;
  const pct       = Math.round((answered / policyQs.length) * 100);

  const bar  = getProgressBar();
  const text = getProgressText();
  if (bar)  bar.style.width  = `${pct}%`;
  bar?.parentElement.setAttribute("aria-valuenow", String(pct));
  if (text) text.textContent = `${answered} of ${policyQs.length} policy questions answered`;
}

function renderQuestion(index) {
  const q   = QUESTIONS[index];
  const el  = getStepEl();
  if (!el || !q) return;

  // Section header (shown when section changes)
  const prevSection = index > 0 ? QUESTIONS[index - 1].section : null;
  const showSection = q.section !== prevSection;

  let html = "";

  if (showSection) {
    html += `<p class="quiz-section-label" aria-label="Section: ${q.section}">${q.section}</p>`;
  }

  html += `
    <div class="quiz-question" data-qid="${q.id}">
      <h3 class="quiz-prompt" tabindex="-1">${q.prompt}</h3>
      ${q.helpText ? `<p class="quiz-help">${q.helpText}</p>` : ""}
  `;

  if (q.type === "likert") {
    html += `<div class="quiz-likert" role="radiogroup" aria-label="${q.prompt}">`;
    LIKERT_OPTIONS.forEach((opt, i) => {
      const saved    = state.answers[q.id];
      const checked  = saved !== undefined && Number(saved) === i ? " checked" : "";
      const selectedClass = checked ? " selected" : "";
      html += `
        <label class="likert-option${selectedClass}">
          <input type="radio" name="${q.id}" value="${i}"${checked} />
          <span class="likert-label">${opt.label}</span>
        </label>`;
    });
    html += `</div>`;
  } else if (q.type === "choice") {
    html += `<div class="quiz-choices" role="radiogroup" aria-label="${q.prompt}">`;
    q.options.forEach((opt) => {
      const saved   = state.answers[q.id];
      const checked = saved === opt.value ? " checked" : "";
      const selectedClass = checked ? " selected" : "";
      html += `
        <label class="choice-option${selectedClass}">
          <input type="radio" name="${q.id}" value="${opt.value}"${checked} />
          <span>${opt.label}</span>
        </label>`;
    });
    html += `</div>`;
  } else if (q.type === "multicheck") {
    const saved = Array.isArray(state.answers[q.id]) ? state.answers[q.id] : [];
    html += `<div class="quiz-multichecks" role="group" aria-label="${q.prompt}">`;
    q.options.forEach((opt) => {
      const checked      = saved.includes(opt.value);
      const selectedClass = checked ? " selected" : "";
      html += `
        <label class="check-option${selectedClass}">
          <input type="checkbox" name="${q.id}" value="${opt.value}"${checked ? " checked" : ""} />
          <span>${opt.label}</span>
        </label>`;
    });
    html += `</div>`;
  } else if (q.type === "text") {
    html += `
      <div class="quiz-text-input">
        <input
          type="text"
          id="${q.id}_input"
          name="${q.id}"
          placeholder="${q.placeholder || ""}"
          maxlength="5"
          pattern="[0-9]{5}"
          aria-label="${q.prompt}"
          autocomplete="postal-code"
          inputmode="numeric"
          aria-describedby="quiz-error"
        />
        <p class="quiz-text-hint">5-digit ZIP only. ${q.optional ? "Optional — press Next to skip." : ""}</p>
      </div>`;
  }

  html += `</div>`;
  html += `<p id="quiz-error" class="quiz-error" role="alert" hidden></p>`;

  html += `
    <div class="quiz-nav">
      ${index > 0 ? `<button type="button" class="btn quiz-back-btn" id="quiz-back">← Back</button>` : "<span></span>"}
      <button type="button" class="btn quiz-next-btn" id="quiz-next">
        ${index === QUESTIONS.length - 1 ? "See My Results →" : "Next →"}
      </button>
    </div>`;

  el.innerHTML = html;

  // Wire events on the freshly-rendered content
  el.querySelectorAll(`input[name="${q.id}"]`).forEach(input => {
    input.addEventListener("change", () => handleAnswer(q, input));
  });

  if (q.type === "text") {
    const textInput = el.querySelector(`#${q.id}_input`);
    textInput.value = state.answers[q.id] || "";
    textInput?.addEventListener("input", () => {
      state.answers[q.id] = textInput.value.trim();
      saveProgress();
      el.querySelector("#quiz-error").hidden = true;
      textInput.removeAttribute("aria-invalid");
    });
  }

  el.querySelector("#quiz-next")?.addEventListener("click", () => advanceStep());
  el.querySelector("#quiz-back")?.addEventListener("click", () => goBack());

  renderProgress();
  el.querySelector(".quiz-prompt")?.focus({ preventScroll: true });

  // Smooth scroll to top of quiz container on each step change
  getContainer()?.scrollIntoView({ behavior: scrollBehavior(), block: "nearest" });
}

function handleAnswer(q, input) {
  if (q.type === "likert" || q.type === "choice") {
    state.answers[q.id] = input.value;
    const group = input.closest("[role='radiogroup']");
    group?.querySelectorAll("label").forEach(lbl => {
      lbl.classList.toggle("selected", lbl.contains(input));
    });
  } else if (q.type === "multicheck") {
    // Build array of all currently checked values
    const group    = input.closest(".quiz-multichecks");
    const checked  = [...group.querySelectorAll("input[type='checkbox']:checked")]
      .map(cb => cb.value);
    state.answers[q.id] = checked.length ? checked : undefined;
    // Update selected class on each label
    group.querySelectorAll("label").forEach(lbl => {
      lbl.classList.toggle("selected", lbl.querySelector("input")?.checked);
    });
  }
  saveProgress();
  getStepEl().querySelector("#quiz-error").hidden = true;
  renderProgress();
}

function advanceStep() {
  const q = QUESTIONS[state.step];

  let message = "";
  if (q.type === "text" && state.answers[q.id] && !/^\d{5}$/.test(state.answers[q.id])) {
    message = "Enter a five-digit ZIP code, or clear the field to skip.";
    getStepEl().querySelector("input")?.setAttribute("aria-invalid", "true");
  } else if (q.type === "text" && state.answers[q.id] && !isNewYorkZip(state.answers[q.id])) {
    message = "This demo covers New York ZIP codes. Enter a New York ZIP or clear the field to skip.";
  } else if (!q.optional && state.answers[q.id] === undefined) {
    message = "Choose an answer before continuing. You can choose Neutral / unsure.";
  }
  if (message) {
    const error = getStepEl().querySelector("#quiz-error");
    error.textContent = message;
    error.hidden = false;
    getStepEl().querySelector("input")?.focus();
    return;
  }

  // Optional questions can always be skipped with Next
  // If on last question — go to results
  if (state.step === QUESTIONS.length - 1) {
    showResults();
    return;
  }

  state.step++;
  saveProgress();
  renderQuestion(state.step);
}

function goBack() {
  if (state.step > 0) {
    state.step--;
    saveProgress();
    renderQuestion(state.step);
  }
}

// ─── Results ──────────────────────────────────────────────────────────────────

async function showResults() {
  const request = ++resultRequest;
  state.loading = true;

  const userScores = buildUserScores(state.answers);
  const userZip    = (state.answers["q_zip"] || "").replace(/\s/g, "");
  const ctx = {
    age:        state.answers["q_age"],
    income:     state.answers["q_income"],
    housing:    state.answers["q_housing"],
    employment: state.answers["q_employment"],
    education:  state.answers["q_education"],
    community:  state.answers["q_community"],
  };

  async function score(candidates) {
    let scored;
    try {
      const results = await submitQuizAnswers(userScores, candidates.map(c => c.id), userZip);
      if (request !== resultRequest) return;
      const byId = new Map(results.map(result => [result.candidate_id, result]));
      scored = candidates.map(candidate => {
        const result = byId.get(candidate.id);
        if (!result) throw new Error("Incomplete match response.");
        return { candidate, pct: result.match_pct, valuePct: result.value_match_pct, locationBoost: result.location_boost, explanation: result.explanation };
      });
      ctx.scoreNotice = "Scored by the backend using sample profiles.";
    } catch {
      if (request !== resultRequest) return;
      scored = candidates.map(candidate => ({ candidate, pct: scoreCandidate(candidate, userScores, userZip) }));
      ctx.scoreNotice = "Backend unavailable. Showing matches calculated on this device using sample profiles.";
    }
    scored.sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));
    const resultMap = {};
    scored.forEach(({ candidate, pct }) => { if (pct !== null) resultMap[candidate.id] = pct; });
    state.finished = true;
    set(KEY_ANSWERS, state.answers);
    remove(KEY_PROGRESS);
    set(KEY_RESULT, resultMap);
    document.dispatchEvent(new CustomEvent("quiz-results", { detail: resultMap }));
    renderResults(scored, userScores, userZip, ctx);
  }

  const stepEl = getStepEl();
  if (stepEl) {
    stepEl.innerHTML = `
      <div class="quiz-loading" aria-live="polite" aria-busy="true">
        <div class="quiz-spinner" aria-hidden="true"></div>
        <p>Calculating your matches…</p>
      </div>`;
  }
  try {
    const candidates = await getCandidates();
    if (request !== resultRequest) return;
    if (!candidates.length) throw new Error("No candidate data available");
    await score(candidates);
  } catch {
    if (request !== resultRequest) return;
    state.finished = false;
    if (stepEl) {
      stepEl.innerHTML = `
        <p role="alert">Candidate data could not be loaded. Your answers are saved. Please try again.</p>
        <div class="quiz-nav">
          <button type="button" class="btn quiz-back-btn" id="quiz-review">Review answers</button>
          <button type="button" class="btn" id="quiz-retry">Try again</button>
        </div>`;
      stepEl.querySelector("#quiz-retry").addEventListener("click", showResults);
      stepEl.querySelector("#quiz-review").addEventListener("click", () => renderQuestion(state.step));
      stepEl.querySelector("#quiz-retry").focus({ preventScroll: true });
    }
  } finally {
    if (request === resultRequest) state.loading = false;
  }
}

function renderResults(scored, userScores, userZip, ctx = {}) {
  const stepEl = getStepEl();
  if (!stepEl) return;

  const topMatch = scored[0];

  // ── Human-readable label maps ──
  const AGE_LABEL = {
    under25: "Under 25", "25_34": "25–34", "35_44": "35–44",
    "45_54": "45–54", "55_64": "55–64", "65plus": "65 or older",
  };
  const INCOME_LABEL = {
    under30k: "Under $30k", "30_60k": "$30k–$60k", "60_100k": "$60k–$100k",
    "100_150k": "$100k–$150k", "150_250k": "$150k–$250k", over250k: "Over $250k",
  };
  const HOUSING_LABEL = {
    rent: "Renter", own: "Homeowner", family: "Living with family",
    searching: "Searching for housing", unstable: "Housing instability",
  };
  const EMPLOYMENT_LABEL = {
    fulltime: "Full-time employed", parttime: "Part-time employed",
    selfemployed: "Self-employed", unemployed: "Unemployed / seeking",
    student_fulltime: "Full-time student", student_parttime: "Part-time student",
    retired: "Retired", caregiver: "Caregiver / homemaker",
  };
  const EDUCATION_LABEL = {
    highschool: "High school or less", somecollege: "Some college",
    associate: "Associate degree", bachelors: "Bachelor's degree",
    graduate: "Graduate degree",
  };
  const COMMUNITY_LABEL = {
    urban: "Urban", suburban: "Suburban", smalltown: "Small town", rural: "Rural",
  };

  const contextPills = [
    ctx.age        && ctx.age        !== "skip" ? AGE_LABEL[ctx.age]              : null,
    ctx.income     && ctx.income     !== "skip" ? INCOME_LABEL[ctx.income]        : null,
    ctx.housing    && ctx.housing    !== "skip" ? HOUSING_LABEL[ctx.housing]      : null,
    // employment is now an array
    ...(Array.isArray(ctx.employment)
      ? ctx.employment.map(v => EMPLOYMENT_LABEL[v]).filter(Boolean)
      : ctx.employment && ctx.employment !== "skip" ? [EMPLOYMENT_LABEL[ctx.employment]] : []),
    ctx.education  && ctx.education  !== "skip" ? EDUCATION_LABEL[ctx.education]  : null,
    ctx.community  && ctx.community  !== "skip" ? COMMUNITY_LABEL[ctx.community]  : null,
    userZip ? `ZIP ${userZip}` : null,
  ].filter(Boolean);

  const contextNote = contextPills.length
    ? contextPills.map(p => `<span class="ctx-pill">${p}</span>`).join("")
    : "";

  let html = `
    <div class="quiz-results">
      <div class="quiz-results-header">
        <p class="quiz-eyebrow">Your Results</p>
        <h2 class="quiz-results-title" tabindex="-1">Your Values Match</h2>
        <p class="quiz-results-context" id="quiz-score-notice"></p>
        ${contextNote ? `<p class="quiz-results-context">Your profile — <span class="ctx-pills">${contextNote}</span></p>` : ""}
        ${topMatch ? `
          <div class="quiz-top-match">
            <span class="quiz-top-label">Closest match</span>
            <span class="quiz-top-name">${topMatch.candidate.name}</span>
            <span class="quiz-top-pct">${topMatch.pct}%</span>
          </div>` : ""}
      </div>

      <ol class="quiz-results-list" aria-label="Candidate match rankings">`;

  scored.forEach(({ candidate, pct }, i) => {
    const party      = candidate.party.toLowerCase();
    const partyClass = party.includes("democrat")
      ? "party-democrat"
      : party.includes("republican")
        ? "party-republican"
        : "party-independent";
    const inDistrict = userZip &&
      (candidate.zips.length === 0 || candidate.zips.includes(userZip));
    const rank = i + 1;

    html += `
      <li class="quiz-result-item ${partyClass}" data-candidate-id="${candidate.id}">
        <div class="result-rank">${rank}</div>
        <div class="result-avatar">
          <span class="result-initials" aria-hidden="true">${candidate.name.split(/\s+/).map(part => part[0]).slice(0, 2).join("")}</span>
          <img src="${candidate.photo}" alt="${candidate.name}" width="56" height="56" loading="lazy" />
        </div>
        <div class="result-info">
          <p class="result-name">${candidate.name}</p>
          <p class="result-meta">${candidate.office} · ${candidate.district}</p>
          ${inDistrict ? `<span class="result-district-badge">Sample ZIP coverage</span>` : ""}
        </div>
        <div class="result-score-block">
          <div class="result-bar-wrap" role="meter" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${pct}% match">
            <div class="result-bar" style="width:${pct ?? 0}%"></div>
          </div>
          <span class="result-pct">${pct === null ? "No score" : `${pct}%`}</span>
        </div>
      </li>`;
  });

  html += `</ol>

      <div class="quiz-results-actions">
        <button type="button" class="btn" id="quiz-retake">Retake Quiz</button>
        <a href="#candidate-results" class="btn quiz-view-candidates-btn">View Candidate Cards ↓</a>
      </div>

      <p class="quiz-disclaimer">
        Match percentages are based on your responses to policy questions and are not a political endorsement.
        Sample ZIP coverage adds a small boost; ZIP codes can cross districts. These profiles are not verified live election data.
        Always verify candidate positions through official sources.
      </p>
    </div>`;

  stepEl.innerHTML = html;
  stepEl.querySelector("#quiz-score-notice").textContent = ctx.scoreNotice || "Sample profile matches.";
  stepEl.querySelectorAll(".result-avatar img").forEach(image => {
    const fallback = () => { image.hidden = true; };
    image.addEventListener("error", fallback);
    if (image.getAttribute("src")?.includes("placeholder") || (image.complete && image.naturalWidth === 0)) fallback();
  });
  scored.forEach((result, index) => {
    const details = createMatchDetails(result.candidate, userScores, result, userZip);
    if (details) stepEl.querySelectorAll(".quiz-result-item")[index].append(details);
  });
  renderProgress();
  stepEl.querySelector(".quiz-results-title")?.focus({ preventScroll: true });

  // Wire retake
  stepEl.querySelector("#quiz-retake")?.addEventListener("click", resetQuiz);

  // Scroll up slightly so the results header is visible
  getContainer()?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
}

// ─── Reset ────────────────────────────────────────────────────────────────────

function resetQuiz() {
  resultRequest++;
  remove(KEY_ANSWERS);
  remove(KEY_RESULT);
  remove(KEY_PROGRESS);
  document.dispatchEvent(new CustomEvent("quiz-results", { detail: {} }));
  state = { step: 0, answers: {}, started: true, finished: false };
  renderQuestion(0);
}

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * initQuiz() — called from main.js.
 * Sets up the "Begin Matching Quiz" toggle and restores any saved quiz state.
 */
export async function initQuiz() {
  const toggleBtn = document.querySelector("#quiz-toggle-btn");
  const container = document.querySelector("#quiz-container");
  if (!toggleBtn || !container) return;
  toggleBtn.disabled = true;
  toggleBtn.textContent = "Loading Quiz…";
  try {
    QUESTIONS = await getQuizQuestions();
  } catch {
    toggleBtn.disabled = false;
    toggleBtn.textContent = "Retry Loading Quiz ›";
    toggleBtn.addEventListener("click", initQuiz, { once: true });
    return;
  }
  toggleBtn.disabled = false;
  toggleBtn.textContent = "Begin Matching Quiz ›";

  const completed = readAnswers(get(KEY_ANSWERS));
  const isComplete = QUESTIONS.filter(q => !q.optional)
    .every(q => completed[q.id] !== undefined);
  const draft = get(KEY_PROGRESS);
  if (draft && typeof draft === "object") {
    const answers = readAnswers(draft.answers);
    const firstUnanswered = QUESTIONS.findIndex(q => !q.optional && answers[q.id] === undefined);
    const step = Number.isInteger(draft.step) ? draft.step : 0;
    state = {
      step: Math.max(0, Math.min(step, firstUnanswered < 0 ? QUESTIONS.length - 1 : firstUnanswered)),
      answers, started: true, finished: false,
    };
  } else if (isComplete) {
    state = { step: QUESTIONS.length - 1, answers: completed, started: true, finished: true };
  } else {
    remove(KEY_RESULT);
    remove(KEY_ANSWERS);
  }

  toggleBtn.addEventListener("click", () => {
    const isOpen = container.getAttribute("aria-hidden") !== "true";
    if (isOpen) {
      // Close
      container.setAttribute("aria-hidden", "true");
      container.hidden = true;
      toggleBtn.setAttribute("aria-expanded", "false");
      toggleBtn.textContent = "Begin Matching Quiz ›";
      return;
    }

    // Open
    container.setAttribute("aria-hidden", "false");
    container.hidden = false;
    toggleBtn.setAttribute("aria-expanded", "true");
    toggleBtn.textContent = "Close Quiz ✕";

    if (state.loading) {
      // Keep the pending results view when the panel is reopened.
    } else if (state.finished) {
      showResults();
    } else if (state.started) {
      renderQuestion(state.step);
    } else {
      // First open ever this session — always start from question 0
      state.started = true;
      renderQuestion(0);
    }

    container.scrollIntoView({ behavior: scrollBehavior(), block: "nearest" });
  });
}
