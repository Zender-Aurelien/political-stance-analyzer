import { getCandidates, getCandidatesByName, getCandidatesByZip } from "./api.js";
import { renderCards } from "./candidates.js";

export function classifySearch(value) {
  const query = value.trim();
  if (!query)
    return { error: "Enter a candidate name or a five-digit ZIP code." };
  if (/^[0-9]{5}$/.test(query)) return { type: "zip", query };
  if (/^[0-9\s-]+$/.test(query)) {
    return { error: "Enter a five-digit ZIP code, such as 12757." };
  }
  return { type: "name", query };
}

export function initSearch() {
  const form = document.querySelector("#candidate-search-form");
  if (!form) return;
  const input = form.querySelector("#candidate-search");
  const status = document.querySelector("#search-status");
  const row = document.querySelector("#candidate-results");
  let requestId = 0;

  async function showCandidates(search) {
    const current = ++requestId;
    row.setAttribute("aria-busy", "true");
    status.textContent = "Loading preview candidates…";
    try {
      const candidates = search?.type === "zip"
        ? await getCandidatesByZip(search.query)
        : search ? await getCandidatesByName(search.query) : await getCandidates();
      if (current !== requestId) return;
      renderCards(candidates);
      const liveCount = candidates.filter(candidate => candidate.dataSource === "live" || candidate.dataSource === "live+sample").length;
      status.textContent = liveCount
        ? `${liveCount} state legislator ${liveCount === 1 ? "profile" : "profiles"} from Open States + ${candidates.length - liveCount} sample profiles. ZIP lookup uses an approximate location; verify your district. Policy matching still uses sample profiles.`
        : candidates.length
        ? `${candidates.length} sample ${candidates.length === 1 ? "profile" : "profiles"}${search ? ` matching “${search.query}”` : ""}. ZIP coverage is approximate; these are not verified live election records.`
        : `No sample profiles found for “${search.query}”. Try a New York ZIP such as 10027, or a candidate name.`;
    } catch {
      if (current !== requestId) return;
      renderCards([]);
      status.textContent =
        "Could not load preview data. Open the site through a local web server and try again.";
    } finally {
      if (current === requestId) row.removeAttribute("aria-busy");
    }
  }

  input.addEventListener("input", () => input.setCustomValidity(""));
  input.addEventListener("search", () => {
    if (!input.value.trim()) showCandidates();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const search = classifySearch(input.value);
    if (search.error) {
      input.setCustomValidity(search.error);
      input.reportValidity();
      return;
    }
    showCandidates(search);
  });
  showCandidates();
}
