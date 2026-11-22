// Runs in <head> before styles. Light is the default; preference is saved in localStorage.
(() => {
  const STORAGE_KEY = "civic-lens-theme";

  function getInitialTheme() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "dark" || saved === "light") return saved;
    return "light";
  }

  function applyTheme(theme) {
    // High contrast (accessibility/accessibility.js) overrides the theme while it is on.
    if (document.documentElement.classList.contains("a11y-contrast")) return;
    document.documentElement.dataset.theme = theme;
  }

  function syncButtons(theme) {
    const isDark = theme === "dark";
    document.querySelectorAll("[data-theme-toggle]").forEach(btn => {
      btn.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
      btn.setAttribute("title", isDark ? "Switch to light mode" : "Switch to dark mode");
      btn.querySelector(".theme-icon-sun").hidden = !isDark;
      btn.querySelector(".theme-icon-moon").hidden = isDark;
    });
  }

  const initial = getInitialTheme();
  applyTheme(initial);

  // Sync button icons once the DOM is ready (handles saved dark preference on load).
  document.addEventListener("DOMContentLoaded", () => syncButtons(initial));

  // Expose toggle so the nav button can call it.
  window.__civicToggleTheme = function () {
    const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    const next = current === "dark" ? "light" : "dark";
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
    syncButtons(next);
  };
})();
