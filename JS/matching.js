// Shared by the offline scorer and the visible score explanation.
export const STANCE_SCORE = {
  expand: 2, support: 2, increase: 2, reform: 1, regulate: 1,
  neutral: 0, market: -1, deregulate: -1,
  decrease: -2, restrict: -2, oppose: -2,
};

export function compareTopics(candidate, userScores) {
  const positions = new Map((candidate.positions || [])
    .filter(position => Object.hasOwn(STANCE_SCORE, position.stance) && userScores[position.topic] !== undefined)
    .map(position => [position.topic, position]));
  return [...positions.values()].map(position => {
    const userScore = userScores[position.topic];
    const profileScore = STANCE_SCORE[position.stance];
    const difference = Math.abs(userScore - profileScore);
    return {
      ...position, userScore, profileScore, difference,
      similarity: Math.round(100 - difference * 25),
      alignment: difference <= 1 ? "close" : difference <= 2.5 ? "partial" : "different",
    };
  });
}

export function scoreCandidate(candidate, userScores, userZip) {
  const comparisons = compareTopics(candidate, userScores);
  if (!comparisons.length) return null;
  const valuePct = Math.round(100 - comparisons.reduce((sum, row) => sum + row.difference, 0) / comparisons.length * 25);
  const locationBoost = userZip && (!candidate.zips.length || candidate.zips.includes(userZip)) ? 4 : 0;
  return Math.min(100, valuePct + locationBoost);
}
