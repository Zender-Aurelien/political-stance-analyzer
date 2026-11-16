import { getCandidates, getCandidatesByName } from "./api.js";
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
    if (search?.type === "zip") {
      row.removeAttribute("aria-busy");
      renderCards([]);
      status.textContent =
        "ZIP lookup is not connected yet. New York coverage and district verification require location data. Try searching by name.";
      return;
    }
    row.setAttribute("aria-busy", "true");
    status.textContent = "Loading preview candidates…";
    try {
      const candidates = search
        ? await getCandidatesByName(search.query)
        : await getCandidates();
      if (current !== requestId) return;
      renderCards(candidates);
      status.textContent = candidates.length
        ? `${candidates.length} preview ${candidates.length === 1 ? "profile" : "profiles"}${search ? ` matching “${search.query}”` : ""}. These are layout samples, not a verified election lineup.`
        : `No preview profiles found for “${search.query}”. Try another name.`;
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
