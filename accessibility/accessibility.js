// Accessibility options: a blue button that opens a panel of display preferences.
// Load as a classic script in <head> so saved preferences apply before the first paint.
(() => {
  const STORAGE_KEY = "cl_accessibility";
  const TEXT_SIZES = [
    { value: "100", label: "Default" },
    { value: "115", label: "Large" },
    { value: "130", label: "Larger" },
    { value: "150", label: "Largest" },
  ];
  const TOGGLES = [
    { key: "contrast", label: "High contrast", hint: "Stronger text, border, and link colors." },
    { key: "underline", label: "Underline links", hint: "Marks every link without relying on color." },
    { key: "spacing", label: "Wider text spacing", hint: "More room between lines, letters, and words." },
    { key: "font", label: "Simpler font", hint: "Plain, regular-weight lettering." },
    { key: "targets", label: "Larger buttons", hint: "Bigger, easier-to-tap buttons and fields." },
    { key: "motion", label: "Reduce motion", hint: "Turns off animation and smooth scrolling." },
  ];
  const DEFAULTS = { textSize: "100", ...Object.fromEntries(TOGGLES.map(({ key }) => [key, false])) };
  const root = document.documentElement;

  // Accept only known keys and values so a damaged saved value cannot break the page.
  function load() {
    const settings = { ...DEFAULTS };
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
      if (saved && typeof saved === "object") {
        if (TEXT_SIZES.some(size => size.value === saved.textSize)) settings.textSize = saved.textSize;
        TOGGLES.forEach(({ key }) => { if (typeof saved[key] === "boolean") settings[key] = saved[key]; });
      }
    } catch { /* Storage blocked or unreadable: use defaults. */ }
    return settings;
  }

  function save(settings) {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); }
    catch { /* Settings still apply for this page view. */ }
  }

  // Same rule as JS/theme.js: follow the device, light when unknown.
  function deviceTheme() {
    return typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function apply(settings) {
    if (settings.textSize === DEFAULTS.textSize) delete root.dataset.a11yText;
    else root.dataset.a11yText = settings.textSize;
    TOGGLES.forEach(({ key }) => root.classList.toggle(`a11y-${key}`, settings[key]));
    // High contrast replaces the device's light/dark mode; turning it off restores the device mode.
    root.dataset.theme = settings.contrast ? "dark" : deviceTheme();
  }

  let settings = load();
  apply(settings);

  const ICON = `<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/>
    <circle cx="12" cy="7" r="1.25" fill="currentColor"/><path d="M7 10l5 1.2 5-1.2M12 11.2V15m0 0l-2.5 4M12 15l2.5 4"/></svg>`;

  function buildWidget() {
    if (document.querySelector(".a11y-widget")) return;
    const widget = document.createElement("div");
    widget.className = "a11y-widget";
    widget.innerHTML = `
      <button type="button" class="a11y-toggle" aria-expanded="false" aria-controls="a11y-panel">
        ${ICON}<span>Accessibility</span>
      </button>
      <section id="a11y-panel" class="a11y-panel" role="dialog" aria-modal="false"
        aria-labelledby="a11y-title" aria-describedby="a11y-intro" hidden>
        <div class="a11y-panel-header">
          <h2 id="a11y-title" tabindex="-1">Accessibility options</h2>
          <button type="button" class="a11y-close" aria-label="Close accessibility options">
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <p id="a11y-intro" class="a11y-intro">Changes apply right away and are saved on this device.</p>
        <fieldset class="a11y-text-size">
          <legend>Text size</legend>
          ${TEXT_SIZES.map(({ value, label }) => `
            <label class="a11y-choice">
              <input type="radio" name="a11y-text-size" value="${value}" />
              <span>${label} <span class="a11y-percent">(${value}%)</span></span>
            </label>`).join("")}
        </fieldset>
        <ul class="a11y-options">
          ${TOGGLES.map(({ key, label, hint }) => `
            <li>
              <label class="a11y-switch">
                <input type="checkbox" role="switch" name="${key}" aria-describedby="a11y-hint-${key}" />
                <span class="a11y-switch-text">
                  <span class="a11y-switch-label">${label}</span>
                  <span class="a11y-hint" id="a11y-hint-${key}">${hint}</span>
                </span>
                <span class="a11y-state" aria-hidden="true">Off</span>
              </label>
            </li>`).join("")}
        </ul>
        <button type="button" class="a11y-reset">Reset to defaults</button>
        <p class="a11y-visually-hidden" role="status" aria-live="polite"></p>
      </section>`;
    document.body.append(widget);

    const toggle = widget.querySelector(".a11y-toggle");
    const panel = widget.querySelector(".a11y-panel");
    const title = widget.querySelector("#a11y-title");
    const status = widget.querySelector('[role="status"]');

    function syncControls() {
      widget.querySelectorAll('input[name="a11y-text-size"]').forEach(radio => {
        radio.checked = radio.value === settings.textSize;
      });
      TOGGLES.forEach(({ key }) => {
        const input = widget.querySelector(`input[name="${key}"]`);
        input.checked = settings[key];
        input.closest(".a11y-switch").querySelector(".a11y-state").textContent = settings[key] ? "On" : "Off";
      });
    }

    function update(next, message = "") {
      settings = next;
      apply(settings);
      save(settings);
      syncControls();
      status.textContent = message;
    }

    function open() {
      panel.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
      title.focus();
    }

    function close({ returnFocus = true } = {}) {
      if (panel.hidden) return;
      panel.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      if (returnFocus) toggle.focus();
    }

    toggle.addEventListener("click", () => (panel.hidden ? open() : close()));
    widget.querySelector(".a11y-close").addEventListener("click", () => close());
    widget.querySelector(".a11y-reset").addEventListener("click", () => {
      update({ ...DEFAULTS }, "All accessibility options were reset.");
    });
    panel.addEventListener("change", event => {
      const input = event.target;
      if (input.name === "a11y-text-size") update({ ...settings, textSize: input.value });
      else if (input.name in DEFAULTS) update({ ...settings, [input.name]: input.checked });
    });
    widget.addEventListener("keydown", event => {
      if (event.key === "Escape" && !panel.hidden) {
        event.preventDefault();
        close();
      }
    });
    // Clicking elsewhere closes the panel without stealing focus from what was clicked.
    document.addEventListener("click", event => {
      if (!widget.contains(event.target)) close({ returnFocus: false });
    });
    // Keep every open tab in sync when settings change in another tab.
    window.addEventListener("storage", event => {
      if (event.key === STORAGE_KEY) { settings = load(); apply(settings); syncControls(); }
    });

    syncControls();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", buildWidget);
  else buildWidget();
})();
