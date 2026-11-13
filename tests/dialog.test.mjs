// Claude Code's AskUserQuestion dialog with several questions (one tab each), and the
// permission dialog's rows, against real screens (tests/fixtures):
//   node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseTabs, parseTab, optionRows } from "../mods/tabs-asks/dialog.js";
import { parseScreen, parseLastMessage } from "../mods/tabs-asks/parse.js";

const fixture = (name) => fs.readFileSync(new URL(`./fixtures/${name}.txt`, import.meta.url), "utf8");
const labels = (tab) => tab.options.map((o) => [o.n, o.label, o.detail]);

test("dialog.js: the two copies are identical and import nothing from Herdr", () => {
  const a = fs.readFileSync(new URL("../mods/asks/dialog.js", import.meta.url), "utf8");
  const b = fs.readFileSync(new URL("../mods/tabs-asks/dialog.js", import.meta.url), "utf8");
  assert.equal(a, b);
  assert.doesNotMatch(a, /from "herdr"/);
});

test("tabs: one per question, in order, none answered yet", () => {
  assert.deepEqual(parseTabs(fixture("claude-tabs-colour")), [
    { header: "Colour", answered: false }, { header: "Toppings", answered: false }, { header: "Size", answered: false },
  ]);
  const later = fixture("claude-tabs-size").replace("☐ Colour  ☐ Toppings", "☒ Colour  ☒ Toppings");
  assert.deepEqual(parseTabs(later).map((x) => x.answered), [true, true, false]);
});

test("tabs: none on a one-question dialog, a permission dialog or a plain turn", () => {
  assert.equal(parseTabs(fixture("claude-dialog")), null);
  assert.equal(parseTabs(fixture("claude-permission")), null);
  assert.equal(parseTabs(fixture("claude-question")), null);
});

test("tabs: a bar above the person's last prompt is an old dialog, not this one", () => {
  const old = fixture("claude-tabs-colour") + "\n❯ thanks, now do the next thing\n\n● On it.\n";
  assert.equal(parseTabs(old), null);
  assert.equal(parseTab(old), null);
});

test("tab: a single pick, its recommendation and its typed-answer row", () => {
  const t = parseTab(fixture("claude-tabs-colour"));
  assert.equal(t.question, "Which colour?");
  assert.deepEqual(labels(t), [[1, "Red", "Red"], [2, "Green (Recommended)", "Green"], [3, "Blue", "Blue"]]);
  assert.equal(t.recommended, 1);
  assert.equal(t.other, 4, "Type something is a row of its own, not an option");
  assert.equal(t.cursor, 1);
  assert.equal(t.multi, false);
  assert.equal(t.review, false);
});

test("tab: several picks, with what is ticked", () => {
  const screen = fixture("claude-tabs-toppings");
  const t = parseTab(screen);
  assert.equal(t.question, "Which toppings?");
  assert.equal(t.multi, true);
  assert.deepEqual(labels(t), [[1, "Cheese", "Cheese topping"], [2, "Basil", "Basil topping"], [3, "Olives", "Olives topping"]]);
  assert.deepEqual(t.options.map((o) => o.checked), [false, false, false]);
  assert.equal(t.other, 4);
  const ticked = parseTab(screen.replace("[ ] Cheese", "[✔] Cheese").replace("[ ] Olives", "[✔] Olives"));
  assert.deepEqual(ticked.options.map((o) => o.checked), [true, false, true]);
});

test("tab: the last question's numbering", () => {
  const t = parseTab(fixture("claude-tabs-size"));
  assert.equal(t.question, "Which size?");
  assert.deepEqual(t.options.map((o) => o.label), ["Small", "Large"]);
  assert.equal(t.other, 3);
  assert.equal(t.recommended, null);
});

test("tab: the review page, and whether an answer is missing", () => {
  const screen = fixture("claude-tabs-review");
  const t = parseTab(screen);
  assert.equal(t.review, true);
  assert.equal(t.submit, 1);
  assert.equal(t.incomplete, true);
  assert.equal(parseTab(screen.replace(/^.*not answered all.*$/m, "")).incomplete, false);
});

test("tab: the bar Claude Code draws before a question is not part of it", () => {
  const t = parseTab(fixture("claude-tabs-bar"));
  assert.equal(t.question, "Which settings layout should the demo app use when someone opens it for the first time on a small laptop screen?");
  assert.deepEqual(t.options.map((o) => o.label), [
    "One long page with every setting grouped under clear headings",
    "Tabs across the top, one for each group of settings",
    "A search box first, with the most used settings listed below it",
  ]);
  assert.equal(t.options[0].detail, "Simple to scan, though the page grows long as more settings arrive");
  assert.equal(t.other, 4);
  assert.equal(t.cursor, 1);
});

test("tab: a question too long for the terminal's width is read whole", () => {
  const long = "Which settings layout should the demo app use when someone opens it for the first time on a small laptop screen?";
  // The same screen in a narrower pane, where the question runs on over two lines.
  const narrow = fixture("claude-tabs-bar").replace(`│ ${long}`, "│ Which settings layout should the demo app use when someone opens\n│ it for the first time on a small laptop screen?");
  assert.notEqual(narrow, fixture("claude-tabs-bar"));
  assert.equal(parseTab(narrow).question, long);
  const plain = fixture("claude-tabs-size").replace("Which size?", "Which size should the pizza be, given that\nfour people are sharing it?");
  assert.equal(parseTab(plain).question, "Which size should the pizza be, given that four people are sharing it?");
  // A blank line ends the question: the review page's notes aren't part of it.
  assert.equal(parseTab(fixture("claude-tabs-review")).question, "Review your answers");
});

test("tab: one question with several picks gets a tab bar too", () => {
  const screen = fixture("claude-tabs-one-question");
  assert.deepEqual(parseTabs(screen), [{ header: "Toppings", answered: false }]);
  const t = parseTab(screen);
  assert.equal(t.multi, true);
  assert.deepEqual(t.options.map((o) => o.label), ["Cheese", "Basil", "Olives"]);
});

test("permission dialog: its rows and the cursor, to move to No", () => {
  const r = optionRows(fixture("claude-permission"));
  assert.equal(r.cursor, 1);
  assert.deepEqual(r.options.map((o) => o.n), [1, 2, 3]);
  assert.equal(r.options[2].label, "No");
  assert.match(fixture("claude-permission"), /Tab to amend/, "the dialog takes a reason with a no");
});

test("a dialog's cursor line (❯ 1. Red) is not the person's last prompt", () => {
  const screen = fixture("claude-tabs-colour");
  assert.doesNotMatch(parseLastMessage(screen, "claude-code").message, /^1\. Red/);
  assert.match(parseLastMessage(screen, "claude-code").message, /Which colour\?/);
});

test("Claude Code's ● bullet (Linux) counts like ⏺ (macOS)", () => {
  assert.equal(parseScreen(fixture("claude-permission")).context, "Writing note3.txt");
  assert.equal(parseScreen(fixture("claude-permission").replace("● Writing", "⏺ Writing")).context, "Writing note3.txt");
});
