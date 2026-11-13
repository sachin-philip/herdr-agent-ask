// asks.trailing=off: a terminal whose questions another tool cards makes no finished-turn
// card here. The engine runs against the scripted "herdr" (tests/herdr-stub.mjs).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Engine } from "../mods/tabs-asks/engine.js";
import { readState, update } from "../mods/tabs-asks/state.js";
import { resetHerdr } from "./herdr-stub.mjs";

const H = globalThis.__herdr;
const fixture = (n) => fs.readFileSync(new URL(`./fixtures/${n}.txt`, import.meta.url), "utf8");
const cx = { notify() {}, spawn: (fn) => (cx.last = fn(cx)), timer: { after: (_ms, cb) => queueMicrotask(cb), every() {} } };
const terminal = (labels = {}, turn = 1, state = "done") => ({ address: "t1", state: "live", name: "worker", cwd: "/repo", turn,
  labels: { "herdr.space": "sp1", where: "Cyborg / 3", ...labels }, status: { app: "claude-code", state } });
const off = { "asks.trailing": "off" };
const model = { asks: true, kind: "QUESTION", question: "Which one?", options: ["A", "B"], questions: [], recommended: 0, context: "", confidence: 0.9 };
const pending = () => readState().asks.filter((a) => a.state === "pending");

// An engine that has started, with the finished-turn check on and the model answering.
const engine = (onClassify) => {
  const e = Object.assign(new Engine(), { config: { classify: "on", toast: false }, started: true });
  e.classify = async () => { onClassify?.(); return model; };
  return e;
};

beforeEach(() => {
  resetHerdr();
  H.hc = async (args) => (args[0] === "read" ? { code: 0, stdout: JSON.stringify({ text: fixture("claude-question") }), stderr: "" } : { code: 0, stdout: "", stderr: "" });
});

test("a finished turn makes a card when the terminal isn't labelled", async () => {
  H.terminals = [terminal()];
  engine().tick(cx); await cx.last;
  assert.deepEqual(pending().map((a) => a.id), ["t1:p:1"]);
});

test("a labelled terminal's finished turn isn't checked, and is once the label comes off", async () => {
  H.terminals = [terminal(off)];
  const e = engine();
  const checked = [];
  const real = e.checkTurn.bind(e);
  e.checkTurn = (t, agent, c) => { checked.push(t.address); return real(t, agent, c); };
  e.tick(cx); e.tick(cx);
  assert.deepEqual(checked, []);
  assert.deepEqual(readState().checked, [], "not marked checked while labelled");
  H.terminals = [terminal()];
  e.tick(cx); await cx.last;
  assert.deepEqual(checked, ["t1"], "the turn it ended on is checked once the label is off");
  assert.deepEqual(pending().map((a) => a.id), ["t1:p:1"]);
});

test("a card made before the label goes, noted Asked elsewhere; a STOPPED card stays", () => {
  const real = Date.now;
  let now = real();
  Date.now = () => now;
  try {
    update((s) => {
      s.asks = [
        { id: "t1:p:1", address: "t1", turn: 1, state: "pending", kind: "QUESTION", delivery: "send", question: "Which one?", options: [], detected_at: now },
        { id: "t1:e:1", address: "t1", turn: 1, state: "pending", kind: "STOPPED", stopped: true, delivery: "send", question: "API Error", options: [], detected_at: now },
      ];
    });
    H.terminals = [{ ...terminal(off), status: { app: "claude-code", state: "error", msg: "API Error" } }];
    const e = engine();
    e.tick(cx);
    now += 3100;
    e.tick(cx);
    const byId = Object.fromEntries(readState().asks.map((a) => [a.id, a]));
    assert.equal(byId["t1:p:1"].state, "stale");
    assert.equal(byId["t1:p:1"].note, "Asked elsewhere");
    assert.equal(byId["t1:e:1"].state, "pending", "an error isn't a question asked elsewhere");
  } finally {
    Date.now = real;
  }
});

test("a label that comes while the model reads the turn: no card", async () => {
  H.terminals = [terminal()];
  engine(() => { H.terminals = [terminal(off)]; }).tick(cx); await cx.last;
  assert.deepEqual(pending(), []);
});
