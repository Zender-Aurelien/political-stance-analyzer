import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createMatchDetails } from "../JS/match-details.js";
import { compareTopics, scoreCandidate } from "../JS/matching.js";

const candidate = {
  id: "sample", name: "Sample Person", zips: ["10027"],
  positions: [
    { topic: "housing", stance: "expand", description: "A recorded housing position." },
    { topic: "taxes", stance: "decrease", description: "A recorded tax position." },
    { topic: "climate", stance: "unverified", description: "No scorable stance." },
  ],
  sources: ["https://example.org/profile", "javascript:alert(1)"],
};

test("explanation uses the same topic gaps as scoring and preserves the server score calculation", () => {
  globalThis.document = new JSDOM().window.document;
  const answers = { housing: 2, taxes: 0, climate: 1 };
  assert.equal(scoreCandidate(candidate, answers, "10027"), 79);
  assert.deepEqual(compareTopics(candidate, answers).map(row => row.similarity), [100, 50]);
  const details = createMatchDetails(candidate, answers, { pct: 79, valuePct: 75, locationBoost: 4 }, "10027");
  document.body.append(details);
  assert.match(details.querySelector(".breakdown-method").textContent, /75% policy alignment \+ 4 ZIP points → 79% final match/);
  assert.equal(details.querySelectorAll("tbody tr").length, 2);
  assert.deepEqual([...details.querySelectorAll(".alignment-count")].map(node => node.textContent), ["1 close", "1 partial"]);
  const toggle = details.querySelector("button");
  const body = details.querySelector(".breakdown-body");
  assert.equal(toggle.getAttribute("aria-controls"), body.id);
  assert.equal(body.hidden, true);
  toggle.click();
  assert.equal(body.hidden, false);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  toggle.click();
  assert.equal(body.hidden, true);
  assert.equal(details.querySelectorAll("a").length, 1);
});

test("score is capped and descriptions and explanations render as text", () => {
  globalThis.document = new JSDOM().window.document;
  const profile = { ...candidate, positions: [{ topic: "housing", stance: "expand", description: '<img src=x onerror="alert(1)">' }] };
  const details = createMatchDetails(profile, { housing: 2 }, { pct: 100, valuePct: 100, locationBoost: 4, explanation: "<script>test</script>" }, "10027");
  assert.equal(scoreCandidate(profile, { housing: 2 }, "10027"), 100);
  assert.equal(details.querySelector("img"), null);
  assert.equal(details.querySelector("script"), null);
  assert.equal(details.querySelector(".result-explanation").textContent, "<script>test</script>");
});
