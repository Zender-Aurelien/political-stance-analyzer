import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { JSDOM } from "jsdom";

const source = await fs.readFile(new URL("../JS/theme.js", import.meta.url), "utf8");

function device({ dark = false, legacy = false, supported = true } = {}) {
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: "http://localhost", runScripts: "outside-only" });
  const callbacks = new Set();
  const preference = { matches: dark };
  if (legacy) preference.addListener = callback => callbacks.add(callback);
  else preference.addEventListener = (event, callback) => { if (event === "change") callbacks.add(callback); };
  if (supported) dom.window.matchMedia = () => preference;
  dom.window.localStorage.setItem("cl_theme", dark ? "light" : "dark");
  dom.window.localStorage.setItem("cl_quiz_answers", "saved answers");
  dom.window.eval(source);
  return {
    dom,
    change(dark) { preference.matches = dark; callbacks.forEach(callback => callback({ matches: dark })); },
  };
}

test("starts in the device's light mode and ignores old saved theme preferences", () => {
  const { dom } = device();
  assert.equal(dom.window.document.documentElement.dataset.theme, "light");
  assert.equal(dom.window.localStorage.getItem("cl_theme"), "dark");
});

test("starts in dark mode and switches both ways live without changing answers", () => {
  const { dom, change } = device({ dark: true });
  assert.equal(dom.window.document.documentElement.dataset.theme, "dark");
  change(false);
  assert.equal(dom.window.document.documentElement.dataset.theme, "light");
  change(true);
  assert.equal(dom.window.document.documentElement.dataset.theme, "dark");
  assert.equal(dom.window.localStorage.getItem("cl_quiz_answers"), "saved answers");
});

test("supports older Safari preference listeners", () => {
  const { dom, change } = device({ legacy: true });
  change(true);
  assert.equal(dom.window.document.documentElement.dataset.theme, "dark");
});

test("uses light as a safe fallback when device preference detection is unavailable", () => {
  const { dom } = device({ supported: false });
  assert.equal(dom.window.document.documentElement.dataset.theme, "light");
});

test("both pages detect the device theme before styles and contain no forced-dark components", async () => {
  for (const file of ["index.html", "about.html"]) {
    const html = await fs.readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.ok(html.indexOf('src="JS/theme.js') < html.indexOf('rel="stylesheet"'));
    assert.ok(html.includes('name="color-scheme" content="light dark"'));
    assert.ok(!html.includes('data-theme="dark"'));
  }
  const cards = await fs.readFile(new URL("../JS/candidates.js", import.meta.url), "utf8");
  assert.ok(!cards.includes('card.dataset.theme = "dark"'));
});
