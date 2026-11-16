let candidateData;

export async function getCandidates() {
  if (!candidateData) {
    const response = await fetch(
      new URL("../data/candidates.json", import.meta.url),
    );
    if (!response.ok) throw new Error("Candidate data could not be loaded.");
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error("Candidate data must be a list.");
    candidateData = data;
  }
  return candidateData;
}

export async function getCandidatesByName(query) {
  const candidates = await getCandidates();
  const terms = query.trim().toLocaleLowerCase().split(/\s+/);
  return candidates.filter((candidate) =>
    terms.every((term) => candidate.name.toLocaleLowerCase().includes(term)),
  );
}
