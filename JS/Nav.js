export function initNav() {
  const dropdown = document.querySelector("#nav-dropdown");
  if (!dropdown) return;
  const trigger = dropdown.querySelector("summary");

  document.addEventListener("click", (event) => {
    if (!dropdown.contains(event.target)) dropdown.open = false;
  });

  dropdown.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && dropdown.open) {
      event.preventDefault();
      dropdown.open = false;
      trigger.focus();
    }
  });

  dropdown.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      dropdown.open = false;
      if (link.hash === "#candidate-search-form") {
        document
          .querySelector("#candidate-search")
          ?.focus({ preventScroll: true });
      }
    });
  });
}
