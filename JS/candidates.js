import { formatDistrict } from "./profile-format.js";
import { openDetail } from "./detail.js";
import { get } from "./storage.js";

const KEY_RESULT = "cl_quiz_result";

/**
 * Listen for quiz-results events (fired by quiz.js) and stamp match badges
 * onto any already-rendered candidate cards.
 */
document.addEventListener("quiz-results", (event) => {
  const resultMap = event.detail; // { candidateId: pct }
  document.querySelectorAll(".candidate-card[data-candidate-id]").forEach(card => {
    card.querySelector(".candidate-match-badge")?.remove();
    const pct = resultMap[card.dataset.candidateId];
    if (pct === undefined) return;

    const badge = document.createElement("span");
    badge.className = "candidate-match-badge";
    badge.textContent = `${pct}% match`;

    // Insert before the "View Details" actions block
    const actions = card.querySelector(".card-actions");
    if (actions) actions.before(badge);
  });
});

export function initCandidateScrolling() {
  const row = document.querySelector("#candidate-results");
  const next = document.querySelector("#next-candidates");
  const previous = document.querySelector("#previous-candidates");
  if (!row || !next || !previous) return;

  function updateButtons() {
    previous.disabled = row.scrollLeft <= 2;
    next.disabled = row.scrollLeft + row.clientWidth >= row.scrollWidth - 2;
  }

  function move(direction) {
    const card = row.querySelector(".candidate-card");
    if (!card) return;
    const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
    row.scrollBy({
      left: direction * (card.getBoundingClientRect().width + gap),
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }

  next.addEventListener("click", () => move(1));
  previous.addEventListener("click", () => move(-1));
  row.addEventListener("scroll", updateButtons, { passive: true });
  new ResizeObserver(updateButtons).observe(row);
  row.addEventListener("candidates-rendered", updateButtons);
  updateButtons();
}

export function renderCards(candidates) {
  const row = document.querySelector("#candidate-results");
  row.replaceChildren();
  const controls = document.querySelector(".candidate-controls");
  controls.hidden = candidates.length === 0;

  for (const candidate of candidates) {
    const card = document.createElement("article");
    const party = candidate.party.toLowerCase();
    const partyClass =
      party === "democratic"
        ? "party-democrat"
        : party === "republican"
          ? "party-republican"
          : "party-independent";
    card.className = `card candidate-card ${partyClass} bg-base-200 text-base-content w-full`;
    card.innerHTML = `
      <div class="party-stripe" aria-hidden="true"></div>
      <div class="card-body">
        <div class="avatar candidate-avatar"><div class="w-20 rounded-full">
          <img loading="lazy" width="80" height="80">
        </div></div>
        <h3 class="candidate-name"></h3>
        <p class="candidate-party"></p>
        <dl class="candidate-facts">
          <div><dt>Office</dt><dd data-field="office"></dd></div>
          <div><dt>Area / district</dt><dd data-field="district"></dd></div>
        </dl>
        <div class="candidate-summary"><p></p></div>
        <div class="card-actions"><button type="button" class="btn w-full">View Details</button></div>
      </div>`;
    const image = card.querySelector("img");
    const photo = new URL(candidate.photo, document.baseURI);
    if (["http:", "https:", "file:"].includes(photo.protocol))
      image.src = photo.href;
    image.alt = candidate.name;
    card.dataset.candidateId = candidate.id;
    card.querySelector(".candidate-name").textContent = candidate.name;
    card.querySelector(".candidate-party").textContent = candidate.party;
    card.querySelector('[data-field="office"]').textContent = candidate.office;
    card.querySelector('[data-field="district"]').textContent =
      formatDistrict(candidate.district);
    card.querySelector(".candidate-summary p").textContent = candidate.summary;
    for (const source of candidate.sources || []) {
      const url = new URL(source, document.baseURI);
      if (!["https:", "http:"].includes(url.protocol)) continue;
      const link = document.createElement("a");
      link.className = "candidate-source";
      link.href = url.href;
      link.textContent = "Official profile / source";
      card
        .querySelector(".card-body")
        .insertBefore(link, card.querySelector(".card-actions"));
    }
    const detailsButton = card.querySelector(".card-actions button");
    detailsButton.setAttribute("aria-haspopup", "dialog");
    detailsButton.setAttribute("aria-controls", "candidate-detail");
    detailsButton.setAttribute(
      "aria-label",
      `View details for ${candidate.name}`,
    );
    detailsButton.addEventListener("click", () =>
      openDetail(candidate, detailsButton),
    );
    row.append(card);
  }
  row.scrollLeft = 0;
  row.dispatchEvent(new Event("candidates-rendered"));

  // If quiz results already exist in storage, stamp badges immediately
  const savedResults = get(KEY_RESULT);
  if (savedResults) {
    row.querySelectorAll(".candidate-card[data-candidate-id]").forEach(card => {
      const pct = savedResults[card.dataset.candidateId];
      if (pct === undefined) return;
      card.querySelector(".candidate-match-badge")?.remove();
      const badge = document.createElement("span");
      badge.className = "candidate-match-badge";
      badge.textContent = `${pct}% match`;
      card.querySelector(".card-actions")?.before(badge);
    });
  }
}
