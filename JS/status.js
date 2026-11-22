import { getBackendStatus } from "./api.js";

export async function initStatus() {
  const status = document.querySelector("#backend-status");
  if (!status) return;
  try {
    const data = await getBackendStatus();
    status.textContent = data.openstates_configured
      ? `Open States lookup enabled for New York ZIP searches · Matching uses ${data.candidate_count} sample profiles. ZIP results are approximate; verify your district.`
      : `Backend connected · ${data.candidate_count} sample profiles · Quiz and match scoring ready. ${data.watsonx_enabled ? "IBM AI explanations enabled." : "Standard policy explanations enabled."} Profiles and ZIP coverage are for demonstration.`;
  } catch {
    status.textContent = "Offline preview · Using included sample data. Start the backend to enable server scoring.";
  }
}
