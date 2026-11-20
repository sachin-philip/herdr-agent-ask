// Several-question dialogs ("wizards") and declined dialogs, against real screens.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { wizardOn, declinedOn } from "../mods/asks/state.js";
import { parseLastMessage, parseScreen } from "../mods/tabs-asks/parse.js";

const fixture = (name) => fs.readFileSync(new URL(`./fixtures/${name}.txt`, import.meta.url), "utf8");

test("wizard: the tab bar names the questions", () => {
  assert.deepEqual(wizardOn(fixture("claude-wizard")), ["Colour", "Size"]);
});

test("wizard: a single-question dialog and a plain turn have no tab bar", () => {
  assert.equal(wizardOn(fixture("claude-dialog")), null);
  assert.equal(wizardOn(fixture("claude-question")), null);
});

test("declined: Esc on a dialog leaves 'User declined' in the current turn", () => {
  assert.equal(declinedOn(fixture("claude-declined-single")), true);
  assert.equal(declinedOn(fixture("claude-declined")), true);
});

test("declined: a dialog still up, or an interruption from an earlier turn, is not a decline", () => {
  assert.equal(declinedOn(fixture("claude-dialog")), false);
  const old = "❯ do x\n⏺ Interrupted · What should Claude do instead?\n❯ now answer me\n⏺ AskUserQuestion\n❯ 1. Green\n  2. Red\n⏺ User answered Which colour? with Green\n⏺ Working on it";
  assert.equal(declinedOn(old), false);
});

test("a declined dialog's remnants are not the agent asking again", () => {
  const r = parseLastMessage(fixture("claude-declined"), "claude-code");
  assert.equal(r.message, "");
  assert.equal(r.hasQuestion, false);
});

test("boxed dialogs: borders come off and '>' is a cursor (PR #8)", () => {
  const boxed = "⏺ Confirm\n│ Are you sure you want to do this?\n│ > 1. Yes\n│   2. Yes, and don't ask again this session\n│   3. No, and tell CodeBuddy what to do differently\n";
  const d = parseScreen(boxed);
  assert.deepEqual(d.options.map((o) => o.label), ["Yes", "Yes, and don't ask again this session", "No, and tell CodeBuddy what to do differently"]);
  assert.equal(d.cursor, 1);
  assert.equal(d.question, "Are you sure you want to do this?");
});
