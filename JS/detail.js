import { formatDistrict } from "./profile-format.js";

let returnFocus;

export function initDetails() {
  const dialog = document.querySelector("#candidate-detail");
  dialog.addEventListener("close", () => {
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  });
}

export function openDetail(candidate, trigger) {
  const dialog = document.querySelector("#candidate-detail");
  const setText = (id, value) => {
    dialog.querySelector(id).textContent = value;
  };
  returnFocus = trigger;
  dialog.classList.remove("party-democrat", "party-republican", "party-independent");
  const party = candidate.party?.toLowerCase() || "";
  dialog.classList.add(party.includes("democrat") ? "party-democrat" : party.includes("republican") ? "party-republican" : "party-independent");
  setText("#detail-name", candidate.name);
  setText("#detail-party", candidate.party || "Party not verified");
  setText("#detail-office", candidate.office || "Not verified");
  setText("#detail-district", formatDistrict(candidate.district));
  setText(
    "#detail-bio",
    candidate.bio ||
      candidate.summary ||
      "Verified work and experience information has not been added yet.",
  );
  setText(
    "#detail-notice",
    candidate.isPreview !== false
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
  for (const position of candidate.positions || []) {
    const item = document.createElement("li");
    item.textContent = `${position.topic}: ${position.description || position.stance || "Not verified"}`;
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
    candidate.lastVerified
      ? `Last verified: ${candidate.lastVerified}`
      : "Verification date not supplied.",
  );
  dialog.querySelector(".detail-box").scrollTop = 0;
  if (!dialog.open) dialog.showModal();
}
