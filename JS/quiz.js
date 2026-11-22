/**
 * quiz.js — Civic Lens values-matching quiz
 *
 * Architecture:
 *  - 16 policy questions  (5-point Likert scale, fully unbiased framing)
 *  - 2  context questions (ZIP code + age group) — used as soft-weight signals only
 *  - Scoring: each policy answer maps to a stance spectrum (-2 … +2)
 *    Candidate stances are pre-mapped to the same scale.
 *    Match % = 100 − (mean absolute deviation across shared topics) × 25
 *  - Location boost: if the user's ZIP is in a candidate's district, +4 raw points
 *    (never more than ~5% of a 100-point score, keeping values primary)
 *  - Age context: shown in results copy only — no score effect
 *  - Results saved to localStorage under cl_quiz_result and cl_quiz_answers
 */

import { get, set, remove } from "./storage.js";
import { getCandidates, getCandidatesSync } from "./api.js";

// ─── Storage keys ────────────────────────────────────────────────────────────
const KEY_ANSWERS = "cl_quiz_answers";
const KEY_RESULT  = "cl_quiz_result";

// ─── Stance → numeric spectrum ───────────────────────────────────────────────
// Candidate stances from candidates.json mapped to -2 … +2
const STANCE_SCORE = {
  // Progressive / expand end
  expand:     2,
  support:    2,
  increase:   2,
  reform:     1,
  regulate:   1,
  // Centre
  neutral:    0,
  // Market / restrict end
  market:    -1,
  deregulate:-1,
  decrease:  -2,
  restrict:  -2,
  oppose:    -2,
};

// ─── Quiz questions ───────────────────────────────────────────────────────────
// Each question maps to a candidate topic key.
// Options are ordered strongly-agree → strongly-disagree and labelled neutrally.
// The `score` array maps option index (0-4) to the -2…+2 spectrum for that topic.
const QUESTIONS = [
  // ── CONTEXT (no topic / no score effect) ──────────────────────────────────
  {
    id: "q_zip",
    type: "text",
    topic: null,
    section: "About You",
    prompt: "What is your ZIP code?",
    helpText: "New York ZIP codes only. This helps us highlight candidates who represent your specific area. You can skip this.",
    placeholder: "e.g. 10027",
    optional: true,
  },
  {
    id: "q_age",
    type: "choice",
    topic: null,
    section: "About You",
    prompt: "Which age group do you belong to?",
    helpText: "Age can shape how policies affect you personally. This context appears in your results summary.",
    options: [
      { label: "Under 25",   value: "under25" },
      { label: "25 – 34",    value: "25_34" },
      { label: "35 – 44",    value: "35_44" },
      { label: "45 – 54",    value: "45_54" },
      { label: "55 – 64",    value: "55_64" },
      { label: "65 or older",value: "65plus" },
      { label: "Prefer not to say", value: "skip" },
    ],
    optional: true,
  },
  {
    id: "q_income",
    type: "choice",
    topic: null,
    section: "About You",
    prompt: "What is your approximate annual household income?",
    helpText: "Income often shapes which policies benefit you most — from tax rates to healthcare costs to housing affordability. All answers are anonymous and stored only on your device.",
    options: [
      { label: "Under $30k",       value: "under30k" },
      { label: "$30k – $60k",      value: "30_60k" },
      { label: "$60k – $100k",     value: "60_100k" },
      { label: "$100k – $150k",    value: "100_150k" },
      { label: "$150k – $250k",    value: "150_250k" },
      { label: "Over $250k",       value: "over250k" },
      { label: "Prefer not to say",value: "skip" },
    ],
    optional: true,
  },
  {
    id: "q_housing",
    type: "choice",
    topic: null,
    section: "About You",
    prompt: "What is your current housing situation?",
    helpText: "Whether you rent, own, or are searching directly affects which housing and economic policies matter most to you.",
    options: [
      { label: "I rent",                  value: "rent" },
      { label: "I own my home",           value: "own" },
      { label: "I live with family",      value: "family" },
      { label: "Looking for housing",     value: "searching" },
      { label: "Experiencing instability",value: "unstable" },
      { label: "Prefer not to say",       value: "skip" },
    ],
    optional: true,
  },
  {
    id: "q_employment",
    type: "multicheck",
    topic: null,
    section: "About You",
    prompt: "Which of these describe your current situation? Select all that apply.",
    helpText: "Your work and study situation shapes how you're affected by policies on wages, healthcare, taxes, and business regulation. Choose as many as apply.",
    options: [
      { label: "Employed full-time",    value: "fulltime" },
      { label: "Employed part-time",    value: "parttime" },
      { label: "Self-employed",         value: "selfemployed" },
      { label: "Unemployed / seeking",  value: "unemployed" },
      { label: "Full-time student",     value: "student_fulltime" },
      { label: "Part-time student",     value: "student_parttime" },
      { label: "Retired",               value: "retired" },
      { label: "Caregiver / homemaker", value: "caregiver" },
    ],
    optional: true,
  },
  {
    id: "q_education",
    type: "choice",
    topic: null,
    section: "About You",
    prompt: "What is the highest level of education you have completed?",
    helpText: "Education level is one context factor that researchers find correlates with views on certain policies. This is shown in your results only.",
    options: [
      { label: "High school or less",  value: "highschool" },
      { label: "Some college",         value: "somecollege" },
      { label: "Associate degree",     value: "associate" },
      { label: "Bachelor's degree",    value: "bachelors" },
      { label: "Graduate degree",      value: "graduate" },
      { label: "Prefer not to say",    value: "skip" },
    ],
    optional: true,
  },
  {
    id: "q_community",
    type: "choice",
    topic: null,
    section: "About You",
    prompt: "How would you describe the area where you live?",
    helpText: "Urban, suburban, and rural communities often face different policy challenges around transit, housing density, and local services.",
    options: [
      { label: "Urban (city)",         value: "urban" },
      { label: "Suburban",             value: "suburban" },
      { label: "Small town",           value: "smalltown" },
      { label: "Rural",                value: "rural" },
      { label: "Prefer not to say",    value: "skip" },
    ],
    optional: true,
  },

  // ── HOUSING ───────────────────────────────────────────────────────────────
  {
    id: "q_housing_rent",
    type: "likert",
    topic: "housing",
    section: "Housing",
    prompt: "Government should set limits on how much landlords can raise rent each year.",
    helpText: "Rent stabilization and rent control laws restrict annual rent increases for existing tenants.",
    score: [2, 1, 0, -1, -2], // strongly agree → strongly disagree
  },
  {
    id: "q_housing_public",
    type: "likert",
    topic: "housing",
    section: "Housing",
    prompt: "Building more government-owned affordable housing is a better solution to the housing crisis than relying on private developers.",
    helpText: "Public housing is government-owned. Private development relies on market forces, sometimes with tax incentives for affordability.",
    score: [2, 1, 0, -1, -2],
  },

  // ── HEALTHCARE ────────────────────────────────────────────────────────────
  {
    id: "q_healthcare_singlepayer",
    type: "likert",
    topic: "healthcare",
    section: "Healthcare",
    prompt: "A single government-run health insurance program for all Americans would lead to better outcomes than the current mix of private and public insurance.",
    helpText: "Single-payer (e.g. Medicare for All) would replace most private insurance with one federal program. The current system mixes employer, marketplace, Medicare, and Medicaid coverage.",
    score: [2, 1, 0, -1, -2],
  },
  {
    id: "q_healthcare_market",
    type: "likert",
    topic: "healthcare",
    section: "Healthcare",
    prompt: "Competition among private insurance companies is the best way to keep healthcare costs down and quality up.",
    helpText: "Market-based approaches rely on consumer choice and insurer competition to drive efficiency and innovation.",
    score: [-2, -1, 0, 1, 2], // reversed: agreement = market stance
  },

  // ── CLIMATE ───────────────────────────────────────────────────────────────
  {
    id: "q_climate_urgency",
    type: "likert",
    topic: "climate",
    section: "Climate & Energy",
    prompt: "Addressing climate change should be an urgent national priority even if it means significant costs to certain industries.",
    helpText: "Aggressive climate policies may raise energy prices or require major industry transitions; proponents argue the long-term costs of inaction are far higher.",
    score: [2, 1, 0, -1, -2],
  },
  {
    id: "q_climate_energy",
    type: "likert",
    topic: "climate",
    section: "Climate & Energy",
    prompt: "The government should invest heavily in renewable energy infrastructure rather than supporting continued fossil fuel production.",
    helpText: "Federal investment in solar, wind, and grid upgrades versus maintaining oil, gas, and coal production that supports existing jobs and energy prices.",
    score: [2, 1, 0, -1, -2],
  },

  // ── POLICING ──────────────────────────────────────────────────────────────
  {
    id: "q_police_funding",
    type: "likert",
    topic: "police_reform",
    section: "Public Safety",
    prompt: "Police department budgets should be reduced and that funding redirected toward social services, mental health programs, and community resources.",
    helpText: "Some argue social-service investment reduces crime more effectively than policing. Others say adequate police funding is essential for public safety.",
    score: [2, 1, 0, -1, -2],
  },
  {
    id: "q_police_accountability",
    type: "likert",
    topic: "police_reform",
    section: "Public Safety",
    prompt: "Police officers who use excessive force should face stronger legal consequences than the current system provides.",
    helpText: "Current legal doctrines like qualified immunity make it difficult to hold officers civilly liable. Reform advocates want those protections narrowed.",
    score: [1, 1, 0, -1, -2], // accountability ≠ defund, so max is +1 for reform
  },

  // ── EDUCATION ─────────────────────────────────────────────────────────────
  {
    id: "q_education_college",
    type: "likert",
    topic: "education",
    section: "Education",
    prompt: "Public colleges and universities should be tuition-free, funded through taxes rather than student fees.",
    helpText: "Free college proposals would eliminate tuition at public institutions. Critics point to cost and argue it benefits higher-income students who attend college at higher rates.",
    score: [2, 1, 0, -1, -2],
  },
  {
    id: "q_education_choice",
    type: "likert",
    topic: "education",
    section: "Education",
    prompt: "Families should have the right to use public education funds (vouchers) to send their children to private or charter schools of their choice.",
    helpText: "School choice and voucher programs give parents more options. Critics argue they divert funding from public schools and can increase segregation.",
    score: [-2, -1, 0, 1, 1], // agreement = market/neutral stance on education
  },

  // ── IMMIGRATION ───────────────────────────────────────────────────────────
  {
    id: "q_immigration_pathway",
    type: "likert",
    topic: "immigration",
    section: "Immigration",
    prompt: "Undocumented immigrants who have lived and worked in the U.S. for many years should have a pathway to legal status.",
    helpText: "A pathway to citizenship or legal status would apply to long-term undocumented residents. Critics argue it rewards rule-breaking; supporters say mass deportation is costly and disruptive.",
    score: [2, 1, 0, -1, -2],
  },
  {
    id: "q_immigration_border",
    type: "likert",
    topic: "immigration",
    section: "Immigration",
    prompt: "Stricter border enforcement and reduced immigration levels would benefit American workers and communities.",
    helpText: "Arguments for restriction focus on wage competition and security; arguments against point to economic contributions of immigrants and humanitarian obligations.",
    score: [-2, -1, 0, 1, 2], // reversed: agreement = restrict
  },

  // ── TAXES ─────────────────────────────────────────────────────────────────
  {
    id: "q_taxes_wealthy",
    type: "likert",
    topic: "taxes",
    section: "Taxes & Economy",
    prompt: "Wealthy individuals and large corporations should pay significantly higher tax rates to fund public services.",
    helpText: "Progressive taxation increases rates on higher incomes to fund education, healthcare, infrastructure, and social programs.",
    score: [2, 1, 0, -1, -2],
  },
  {
    id: "q_economy_regulation",
    type: "likert",
    topic: "economy",
    section: "Taxes & Economy",
    prompt: "Reducing government regulations on businesses leads to more jobs and economic growth.",
    helpText: "Deregulation advocates argue rules stifle innovation and hiring. Critics say regulations protect workers, consumers, and the environment from corporate harm.",
    score: [-2, -1, 0, 1, 2], // reversed: agreement = deregulate
  },

  // ── TRANSIT ───────────────────────────────────────────────────────────────
  {
    id: "q_transit",
    type: "likert",
    topic: "transit",
    section: "Transit & Infrastructure",
    prompt: "Government should significantly expand public transit — buses, subways, and trains — even in areas where it currently isn't profitable.",
    helpText: "Public transit often requires subsidies. Proponents say it reduces inequality, congestion, and emissions. Critics say subsidizing low-ridership lines is inefficient.",
    score: [2, 1, 0, -1, -2],
  },
];

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

/**
 * Score a single candidate against user scores.
 * Returns 0-100 value-match, then adds a small location boost.
 */
function scoreCandidate(candidate, userScores, userZip) {
  const sharedTopics = candidate.positions
    .map(p => p.topic)
    .filter(t => userScores[t] !== undefined);

  if (sharedTopics.length === 0) return 50; // neutral default

  const totalDev = sharedTopics.reduce((sum, topic) => {
    const candidateStance = candidate.positions.find(p => p.topic === topic)?.stance;
    const candidateScore  = STANCE_SCORE[candidateStance] ?? 0;
    const userScore       = userScores[topic];
    return sum + Math.abs(userScore - candidateScore);
  }, 0);

  // Max possible deviation per topic = 4 (from -2 to +2)
  const maxDev   = sharedTopics.length * 4;
  const valuePct = Math.round(100 - (totalDev / maxDev) * 100);

  // Location soft-boost: +4 raw points if the ZIP is in the candidate's district
  // Statewide candidates (empty zips array) always get the boost
  let locationBoost = 0;
  if (userZip) {
    const inDistrict =
      candidate.zips.length === 0 || candidate.zips.includes(userZip);
    if (inDistrict) locationBoost = 4;
  }

  return Math.min(100, valuePct + locationBoost);
}

// ─── State machine ────────────────────────────────────────────────────────────

let state = {
  step:    0,          // current question index
  answers: {},         // { questionId: answerValue }
  started: false,
  finished: false,
};

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
      <p class="quiz-prompt">${q.prompt}</p>
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
    const saved = state.answers[q.id] || "";
    html += `
      <div class="quiz-text-input">
        <input
          type="text"
          id="${q.id}_input"
          name="${q.id}"
          placeholder="${q.placeholder || ""}"
          maxlength="5"
          pattern="[0-9]{5}"
          value="${saved}"
          aria-label="${q.prompt}"
          autocomplete="postal-code"
          inputmode="numeric"
        />
        <p class="quiz-text-hint">5-digit ZIP only. ${q.optional ? "Optional — press Next to skip." : ""}</p>
      </div>`;
  }

  html += `</div>`;

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
    textInput?.addEventListener("input", () => {
      state.answers[q.id] = textInput.value.trim();
    });
  }

  el.querySelector("#quiz-next")?.addEventListener("click", () => advanceStep());
  el.querySelector("#quiz-back")?.addEventListener("click", () => goBack());

  renderProgress();

  // Smooth scroll to top of quiz container on each step change
  getContainer()?.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
  renderProgress();
}

function advanceStep() {
  const q = QUESTIONS[state.step];

  // Optional questions can always be skipped with Next
  // If on last question — go to results
  if (state.step === QUESTIONS.length - 1) {
    showResults();
    return;
  }

  state.step++;
  renderQuestion(state.step);
}

function goBack() {
  if (state.step > 0) {
    state.step--;
    renderQuestion(state.step);
  }
}

// ─── Results ──────────────────────────────────────────────────────────────────

function showResults() {
  state.finished = true;
  set(KEY_ANSWERS, state.answers);

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

  function score(candidates) {
    const scored = candidates
      .map(c => ({ candidate: c, pct: scoreCandidate(c, userScores, userZip) }))
      .sort((a, b) => b.pct - a.pct);
    const resultMap = {};
    scored.forEach(({ candidate, pct }) => { resultMap[candidate.id] = pct; });
    set(KEY_RESULT, resultMap);
    document.dispatchEvent(new CustomEvent("quiz-results", { detail: resultMap }));
    renderResults(scored, userScores, userZip, ctx);
  }

  // Use sync cache if candidates already loaded (the common case)
  const cached = getCandidatesSync();
  if (cached) {
    score(cached);
    return;
  }

  // First time ever — fetch then score
  const stepEl = getStepEl();
  if (stepEl) {
    stepEl.innerHTML = `
      <div class="quiz-loading" aria-live="polite" aria-busy="true">
        <div class="quiz-spinner" aria-hidden="true"></div>
        <p>Calculating your matches…</p>
      </div>`;
  }
  getCandidates()
    .then(score)
    .catch(() => score([]));
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
        <h2 class="quiz-results-title">Your Values Match</h2>
        ${contextNote ? `<p class="quiz-results-context">Your profile — <span class="ctx-pills">${contextNote}</span></p>` : ""}
        ${topMatch ? `
          <div class="quiz-top-match">
            <span class="quiz-top-label">Closest match</span>
            <span class="quiz-top-name">${topMatch.candidate.name}</span>
            <span class="quiz-top-pct">${topMatch.pct}%</span>
          </div>` : ""}
      </div>

      <ol class="quiz-results-list" aria-label="Candidate match rankings">`;

  // Human-readable topic names for the breakdown
  const TOPIC_LABEL = {
    housing: "Housing", healthcare: "Healthcare", climate: "Climate & Energy",
    police_reform: "Public Safety", education: "Education", immigration: "Immigration",
    taxes: "Taxes", economy: "Economy", transit: "Transit",
  };

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

    // Build topic-by-topic breakdown rows
    const breakdownRows = candidate.positions
      .filter(p => userScores[p.topic] !== undefined)
      .map(p => {
        const userScore      = userScores[p.topic];
        const candidateScore = STANCE_SCORE[p.stance] ?? 0;
        const diff           = Math.abs(userScore - candidateScore);
        // diff 0–1 = aligned, 2–3 = mixed, 4 = opposed
        const alignClass = diff <= 1 ? "align-yes" : diff <= 2.5 ? "align-mixed" : "align-no";
        const alignIcon  = diff <= 1 ? "✓" : diff <= 2.5 ? "~" : "✕";
        const label      = TOPIC_LABEL[p.topic] || p.topic;
        return `<div class="breakdown-row ${alignClass}">
          <span class="breakdown-icon" aria-hidden="true">${alignIcon}</span>
          <span class="breakdown-topic">${label}</span>
          <span class="breakdown-desc">${p.description}</span>
        </div>`;
      })
      .join("");

    html += `
      <li class="quiz-result-item ${partyClass}" data-candidate-id="${candidate.id}">
        <div class="result-rank">${rank}</div>
        <div class="result-avatar">
          <img src="${candidate.photo}" alt="${candidate.name}" width="56" height="56" loading="lazy" />
        </div>
        <div class="result-info">
          <p class="result-name">${candidate.name}</p>
          <p class="result-meta">${candidate.office} · ${candidate.district}</p>
          ${inDistrict ? `<span class="result-district-badge">Represents your area</span>` : ""}
        </div>
        <div class="result-score-block">
          <div class="result-bar-wrap" role="meter" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${pct}% match">
            <div class="result-bar" style="width:${pct}%"></div>
          </div>
          <span class="result-pct">${pct}%</span>
        </div>
        ${breakdownRows ? `
        <div class="result-breakdown" id="breakdown-${candidate.id}">
          <button type="button" class="breakdown-toggle" aria-expanded="false" aria-controls="breakdown-body-${candidate.id}">
            Why this score? <span class="breakdown-chevron" aria-hidden="true">›</span>
          </button>
          <div class="breakdown-body" id="breakdown-body-${candidate.id}" hidden>
            ${breakdownRows}
          </div>
        </div>` : ""}
      </li>`;
  });

  html += `</ol>

      <div class="quiz-results-actions">
        <button type="button" class="btn" id="quiz-retake">Retake Quiz</button>
        <a href="#candidate-results" class="btn quiz-view-candidates-btn">View Candidate Cards ↓</a>
      </div>

      <p class="quiz-disclaimer">
        Match percentages are based on your responses to policy questions and are not a political endorsement.
        Location adds a small boost for candidates who represent your district.
        Always verify candidate positions through official sources.
      </p>
    </div>`;

  stepEl.innerHTML = html;

  // Wire breakdown toggles
  stepEl.querySelectorAll(".breakdown-toggle").forEach(btn => {
    btn.addEventListener("click", () => {
      const body     = document.getElementById(btn.getAttribute("aria-controls"));
      const expanded = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", String(!expanded));
      body.hidden = expanded;
      btn.querySelector(".breakdown-chevron").textContent = expanded ? "›" : "↓";
    });
  });

  // Wire retake
  stepEl.querySelector("#quiz-retake")?.addEventListener("click", resetQuiz);

  // Scroll up slightly so the results header is visible
  getContainer()?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ─── Reset ────────────────────────────────────────────────────────────────────

function resetQuiz() {
  state = { step: 0, answers: {}, started: true, finished: false };
  renderQuestion(0);
}

// ─── Show saved results helper ───────────────────────────────────────────────

/**
 * Re-render results from localStorage.
 * Uses the synchronous cache when available (instant, no spinner).
 * Falls back to async fetch only on first page load before data is cached.
 * If anything fails, resets to question 0.
 */
function showResultsFromSaved() {
  const savedAnswers = get(KEY_ANSWERS) || {};
  const userScores   = buildUserScores(savedAnswers);
  const userZip      = (savedAnswers["q_zip"] || "").replace(/\s/g, "");
  const ctx = {
    age: savedAnswers["q_age"], income: savedAnswers["q_income"],
    housing: savedAnswers["q_housing"], employment: savedAnswers["q_employment"],
    education: savedAnswers["q_education"], community: savedAnswers["q_community"],
  };

  function scoreAndRender(candidates) {
    const scored = candidates
      .map(c => ({ candidate: c, pct: scoreCandidate(c, userScores, userZip) }))
      .sort((a, b) => b.pct - a.pct);
    renderResults(scored, userScores, userZip, ctx);
  }

  // Use synchronous cache if already loaded — no spinner, no delay
  const cached = getCandidatesSync();
  if (cached) {
    scoreAndRender(cached);
    return;
  }

  // First load: show spinner while fetching
  const stepEl = getStepEl();
  if (stepEl) {
    stepEl.innerHTML = `
      <div class="quiz-loading" aria-live="polite" aria-busy="true">
        <div class="quiz-spinner" aria-hidden="true"></div>
        <p>Calculating your matches…</p>
      </div>`;
  }
  getCandidates()
    .then(scoreAndRender)
    .catch(() => {
      state.finished = false;
      renderQuestion(0);
    });
}

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * initQuiz() — called from main.js.
 * Sets up the "Begin Matching Quiz" toggle and restores any saved quiz state.
 */
export function initQuiz() {
  const toggleBtn = document.querySelector("#quiz-toggle-btn");
  const container = document.querySelector("#quiz-container");
  if (!toggleBtn || !container) return;

  // Clear any stale saved quiz state from previous sessions
  // (candidate list may have changed, old result IDs are no longer valid)
  remove(KEY_RESULT);
  remove(KEY_ANSWERS);

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

    if (state.finished) {
      showResultsFromSaved();
    } else if (state.started) {
      renderQuestion(state.step);
    } else {
      // First open ever this session — always start from question 0
      state.started = true;
      renderQuestion(0);
    }

    container.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
}
