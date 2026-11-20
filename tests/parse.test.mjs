// The screen and report parsers against real screens (tests/fixtures), with plain Node:
//   node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseLastMessage, parseClaudeMessage, parseCodexMessage, parseScreen, parseReport, normalize } from "../mods/tabs-asks/parse.js";

const fixture = (name) => fs.readFileSync(new URL(`./fixtures/${name}.txt`, import.meta.url), "utf8");

test("Claude Code: a finished turn that asks a plain-text question", () => {
  const r = parseLastMessage(fixture("claude-question"), "claude-code");
  assert.equal(r.hasQuestion, true);
  assert.match(r.message, /Should the todo app store tasks in SQLite or in a JSON file\?/);
  assert.match(r.message, /2\. JSON file/);
  assert.doesNotMatch(r.message, /Ask me, as plain text/, "the person's own prompt is not part of the message");
  assert.doesNotMatch(r.message, /Brewed for/, "the done footer is dropped");
});

test("Claude Code: text typed into the prompt box but not sent is not the last prompt", () => {
  const screen = fixture("claude-question");
  const withDraft = screen.replace(/\n❯\s*\n/, "\n❯ my unsent draft\n");
  assert.notEqual(withDraft, screen, "fixture has an empty prompt box to fill");
  const r = parseLastMessage(withDraft, "claude-code");
  assert.equal(r.hasQuestion, true);
  assert.match(r.message, /SQLite or in a JSON file\?/);
});

test("Claude Code: several numbered questions in one message, only the last turn", () => {
  const r = parseLastMessage(fixture("claude-multi-question"), "claude-code");
  assert.equal(r.hasQuestion, true);
  assert.match(r.message, /1\. Who uses the todo app\?/);
  assert.match(r.message, /3\. How should completed tasks be handled\?/);
  assert.match(r.message, /Command line \(recommended\)/);
  assert.doesNotMatch(r.message, /SQLite or in a JSON file/, "the previous turn is not included");
});

test("Claude Code: an AskUserQuestion dialog on screen", () => {
  const d = parseScreen(fixture("claude-dialog"));
  assert.equal(d.question, "Which colour should the heading be?");
  assert.deepEqual(d.options.slice(0, 3).map((o) => [o.n, o.label, o.detail]), [
    [1, "Green (Recommended)", "Recommended colour for the heading."],
    [2, "Red", "Use red for the heading."],
    [3, "Blue", "Use blue for the heading."],
  ]);
  assert.equal(d.cursor, 1, "the cursor sits on option 1");
});

test("Claude Code: the status report carries the dialog, no model needed", () => {
  const q = parseReport({ kind: "question", msg: "answer: Which colour should the heading be? (Green (Recommended) · Red · Blue)" });
  assert.equal(q.kind, "DECISION");
  assert.equal(q.question, "Which colour should the heading be?");
  assert.deepEqual(q.options.map((o) => o.label), ["Green (Recommended)", "Red", "Blue"]);
  assert.equal(q.recommended, 0);
  const p = parseReport({ kind: "permission", msg: "approve Bash: rm -rf build" });
  assert.equal(p.kind, "APPROVAL");
  assert.equal(p.question, "Allow Bash: rm -rf build");
  assert.equal(parseReport({}), null);
});

test("Codex: a finished turn that asks a question with bullet answers", () => {
  const r = parseLastMessage(fixture("codex-question"), "codex");
  assert.equal(r.hasQuestion, true);
  assert.match(r.message, /^Question: What would you like Herdr to help you do\?/);
  assert.match(r.message, /• Track what each agent is working on/);
  assert.doesNotMatch(r.message, /Worked for/, "the footer is dropped");
  assert.doesNotMatch(r.message, /Ask Codex to do anything/, "the input box is not the prompt");
});

test("Codex: a reply without a question, and the content fallback when the app is unknown", () => {
  const r = parseLastMessage(fixture("codex-no-question"), "codex");
  assert.equal(r.hasQuestion, false);
  assert.match(r.message, /^Got it/);
  assert.deepEqual(parseLastMessage(fixture("codex-no-question"), null), r, "no app report: Codex's format is found by content");
  assert.equal(parseClaudeMessage(fixture("codex-no-question")).message, "", "Claude's parser finds no prompt on a Codex screen");
});

test("Codex: text typed into the input box but not sent is not the last prompt", () => {
  const withDraft = fixture("codex-question").replace("› Ask Codex to do anything", "› my unsent draft");
  const r = parseCodexMessage(withDraft);
  assert.match(r.message, /^Question: What would you like Herdr/);
});

test("normalize: a list of questions never becomes clickable options", () => {
  const n = normalize({ asks: true, options: ["What A?", "What B?", "Also C?"], questions: [], recommended: 0 });
  assert.deepEqual(n.options, []);
  assert.equal(n.recommended, null);
  assert.deepEqual(n.questions.map((q) => q.text), ["What A?", "What B?", "Also C?"]);
});

test("normalize: real options stay, and per-question options are cleaned", () => {
  const n = normalize({ asks: true, options: ["SQLite", "JSON file"], questions: [], recommended: 0 });
  assert.deepEqual(n.options, ["SQLite", "JSON file"]);
  assert.equal(n.recommended, 0);
  const m = normalize({ asks: true, options: [], questions: [{ text: "Who?", options: ["A", "B"], recommended: 7 }, { text: "Which?", options: ["C"], recommended: 0 }], recommended: null });
  assert.deepEqual(m.questions.map((q) => [q.text, q.options, q.recommended]), [["Who?", ["A", "B"], null], ["Which?", ["C"], 0]]);
  assert.equal(normalize(null), null);
});
