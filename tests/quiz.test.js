import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { JSDOM } from "jsdom";

const html = await fs.readFile(new URL("../index.html", import.meta.url), "utf8");
const questions = JSON.parse(await fs.readFile(new URL("../data/quiz.json", import.meta.url)));
const candidates = JSON.parse(await fs.readFile(new URL("../data/candidates.json", import.meta.url)));
let serial = 0;
let failMatch = false;
let submissions = [];

globalThis.fetch = async (url, options = {}) => {
  const path = String(url);
  if (path.endsWith("/match")) {
    if (failMatch) throw new Error("offline");
    submissions.push(JSON.parse(options.body));
    return { ok: true, json: async () => candidates.map((candidate, index) => ({
      candidate_id: candidate.id, match_pct: 95 - index * 5,
      explanation: "A comparison returned by the backend.",
    })) };
  }
  const data = path.includes("quiz") ? questions : candidates;
  return { ok: true, json: async () => structuredClone(data) };
};

async function boot(saved = {}) {
  const dom = new JSDOM(html, { url: "http://localhost:8000" });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  for (const key of ["window", "document", "localStorage", "CustomEvent", "Event"])
    globalThis[key] = dom.window[key];
  for (const [key, value] of Object.entries(saved)) localStorage.setItem(key, value);
  const cards = await import(`../JS/candidates.js?test=${++serial}`);
  const quiz = await import(`../JS/quiz.js?test=${serial}`);
  await quiz.initQuiz();
  cards.renderCards(candidates);
  return dom;
}
const $ = selector => document.querySelector(selector);
const click = selector => { assert.ok($(selector), selector); $(selector).click(); };
const savedState = () => Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)]));
function input(value) { const field = $("#quiz-step input"); field.value = value; field.dispatchEvent(new Event("input")); }
async function settle() { await new Promise(resolve => setTimeout(resolve, 30)); }
function finishQuestions() {
  for (let count = 0; count < questions.length && $("#quiz-next"); count++) {
    const radio = $(".quiz-likert input[value='2']");
    if (radio) radio.click();
    click("#quiz-next");
  }
}

test("quiz validates, resumes, uses backend results, restores results, and clears badges on retake", async () => {
  await boot();
  assert.equal($("#quiz-container").hidden, true);
  click("#quiz-toggle-btn");
  input("abc"); click("#quiz-next");
  assert.equal($("#quiz-error").hidden, false);
  input("90210"); click("#quiz-next");
  assert.match($("#quiz-error").textContent, /New York/);
  input("10027"); click("#quiz-next");
  click("input[value='25_34']"); click("#quiz-next");
  // Optional context can be skipped; required policy answers cannot.
  while (!$(".quiz-likert")) click("#quiz-next");
  const prompt = $(".quiz-prompt").textContent;
  click("#quiz-next");
  assert.equal($(".quiz-prompt").textContent, prompt);
  assert.equal($("#quiz-error").hidden, false);
  click(".quiz-likert input[value='0']");
  click("#quiz-next");
  click("#quiz-back");
  assert.equal($(".quiz-likert input[value='0']").checked, true);
  assert.ok(Number($("[role='progressbar']").getAttribute("aria-valuenow")) > 0);
  click("#quiz-toggle-btn"); click("#quiz-toggle-btn");
  assert.equal($(".quiz-prompt").textContent, prompt);
  const draft = savedState();
  await boot(draft); click("#quiz-toggle-btn");
  assert.equal($(".quiz-prompt").textContent, prompt);
  finishQuestions(); await settle();
  assert.equal($(".quiz-results-title").textContent, "Your Values Match");
  assert.match($("#quiz-score-notice").textContent, /Scored by the backend/);
  assert.equal(document.querySelectorAll(".quiz-result-item").length, candidates.length);
  assert.equal(document.querySelectorAll(".candidate-match-badge").length, candidates.length);
  assert.equal($(".result-explanation").textContent, "A comparison returned by the backend.");
  assert.equal($("[role='progressbar']").getAttribute("aria-valuenow"), "100");
  assert.ok(submissions.length);
  assert.ok(!JSON.stringify(submissions.at(-1)).includes("25_34"));
  assert.ok(Object.keys(submissions.at(-1).answers).every(topic => !topic.startsWith("q_")));
  assert.equal($(".breakdown-body").hidden, true);
  click(".breakdown-toggle"); assert.equal($(".breakdown-body").hidden, false);
  const topicRows = () => [...$(".breakdown-body").querySelectorAll("tbody tr")].filter(row => !row.hidden);
  assert.equal(topicRows().length, 3);
  click(".breakdown-show-all");
  assert.equal(topicRows().length, 9);
  click(".breakdown-show-all");
  assert.equal(topicRows().length, 3);
  assert.equal($(".breakdown-method").open, false);
  assert.equal($(".comparison-rail"), null);
  const completed = savedState();
  await boot(completed); click("#quiz-toggle-btn"); await settle();
  assert.ok($(".quiz-results-title"));
  click("#quiz-retake");
  assert.equal(document.querySelectorAll(".candidate-match-badge").length, 0);
  assert.equal(localStorage.getItem("cl_quiz_result"), null);
  assert.equal(localStorage.getItem("cl_quiz_answers"), null);
  assert.equal($("[role='progressbar']").getAttribute("aria-valuenow"), "0");
});

test("backend outage shows labeled local scores and still allows a retake", async () => {
  failMatch = true;
  await boot(); click("#quiz-toggle-btn");
  finishQuestions(); await settle();
  assert.match($("#quiz-score-notice").textContent, /Backend unavailable/);
  assert.equal(document.querySelectorAll(".quiz-result-item").length, candidates.length);
  click("#quiz-retake");
  assert.ok($("#q_zip_input"));
  failMatch = false;
});

test("malformed saved answers cannot inject markup or skip required questions", async () => {
  await boot({ cl_quiz_progress: JSON.stringify({ step: 999, answers: { q_zip: '<img src=x onerror=alert(1)>', q_age: 'unknown' } }) });
  click("#quiz-toggle-btn");
  assert.equal($(".quiz-question").dataset.qid, questions.find(q => !q.optional).id);
  assert.equal($("#quiz-step img"), null);
  click("#quiz-next");
  assert.equal($("#quiz-error").hidden, false);
});
