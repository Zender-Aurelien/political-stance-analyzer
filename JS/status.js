import { getBackendStatus } from "./api.js";

export async function initStatus() {
  const status = document.querySelector("#backend-status");
  if (!status) return;
  try {
    const data = await getBackendStatus();
    status.textContent = `Backend connected · ${data.candidate_count} sample profiles · Quiz and match scoring ready. ${data.watsonx_enabled ? "IBM AI explanations enabled." : "Standard policy explanations enabled."} Profiles and ZIP coverage are for demonstration.`;
  } catch {
    status.textContent = "Offline preview · Using included sample data. Start the backend to enable server scoring.";
  }
}
