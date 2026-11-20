// The panel's delivery path (sendText, deliver, retry) and the engine's wizard reading, run
// against a scripted hc and a fake clock. No app, no agent, no model.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Asks from "../mods/asks/main.js";
import { Engine } from "../mods/tabs-asks/engine.js";
import { readState, update } from "../mods/asks/state.js";
import { resetHerdr } from "./herdr-stub.mjs";

const H = globalThis.__herdr;
const fixture = (name) => fs.readFileSync(new URL(`./fixtures/${name}.txt`, import.meta.url), "utf8");

// A fake clock: timer.after advances it instead of waiting, so an 8 s settle takes no time.
let clock = 0;
const realNow = Date.now;
const cx = { notify() {}, spawn: (fn) => (cx.last = fn(cx)), timer: { after: (ms, cb) => { clock += ms; queueMicrotask(cb); }, every() {} } };

// One idle Claude Code agent at `addr`, and the hc commands the panel sends it.
function agent(addr = "t1", { turn = 4, state = "idle", screen = "❯ done\n⏺ Which colour?\n" } = {}) {
  const a = { addr, turn, state, screen, msg: "" };
  H.terminals = [{ address: addr, state: "live", status: { app: "claude-code", state: a.state }, turn: a.turn, labels: {} }];
  const sync = () => { H.terminals[0].status.state = a.state; H.terminals[0].turn = a.turn; };
  a.calls = [];
  a.onSend = () => { a.state = "working"; return true; };          // the agent takes the message
  H.hc = async (args) => {
    a.calls.push(args.join(" "));
    const [cmd] = args;
    if (cmd === "get") return { code: 0, stdout: JSON.stringify({ state: "live", status: { app: "claude-code", state: a.state, msg: a.msg }, turn: a.turn }), stderr: "" };
    if (cmd === "read") return { code: 0, stdout: JSON.stringify({ text: a.screen }), stderr: "" };
    if (cmd === "send") { const started = a.onSend(args); sync(); return { code: 0, stdout: JSON.stringify({ started, status: a.state, turn: a.turn }), stderr: "" }; }
    if (cmd === "keys") { a.onKeys?.(args); sync(); return { code: 0, stdout: "", stderr: "" }; }
    return { code: 1, stdout: "", stderr: `unexpected ${cmd}` };
  };
  return a;
}
const panel = () => Object.assign(Object.create(Asks.prototype), { config: { log: "" }, input: { set_value() {}, focus() {} }, other: null, otherText: "", drafts: {}, boxes: {} });
const card = (addr = "t1", turn = 4) => { const ask = { id: `${addr}:p:${turn}`, address: addr, turn, state: "pending", delivery: "send", kind: "QUESTION", question: "Which colour?", options: [{ n: 1, label: "Green" }], msg: "", agent: "a", space_name: "S", cwd: "/tmp/x" }; update((s) => { s.asks = [ask]; }); return ask; };
const state = (id) => readState().asks.find((a) => a.id === id);

beforeEach(() => { resetHerdr(); clock = 0; Date.now = () => realNow() + clock; });

test("a message the agent takes: delivered as soon as it is working", async () => {
  const a = agent(); const ask = card(); const p = panel();
  p.sendText(ask, "Green", cx); await cx.last;
  assert.equal(state(ask.id).state, "delivered");
  assert.equal(state(ask.id).answer, "Green");
  assert.equal(a.calls.filter((c) => c.startsWith("send")).length, 1, "sent once");
});

test("a dropped paste (no turn started, text not in the box): sent once more, then delivered", async () => {
  const a = agent(); const ask = card(); const p = panel();
  let n = 0; a.onSend = () => { n++; if (n === 1) return false; a.state = "working"; return true; };
  p.sendText(ask, "Green", cx); await cx.last;
  assert.equal(state(ask.id).state, "delivered");
  const sends = a.calls.filter((c) => c.startsWith("send"));
  assert.equal(sends.length, 2);
  assert.ok(sends[1].includes("--force"), "the second attempt is forced");
});

test("text sitting unsent in the prompt box: Enter is pressed instead of sending twice", async () => {
  const a = agent(); const ask = card(); const p = panel();
  a.onSend = () => { a.screen = "⏺ Which colour?\n──\n❯ Green\n──\n"; return false; };
  a.onKeys = (args) => { if (args.includes("enter")) a.state = "working"; };
  p.sendText(ask, "Green", cx); await cx.last;
  assert.equal(state(ask.id).state, "delivered");
  assert.equal(a.calls.filter((c) => c.startsWith("send")).length, 1, "not sent again");
  assert.ok(a.calls.some((c) => c === "keys t1 enter"));
});

test("no reaction at all: the card fails with a message that says what to do", async () => {
  const a = agent(); const ask = card(); const p = panel();
  a.onSend = () => true;                                               // hc says started, agent never moves
  p.sendText(ask, "Green", cx); await cx.last;
  assert.equal(state(ask.id).state, "failed");
  assert.match(state(ask.id).error, /Not delivered/);
  assert.ok(clock >= 8000, "waited the full settle time on the fake clock");
});

test("the person declined in the terminal meanwhile: not delivered, not logged", async () => {
  const a = agent(); const ask = card(); const p = panel();
  a.onSend = () => { a.state = "working"; a.screen = "❯ do it\n⏺ User declined to answer questions\n  ⎿ · Which colour?\n"; return true; };
  p.sendText(ask, "Green", cx); await cx.last;
  assert.equal(state(ask.id).state, "stale");
  assert.equal(state(ask.id).note, "Declined in terminal");
});

test("Retry after the agent moved on: picked up late, never sent twice", async () => {
  const a = agent(); const ask = card(); const p = panel();
  update((s) => { Object.assign(s.asks[0], { state: "failed", sent_turn: 4, chosen: { text: "Green" } }); });
  a.turn = 5; H.terminals[0].turn = 5;
  p.retry(state(ask.id), cx);
  assert.equal(state(ask.id).state, "delivered");
  assert.equal(state(ask.id).note, "Picked up late");
  assert.equal(a.calls.filter((c) => c.startsWith("send")).length, 0);
});

test("an answer by key: the number is pressed and the dialog closing counts as delivered", async () => {
  const a = agent("t1", { state: "blocked" }); a.msg = "answer: Which colour? (Green · Red)";
  H.terminals[0].status.msg = a.msg; a.screen = fixture("claude-dialog");
  const ask = { id: "t1:4:abc", address: "t1", turn: 4, state: "pending", kind: "DECISION", question: "Which colour?", options: [{ n: 1, label: "Green (Recommended)" }, { n: 2, label: "Red" }], msg: a.msg, agent: "a", space_name: "S", cwd: "/tmp/x" };
  update((s) => { s.asks = [ask]; });
  a.onKeys = (args) => { if (args.includes("1")) { a.state = "working"; a.msg = ""; } };
  panel().answer(ask, ask.options[0], cx); await cx.last;
  assert.equal(state(ask.id).state, "delivered");
  assert.ok(a.calls.some((c) => c === "keys t1 1"));
  assert.equal(a.calls.some((c) => c.includes("enter")), false, "no fallback Enter when the number took");
});

test("a wizard on screen: no key is pressed, the card becomes the notice", async () => {
  const a = agent("t1", { state: "blocked", screen: fixture("claude-wizard") }); a.msg = "answer: Which colour? (Green (Recommended) · Red · Blue)";
  H.terminals[0].status.msg = a.msg;
  const ask = { id: "t1:4:wiz", address: "t1", turn: 4, state: "pending", kind: "DECISION", question: "Which colour?", options: [{ n: 1, label: "Green (Recommended)" }], msg: a.msg, agent: "a", space_name: "S", cwd: "/tmp/x" };
  update((s) => { s.asks = [ask]; });
  panel().answer(ask, ask.options[0], cx); await cx.last;
  const c = state(ask.id);
  assert.equal(c.wizard, true);
  assert.deepEqual(c.options, []);
  assert.match(c.question, /2 questions in one dialog: Colour · Size/);
  assert.equal(a.calls.some((c) => c.startsWith("keys")), false, "nothing pressed");
});

test("the engine reads a wizard off the screen into the notice card", async () => {
  const a = agent("t1", { state: "blocked", screen: fixture("claude-wizard") });
  update((s) => { s.asks = [{ id: "t1:4:w", address: "t1", turn: 4, state: "pending", kind: "DECISION", source: "report", question: "Which colour?", options: [{ n: 1, label: "Green (Recommended)" }], msg: "x" }]; });
  const e = Object.assign(new Engine(), { config: { classify: "off" } });
  e.enrich("t1:4:w", cx); await cx.last;
  const c = state("t1:4:w");
  assert.equal(c.wizard, true);
  assert.deepEqual(c.options, []);
});
