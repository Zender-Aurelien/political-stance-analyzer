// Same origin when served by the backend. Set this URL for a separate API deployment.
const API_BASE = "";
let candidateData;
let candidateRequest;

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}/api${path}`, {
    ...options,
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`API request failed (${response.status}).`);
  return response.json();
}

async function localData(file) {
  const response = await fetch(new URL(`../data/${file}`, import.meta.url));
  if (!response.ok) throw new Error("Local reference data could not be loaded.");
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error("Reference data must be a list.");
  return data;
}

export async function getCandidates() {
  if (candidateData) return candidateData;
  if (!candidateRequest) {
    candidateRequest = (async () => {
      let data;
      try { data = await request("/candidates"); }
      catch { data = await localData("candidates.json"); }
      if (!Array.isArray(data)) throw new Error("Candidate data must be a list.");
      candidateData = data.map(candidate => ({ ...candidate, isPreview: true }));
      return candidateData;
    })().finally(() => { candidateRequest = null; });
  }
  return candidateRequest;
}

export function getCandidatesSync() { return candidateData ?? null; }

export async function getCandidatesByName(query) {
  const candidates = await getCandidates();
  const terms = query.trim().toLocaleLowerCase().split(/\s+/);
  return candidates.filter(candidate => terms.every(term => candidate.name.toLocaleLowerCase().includes(term)));
}

export function isNewYorkZip(zip) {
  return /^(?:1[0-4][0-9]{3}|00501|00544|06390)$/.test(zip);
}

export async function getCandidatesByZip(zip) {
  if (!/^[0-9]{5}$/.test(zip)) throw new Error("Enter a five-digit ZIP code.");
  if (!isNewYorkZip(zip)) return [];
  try { return await request(`/candidates?zip=${encodeURIComponent(zip)}`); }
  catch {
    return (await getCandidates()).filter(candidate => !candidate.zips.length || candidate.zips.includes(zip));
  }
}

export async function getQuizQuestions() {
  let questions;
  try { questions = await request("/quiz"); }
  catch { questions = await localData("quiz.json"); }
  if (!Array.isArray(questions) || !questions.length) throw new Error("Quiz questions could not be loaded.");
  return questions;
}

export async function submitQuizAnswers(answers, candidateIds, zip) {
  return request("/match", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers, candidate_ids: candidateIds, zip: zip || null }),
  });
}

export async function getBackendStatus() { return request("/status"); }

export async function getCandidateProfile(candidate) {
  if (!candidate.profileUrl?.startsWith("/api/candidates/")) return candidate;
  return request(candidate.profileUrl.slice(4));
}
