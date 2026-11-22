// Keep display formatting separate from the stored district and ZIP coverage.
export function formatDistrict(district) {
  const value = district?.trim();
  if (!value) return "Not supplied";
  if (value === "New York City") return "New York City, New York";
  const stateFirst = value.match(/^New York\s*·\s*(.+)$/);
  return stateFirst ? `${stateFirst[1]}, New York` : value;
}
