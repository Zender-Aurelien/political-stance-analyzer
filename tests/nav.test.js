import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { JSDOM } from "jsdom";
import { initNav } from "../JS/Nav.js";

async function page(file, url) {
  const html = await fs.readFile(new URL(`../${file}`, import.meta.url), "utf8");
  const dom = new JSDOM(html, { url });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  initNav();
  return dom;
}

test("highlights Home or the search section consistently for both home URLs", async () => {
  const dom = await page("index.html", "http://localhost/");
  const links = [...document.querySelectorAll(".civic-menu a")];
  assert.equal(links[0].getAttribute("aria-current"), "page");
  dom.window.history.replaceState({}, "", "/index.html#candidate-search-form");
  dom.window.dispatchEvent(new dom.window.Event("hashchange"));
  assert.equal(links[0].hasAttribute("aria-current"), false);
  assert.equal(links[1].getAttribute("aria-current"), "location");
  dom.window.history.replaceState({}, "", "/index.html");
  dom.window.dispatchEvent(new dom.window.Event("hashchange"));
  assert.equal(links[0].getAttribute("aria-current"), "page");
  assert.equal(links[1].hasAttribute("aria-current"), false);
});

test("About highlights only About; direct search links focus the search box", async () => {
  await page("about.html", "http://localhost/about.html");
  assert.equal(document.querySelectorAll('.civic-menu [aria-current]').length, 1);
  assert.match(document.querySelector('.civic-menu [aria-current]').textContent, /About/i);
  await page("index.html", "http://localhost/index.html#candidate-search-form");
  assert.equal(document.activeElement.id, "candidate-search");
});

test("Escape, outside clicks, and selecting a link close the dropdown", async () => {
  const dom = await page("index.html", "http://localhost/");
  const dropdown = document.querySelector("#nav-dropdown");
  dropdown.open = true;
  dropdown.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  assert.equal(dropdown.open, false);
  assert.equal(document.activeElement, dropdown.querySelector("summary"));
  dropdown.open = true;
  document.body.click();
  assert.equal(dropdown.open, false);
  dropdown.open = true;
  const search = dropdown.querySelector('a[href="#candidate-search-form"]');
  search.addEventListener("click", event => event.preventDefault());
  search.click();
  assert.equal(dropdown.open, false);
  assert.equal(document.activeElement.id, "candidate-search");
});
