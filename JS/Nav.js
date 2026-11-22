export function initNav() {
  const dropdown = document.querySelector("#nav-dropdown");
  if (!dropdown) return;
  const trigger = dropdown.querySelector("summary");
  const links = [...dropdown.querySelectorAll("a")];
  const pagePath = path => path.replace(/\/index\.html$/, "/");

  function syncCurrentLink() {
    const current = new URL(window.location.href);
    const targets = links.map(link => new URL(link.href, document.baseURI));
    const samePage = target => pagePath(target.pathname) === pagePath(current.pathname);
    const hasSectionMatch = targets.some(target => samePage(target) && target.hash && target.hash === current.hash);
    links.forEach((link, index) => {
      const target = targets[index];
      const active = samePage(target) && (target.hash ? target.hash === current.hash : !hasSectionMatch);
      if (active) link.setAttribute("aria-current", target.hash ? "location" : "page");
      else link.removeAttribute("aria-current");
    });
  }

  syncCurrentLink();
  window.addEventListener("hashchange", syncCurrentLink);
  document.addEventListener("click", event => {
    if (!dropdown.contains(event.target)) dropdown.open = false;
  });
  dropdown.addEventListener("keydown", event => {
    if (event.key === "Escape" && dropdown.open) {
      event.preventDefault();
      dropdown.open = false;
      trigger.focus();
    }
  });
  links.forEach(link => {
    link.addEventListener("click", () => {
      dropdown.open = false;
      if (link.hash === "#candidate-search-form") {
        document.querySelector("#candidate-search")?.focus({ preventScroll: true });
      }
    });
  });
  if (window.location.hash === "#candidate-search-form") {
    document.querySelector("#candidate-search")?.focus({ preventScroll: true });
  }
}
