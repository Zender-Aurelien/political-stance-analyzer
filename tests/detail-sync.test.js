import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { JSDOM } from "jsdom";

const html = await fs.readFile(new URL("../index.html", import.meta.url), "utf8");

async function setup() {
  const dom = new JSDOM(html, { url: "http://localhost/" });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  const dialog = document.querySelector("#candidate-detail");
  dialog.showModal = () => { dialog.open = true; };
  const detail = await import(`../JS/detail.js?test=${Math.random()}`);
  detail.initDetails();
  return { dom, dialog, ...detail };
}

test("profile opens immediately, then fills sourced background and legislation as safe text", async () => {
  const { dialog, openDetail } = await setup();
  let finish;
  globalThis.fetch = () => new Promise(resolve => { finish = resolve; });
  const candidate = { id: "example", name: "Example", party: "Democratic", office: "Senator", district: "New York · District 17", dataSource: "live", positions: [], sources: [], profileUrl: "/api/candidates/example/profile?zip=11214" };
  openDetail(candidate);
  assert.ok(dialog.open);
  assert.match(document.querySelector("#detail-sync-status").textContent, /Checking official/);
  finish({ ok: true, json: async () => ({ ...candidate, bio: "An attributed biography.", biographySource: "https://www.nysenate.gov/senators/example/about", biographyMode: "official_excerpt", profileStatus: "synced", profileCheckedAt: "2026-11-22T09:00:00Z", policyEvidence: [{ title: '<img src=x onerror="bad()"> School funding', url: "https://www.nysenate.gov/legislation/bills/2025/S123", kind: "Co-sponsor", date: "2026-01-01" }, { title: "Unsafe link", url: "javascript:alert(1)", kind: "Sponsor" }] }) });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(document.querySelector("#detail-bio").textContent, /An attributed biography/);
  assert.equal(document.querySelector("#detail-bio-source a").hostname, "www.nysenate.gov");
  assert.equal(document.querySelectorAll("#detail-positions li").length, 1);
  assert.equal(document.querySelector("#detail-positions img"), null);
  assert.match(document.querySelector("#detail-positions").textContent, /Co-sponsor/);
  assert.match(document.querySelector("#detail-policy-heading").textContent, /legislative activity/);
});

test("a delayed previous profile cannot overwrite the next person", async () => {
  const { openDetail } = await setup();
  let finish;
  globalThis.fetch = () => new Promise(resolve => { finish = resolve; });
  const candidate = { id: "first", name: "First person", party: "Democratic", office: "Senator", district: "New York", positions: [], sources: [], profileUrl: "/api/candidates/first/profile" };
  openDetail(candidate);
  openDetail({ ...candidate, id: "second", name: "Second person", profileUrl: null });
  finish({ ok: true, json: async () => ({ ...candidate, bio: "First person's background" }) });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(document.querySelector("#detail-name").textContent, "Second person");
  assert.ok(!document.querySelector("#detail-bio").textContent.includes("First person's"));
});
