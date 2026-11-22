import { formatDistrict } from "./profile-format.js";
import { getCandidateProfile } from "./api.js";

let returnFocus;
let profileRequest = 0;

export function initDetails() {
  const dialog = document.querySelector("#candidate-detail");
  dialog.addEventListener("close", () => {
    profileRequest++;
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  });
}

export function openDetail(candidate, trigger) {
  const dialog = document.querySelector("#candidate-detail");
  const request = ++profileRequest;
  returnFocus = trigger;
  renderDetail(candidate);
  dialog.querySelector(".detail-box").scrollTop = 0;
  if (!dialog.open) dialog.showModal();
  if (!candidate.profileUrl) return;
  const status = dialog.querySelector("#detail-sync-status");
  status.textContent = "Checking official background and legislative records…";
  getCandidateProfile(candidate).then(profile => {
    if (request !== profileRequest || !dialog.open) return;
    renderDetail(profile);
    status.textContent = profile.profileStatus === "cached"
      ? "Showing saved source information; the latest refresh was unavailable."
      : profile.profileStatus === "unavailable"
        ? "A source update is unavailable. Existing information is labeled below."
        : profile.positions?.length && !profile.policyEvidence?.length
          ? "Background sources checked. Sample policy positions have not been verified by this refresh."
          : "Source information updated. Sponsorship records are not a complete policy platform.";
  }).catch(() => {
    if (request === profileRequest && dialog.open) status.textContent = "Sources could not be refreshed. Check the linked official pages.";
  });
}

function renderDetail(candidate) {
  const dialog = document.querySelector("#candidate-detail");
  const setText = (id, value) => {
    dialog.querySelector(id).textContent = value;
  };
  setText("#detail-sync-status", "");
  dialog.classList.remove("party-democrat", "party-republican", "party-independent");
  const party = candidate.party?.toLowerCase() || "";
  dialog.classList.add(party.includes("democrat") ? "party-democrat" : party.includes("republican") ? "party-republican" : "party-independent");
  setText("#detail-name", candidate.name);
  setText("#detail-party", candidate.party || "Party not verified");
  setText("#detail-office", candidate.office || "Not verified");
  setText("#detail-district", formatDistrict(candidate.district));
  setText(
    "#detail-bio",
    (candidate.biographyMode === "official_excerpt" && candidate.bio ? `“${candidate.bio}”` : candidate.bio) ||
      candidate.summary ||
      "Verified work and experience information has not been added yet.",
  );
  const biographySource = dialog.querySelector("#detail-bio-source");
  biographySource.replaceChildren();
  if (candidate.biographySource) {
    const link = safeLink(candidate.biographySource);
    if (link) {
      link.textContent = candidate.biographyMode === "reviewed_summary"
        ? `Official biography · summary reviewed ${candidate.biographyReviewedAt || ""}`
        : "Read full official biography";
      biographySource.append(link);
    }
  }
  setText(
    "#detail-notice",
    candidate.dataSource === "live" || candidate.dataSource === "live+sample"
      ? "Office details from Open States. ZIP coverage is approximate; this is not an election candidate list."
      : candidate.isPreview !== false
      ? "Preview profile — this is not a verified election record."
      : "Check the sources and verification date before relying on this profile.",
  );

  const photo = dialog.querySelector("#detail-photo");
  photo.removeAttribute("src");
  photo.alt = candidate.name;
  if (candidate.photo) {
    try {
      const url = new URL(candidate.photo, document.baseURI);
      if (["https:", "http:", "file:"].includes(url.protocol))
        photo.src = url.href;
    } catch {}
  }

  const positions = dialog.querySelector("#detail-positions");
  positions.replaceChildren();
  const evidence = candidate.policyEvidence || [];
  for (const position of evidence.length ? [] : candidate.positions || []) {
    const item = document.createElement("li");
    item.textContent = `${position.topic}: ${position.description || position.stance || "Not verified"}`;
    positions.append(item);
  }
  setText("#detail-policy-heading", evidence.length ? "Policy & legislative activity" : candidate.positions?.length ? "Sample policy positions" : "Policy positions");
  for (const record of evidence) {
    const link = safeLink(record.url);
    if (!link) continue;
    const item = document.createElement("li");
    item.className = "detail-evidence";
    link.textContent = record.title;
    const meta = document.createElement("span");
    meta.className = "detail-evidence-meta";
    meta.textContent = `${record.kind}${record.date ? ` · Latest action ${record.date}` : ""}`;
    item.append(link, meta);
    positions.append(item);
  }
  setText(
    "#detail-positions-empty",
    positions.children.length
      ? ""
      : "Verified policy positions have not been added yet.",
  );

  const sources = dialog.querySelector("#detail-sources");
  sources.replaceChildren();
  for (const source of candidate.sources || []) {
    try {
      const url = new URL(source, document.baseURI);
      if (!["https:", "http:"].includes(url.protocol)) continue;
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = url.href;
      link.textContent = url.hostname.replace(/^www\./, "");
      item.append(link);
      sources.append(item);
    } catch {}
  }
  setText(
    "#detail-sources-empty",
    sources.children.length ? "" : "Source links have not been added yet.",
  );
  setText(
    "#detail-verified",
    candidate.profileCheckedAt
      ? `Sources checked: ${new Date(candidate.profileCheckedAt).toLocaleString()}`
      : candidate.lastVerified
      ? `Last verified: ${candidate.lastVerified}`
      : "Verification date not supplied.",
  );
}

function safeLink(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    const link = document.createElement("a");
    link.href = url.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    return link;
  } catch { return null; }
}
