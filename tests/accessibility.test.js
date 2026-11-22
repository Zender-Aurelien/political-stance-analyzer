import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { JSDOM } from "jsdom";

const source = await fs.readFile(new URL("../accessibility/accessibility.js", import.meta.url), "utf8");
const themeSource = await fs.readFile(new URL("../JS/theme.js", import.meta.url), "utf8");
const motionSource = (await fs.readFile(new URL("../accessibility/motion.js", import.meta.url), "utf8"))
  .replace(/^export /gm, "");
const KEY = "cl_accessibility";

// Fake device preferences that can change while the page is open.
function fakeDevice(window, { dark = false, reduceMotion = false } = {}) {
  const queries = {
    "(prefers-color-scheme: dark)": { matches: dark, listeners: new Set() },
    "(prefers-reduced-motion: reduce)": { matches: reduceMotion, listeners: new Set() },
  };
  window.matchMedia = query => {
    const state = queries[query];
    return {
      get matches() { return state.matches; },
      addEventListener: (event, callback) => state.listeners.add(callback),
    };
  };
  return {
    setDark(value) {
      const state = queries["(prefers-color-scheme: dark)"];
      state.matches = value;
      state.listeners.forEach(callback => callback({ matches: value }));
    },
  };
}

async function page(saved, device) {
  const dom = new JSDOM(
    '<!doctype html><html lang="en"><head></head><body><button id="outside">Outside</button><main id="main-content" tabindex="-1"></main></body></html>',
    { url: "http://localhost", runScripts: "outside-only", pretendToBeVisual: true },
  );
  if (saved !== undefined) dom.window.localStorage.setItem(KEY, saved);
  const system = device ? fakeDevice(dom.window, device) : null;
  if (device) dom.window.eval(themeSource); // Real page order: theme.js, then accessibility.js.
  dom.window.eval(source);
  if (dom.window.document.readyState === "loading") {
    await new Promise(resolve => dom.window.document.addEventListener("DOMContentLoaded", resolve));
  }
  const doc = dom.window.document;
  const q = selector => doc.querySelector(selector);
  const change = input => input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  const key = (target, name) => target.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: name, bubbles: true }));
  const stored = () => JSON.parse(dom.window.localStorage.getItem(KEY));
  return { dom, doc, root: doc.documentElement, q, change, key, stored, system };
}

test("starts with defaults and a closed, labeled button", async () => {
  const { root, q } = await page();
  const toggle = q(".a11y-toggle");
  assert.equal(toggle.textContent.trim(), "Accessibility");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(toggle.getAttribute("aria-controls"), "a11y-panel");
  assert.ok(q("#a11y-panel").hidden);
  assert.equal(root.dataset.a11yText, undefined);
  assert.equal([...root.classList].filter(name => name.startsWith("a11y-")).length, 0);
  assert.equal(q('input[name="a11y-text-size"]:checked').value, "100");
});

test("opens, moves focus into the panel, and Escape closes it and returns focus", async () => {
  const { doc, q, key } = await page();
  const toggle = q(".a11y-toggle");
  toggle.click();
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(q("#a11y-panel").hidden, false);
  assert.equal(doc.activeElement, q("#a11y-title"));
  key(q('input[name="contrast"]'), "Escape");
  assert.ok(q("#a11y-panel").hidden);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(doc.activeElement, toggle);
});

test("clicking outside closes the panel; the close button closes it too", async () => {
  const { q } = await page();
  q(".a11y-toggle").click();
  q("#outside").click();
  assert.ok(q("#a11y-panel").hidden);
  q(".a11y-toggle").click();
  q(".a11y-close").click();
  assert.ok(q("#a11y-panel").hidden);
});

test("options apply immediately, show On/Off text, and are saved", async () => {
  const { root, q, change, stored } = await page();
  const size = q('input[name="a11y-text-size"][value="130"]');
  size.checked = true;
  change(size);
  const contrast = q('input[name="contrast"]');
  contrast.checked = true;
  change(contrast);
  assert.equal(root.dataset.a11yText, "130");
  assert.ok(root.classList.contains("a11y-contrast"));
  assert.equal(contrast.closest(".a11y-switch").querySelector(".a11y-state").textContent, "On");
  assert.equal(contrast.getAttribute("role"), "switch");
  assert.deepEqual({ textSize: stored().textSize, contrast: stored().contrast }, { textSize: "130", contrast: true });
});

test("saved options are restored before the page renders", async () => {
  const { root, q } = await page(JSON.stringify({ textSize: "150", underline: true, motion: true }));
  assert.equal(root.dataset.a11yText, "150");
  assert.ok(root.classList.contains("a11y-underline"));
  assert.ok(root.classList.contains("a11y-motion"));
  assert.ok(!root.classList.contains("a11y-contrast"));
  assert.ok(q('input[name="underline"]').checked);
});

test("reset clears every option and announces it", async () => {
  const { root, q, stored } = await page(JSON.stringify({ textSize: "115", contrast: true, spacing: true }));
  q(".a11y-reset").click();
  assert.equal(root.dataset.a11yText, undefined);
  assert.ok(!root.classList.contains("a11y-contrast"));
  assert.ok(!root.classList.contains("a11y-spacing"));
  assert.equal(stored().textSize, "100");
  assert.match(q('[role="status"]').textContent, /reset/);
});

test("damaged or unexpected saved values fall back to safe defaults", async () => {
  for (const saved of ["not json", "null", JSON.stringify({ textSize: "999", contrast: "yes", evil: true })]) {
    const { root } = await page(saved);
    assert.equal(root.dataset.a11yText, undefined);
    assert.ok(!root.classList.contains("a11y-contrast"));
    assert.ok(!root.classList.contains("a11y-evil"));
  }
});

test("every option has a visible label and the panel has a heading", async () => {
  const { q, doc } = await page();
  assert.equal(q("#a11y-panel").getAttribute("aria-labelledby"), "a11y-title");
  assert.equal(q("#a11y-title").tagName, "H2");
  assert.equal(q(".a11y-text-size legend").textContent, "Text size");
  for (const input of doc.querySelectorAll(".a11y-panel input")) {
    assert.ok(input.closest("label")?.textContent.trim(), `${input.name} needs a label`);
  }
});

test("both pages load the widget early, include a skip link, and declare a language", async () => {
  for (const file of ["index.html", "about.html"]) {
    const html = await fs.readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.ok(html.includes('<html lang="en">'), file);
    assert.ok(html.indexOf('src="accessibility/accessibility.js') < html.indexOf('rel="stylesheet"'), file);
    assert.ok(html.lastIndexOf('href="accessibility/accessibility.css') > html.lastIndexOf('href="Styles.css/'), file);
    const body = html.slice(html.indexOf("<body>"));
    assert.match(body, /^<body>\s*<a class="skip-link" href="#main-content">Skip to main content<\/a>/, file);
    assert.ok(html.includes('<main id="main-content" tabindex="-1">'), file);
  }
});

test("high contrast replaces a light device mode with the contrast mode", async () => {
  const { root, q, change } = await page(undefined, { dark: false });
  assert.equal(root.dataset.theme, "light");
  const contrast = q('input[name="contrast"]');
  contrast.checked = true;
  change(contrast);
  assert.equal(root.dataset.theme, "dark");
  assert.ok(root.classList.contains("a11y-contrast"));
});

test("high contrast stays on when the device switches light/dark, and off restores the device mode", async () => {
  const { root, q, change, system } = await page(JSON.stringify({ contrast: true }), { dark: true });
  assert.equal(root.dataset.theme, "dark");
  system.setDark(false);
  assert.equal(root.dataset.theme, "dark", "device change must not undo high contrast");
  const contrast = q('input[name="contrast"]');
  contrast.checked = false;
  change(contrast);
  assert.equal(root.dataset.theme, "light", "turning it off follows the device again");
  system.setDark(true);
  assert.equal(root.dataset.theme, "dark");
});

test("saved high contrast applies at load even on a light device", async () => {
  const { root } = await page(JSON.stringify({ contrast: true }), { dark: false });
  assert.equal(root.dataset.theme, "dark");
  assert.ok(root.classList.contains("a11y-contrast"));
});

test("reduce motion makes scripted scrolling jump instantly", async () => {
  const { dom, q, change } = await page(undefined, {});
  dom.window.eval(motionSource + "; window.__scrollBehavior = scrollBehavior;");
  assert.equal(dom.window.__scrollBehavior(), "smooth");
  const motion = q('input[name="motion"]');
  motion.checked = true;
  change(motion);
  assert.equal(dom.window.__scrollBehavior(), "instant");
});

test("the device's reduce-motion setting also makes scrolling instant", async () => {
  const { dom } = await page(undefined, { reduceMotion: true });
  dom.window.eval(motionSource + "; window.__scrollBehavior = scrollBehavior;");
  assert.equal(dom.window.__scrollBehavior(), "instant");
});

test("no script requests smooth scrolling directly; all use the shared motion helper", async () => {
  for (const file of ["JS/quiz.js", "JS/candidates.js"]) {
    const code = await fs.readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.ok(!/behavior:\s*["']smooth["']/.test(code), file);
    assert.ok(code.includes('from "../accessibility/motion.js"'), file);
  }
  const css = await fs.readFile(new URL("../accessibility/accessibility.css", import.meta.url), "utf8");
  assert.match(css, /:root\.a11y-motion \.candidate-grid \{\s*scroll-snap-type: x mandatory;/);
});

test("high contrast palette meets WCAG AAA text and 3:1 non-text contrast", async () => {
  const css = await fs.readFile(new URL("../accessibility/accessibility.css", import.meta.url), "utf8");
  const block = css.slice(css.indexOf(":root.a11y-contrast,"), css.indexOf("}", css.indexOf(":root.a11y-contrast,")));
  const vars = Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})/gi)].map(m => [m[1], m[2]]));
  const lum = hex => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const bg = vars["--color-bg"];
  for (const name of ["--color-text", "--text-muted", "--text-faint", "--link-color", "--civic-accent", "--error-text",
    "--close-text", "--partial-text", "--different-text"]) {
    assert.ok(ratio(vars[name], bg) >= 7, `${name} ${vars[name]} on ${bg}: ${ratio(vars[name], bg).toFixed(2)}`);
  }
  for (const name of ["--a11y-blue", "--nav-selected-bg"]) {
    assert.ok(ratio("#ffffff", vars[name]) >= 7, `white on ${name}`);
  }
  for (const name of ["--border", "--border-soft", "--a11y-focus"]) {
    assert.ok(ratio(vars[name], bg) >= 3, `${name} edge`);
  }
  // Soft tones instead of pure black/white to limit glare.
  assert.notEqual(bg.toLowerCase(), "#000000");
  assert.notEqual(vars["--color-text"].toLowerCase(), "#ffffff");
  assert.match(css, /@media \(forced-colors: active\)/);
});
