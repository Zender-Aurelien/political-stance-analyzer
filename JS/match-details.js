import { compareTopics, scoreCandidate } from "./matching.js";

const TOPICS = {
  housing: "Housing", healthcare: "Healthcare", climate: "Climate & energy",
  police_reform: "Public safety", education: "Education", immigration: "Immigration",
  taxes: "Taxes", economy: "Economy", transit: "Transit",
};
const ALIGNMENT = { close: "Close match", partial: "Partial match", different: "Different views" };

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createMatchDetails(candidate, userScores, result, userZip) {
  const comparisons = compareTopics(candidate, userScores);
  if (!comparisons.length) return null;
  const details = element("div", "result-breakdown");
  const body = element("div", "breakdown-body");
  body.id = `breakdown-body-${candidate.id}`;
  body.hidden = true;
  const toggle = element("button", "breakdown-toggle");
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", body.id);
  toggle.setAttribute("aria-label", `Why this score? ${candidate.name}`);
  const toggleCopy = element("span", "breakdown-toggle-copy");
  toggleCopy.append(element("span", "breakdown-toggle-title", "Why this score?"), element("span", "breakdown-toggle-meta", `${comparisons.length} policy topics compared`));
  const chevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  chevron.classList.add("breakdown-chevron");
  chevron.setAttribute("viewBox", "0 0 20 20");
  chevron.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "m5 7.5 5 5 5-5");
  chevron.append(path);
  toggle.append(toggleCopy, chevron);
  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!expanded));
    body.hidden = expanded;
  });

  const intro = element("div", "breakdown-intro");
  intro.append(element("h3", "breakdown-title", "Your match at a glance"));
  body.append(intro);

  const counts = comparisons.reduce((summary, row) => { summary[row.alignment]++; return summary; }, { close: 0, partial: 0, different: 0 });
  const legend = element("div", "breakdown-legend");
  legend.setAttribute("aria-label", "Topic comparison summary");
  for (const [key, label] of [["close", "close"], ["partial", "partial"], ["different", "different"]]) {
    if (counts[key]) legend.append(element("span", `alignment-count alignment-${key}`, `${counts[key]} ${label}`));
  }
  body.append(legend);

  const table = element("table", "breakdown-table");
  const caption = element("caption", "breakdown-caption", "Policy comparison");
  const head = element("thead");
  const headerRow = element("tr");
  for (const label of ["Policy topic", "Profile position"])
    headerRow.append(element("th", "", label));
  head.append(headerRow);
  const rows = element("tbody");
  comparisons.forEach((comparison, index) => {
    const row = element("tr", `breakdown-row alignment-${comparison.alignment}`);
    row.hidden = index >= 3;
    const topic = element("th", "breakdown-topic");
    topic.scope = "row";
    topic.append(element("span", "breakdown-topic-name", TOPICS[comparison.topic] || comparison.topic), element("span", `alignment-badge alignment-${comparison.alignment}`, ALIGNMENT[comparison.alignment]));
    const position = element("td", "breakdown-position", comparison.description);
    row.append(topic, position);
    rows.append(row);
  });
  table.append(caption, head, rows);
  table.id = `topic-comparison-${candidate.id}`;
  body.append(table);
  if (comparisons.length > 3) {
    const showAll = element("button", "breakdown-show-all", `Show all ${comparisons.length} topics`);
    showAll.type = "button";
    showAll.setAttribute("aria-expanded", "false");
    showAll.setAttribute("aria-controls", table.id);
    showAll.addEventListener("click", () => {
      const expanded = showAll.getAttribute("aria-expanded") === "true";
      rows.querySelectorAll("tr").forEach((row, index) => { row.hidden = expanded && index >= 3; });
      showAll.setAttribute("aria-expanded", String(!expanded));
      showAll.textContent = expanded ? `Show all ${comparisons.length} topics` : "Show fewer topics";
    });
    body.append(showAll);
  }

  const method = element("details", "breakdown-method");
  method.append(element("summary", "", "How is this calculated?"));
  method.append(element("p", "", "We compare your policy answers with this profile’s recorded positions. Each shared topic counts equally: closer answers mean a higher match. Sample ZIP coverage can add 4 points, and the final score is capped at 100%. Optional details such as age and income do not affect the score."));
  const policyPct = result.valuePct ?? scoreCandidate(candidate, userScores, "");
  const boost = result.locationBoost ?? (userZip && (!candidate.zips.length || candidate.zips.includes(userZip)) ? 4 : 0);
  const calculation = `${policyPct}% policy alignment + ${boost} ZIP points → ${result.pct}% final match${policyPct + boost > 100 ? " (capped at 100%)" : ""}.`;
  method.append(element("p", "breakdown-calculation", calculation));
  if (result.explanation) {
    const summary = element("div", "breakdown-summary-note");
    summary.append(element("h4", "", "Match summary"), element("p", "result-explanation", result.explanation));
    method.append(summary);
  }
  body.append(method);
  const sources = element("div", "breakdown-sources");
  sources.append(element("span", "breakdown-source-label", "Profile references"));
  for (const source of candidate.sources || []) {
    try {
      const url = new URL(source);
      if (!["https:", "http:"].includes(url.protocol)) continue;
      const link = element("a", "breakdown-source-link", url.hostname.replace(/^www\./, ""));
      link.href = url.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      sources.append(link);
    } catch { /* Invalid source links are omitted. */ }
  }
  sources.append(element("p", "breakdown-source-note", "Sample profile · Check the references for current positions."));
  body.append(sources);
  details.append(toggle, body);
  return details;
}
