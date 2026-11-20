// A turn that stopped on an error (no connection, the API down) or a logged-out agent: the
// status reports and screens are from Claude Code 2.1.323/2.1.325 with a dead endpoint and
// an invalid token. The engine runs against the scripted "herdr" (tests/herdr-stub.mjs).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Engine } from "../mods/tabs-asks/engine.js";
import { parseReport, parseLastMessage } from "../mods/tabs-asks/parse.js";
import { readState, stillIdle } from "../mods/tabs-asks/state.js";
import { resetHerdr } from "./herdr-stub.mjs";

const H = globalThis.__herdr;
const fixture = (n) => fs.readFileSync(new URL(`./fixtures/${n}.txt`, import.meta.url), "utf8");
const ERROR = "API Error: Connection refused — a firewall or proxy may be blocking it (ECONNREFUSED)";
const AUTH = "Please run /login · API Error: 401 Invalid bearer token";
const cx = { spawn() {}, notify() {} };
const engine = () => Object.assign(new Engine(), { config: { classify: "off", toast: false } });
const terminal = (status, turn = 1) => ({ address: "t1", state: "live", name: "worker", cwd: "/repo", turn, labels: { "herdr.space": "sp1", where: "Cyborg / 3" }, status });
const pending = () => readState().asks.filter((a) => a.state === "pending");

beforeEach(() => resetHerdr());

test("the screens are what the reports say", () => {
  assert.match(parseLastMessage(fixture("claude-api-error"), "claude-code").message, /^API Error: Connection refused/);
  assert.match(parseLastMessage(fixture("claude-login-error"), "claude-code").message, /^Please run \/login/);
});

test("an error report makes one STOPPED card with Continue", () => {
  H.terminals = [terminal({ app: "claude-code", state: "error", msg: ERROR })];
  const e = engine();
  e.tick(cx); e.tick(cx);
  const [ask, ...rest] = pending();
  assert.equal(rest.length, 0, "one card however often the engine looks");
  assert.equal(ask.id, "t1:e:1");
  assert.equal(ask.kind, "STOPPED");
  assert.equal(ask.question, ERROR);
  assert.equal(ask.delivery, "send");
  assert.deepEqual(ask.options, [{ n: 1, label: "Continue", send: "continue", detail: "" }]);
  assert.equal(ask.space, "sp1");
  assert.equal(stillIdle(ask), true, "Continue may be sent while the error stands");
});

test("the card goes once the agent works again, and a new error on the next turn makes a new one", () => {
  const real = Date.now;
  let now = real();
  Date.now = () => now;
  try {
    H.terminals = [terminal({ app: "claude-code", state: "error", msg: ERROR })];
    const e = engine();
    e.tick(cx);
    H.terminals = [terminal({ app: "claude-code", state: "working" }, 2)];
    e.tick(cx);
    assert.equal(pending().length, 1, "not at once: a report can lag");
    now += 3100;
    e.tick(cx);
    assert.equal(pending().length, 0);
    assert.equal(readState().asks[0].note, "Continued in terminal");
    H.terminals = [terminal({ app: "claude-code", state: "error", msg: ERROR }, 2)];
    e.tick(cx);
    assert.deepEqual(pending().map((a) => a.id), ["t1:e:2"]);
  } finally { Date.now = real; }
});

test("a logged-out agent makes a STOPPED card without answers", () => {
  const report = { app: "claude-code", state: "blocked", kind: "auth", msg: AUTH };
  assert.deepEqual(parseReport(report), { kind: "STOPPED", question: `Logged out: run /login in the terminal. (${AUTH})`, options: [], recommended: null, source: "report" });
  H.terminals = [terminal(report)];
  const e = engine();
  e.tick(cx);
  const [ask] = pending();
  assert.equal(ask.kind, "STOPPED");
  assert.equal(ask.options.length, 0);
  assert.equal(ask.enriched, true, "nothing to read off the screen");
});
