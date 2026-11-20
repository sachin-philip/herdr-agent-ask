// Which CLI reads plain-text questions, and what happens with none: the engine itself, run
// against a scripted "herdr" (tests/herdr-stub.mjs). No real CLI is started.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Engine, NOTICE_ID } from "../mods/tabs-asks/engine.js";
import { readState } from "../mods/tabs-asks/state.js";
import { resetHerdr } from "./herdr-stub.mjs";

const H = globalThis.__herdr;
const CLAUDE_OUT = JSON.stringify({ structured_output: { asks: true, kind: "QUESTION", question: "Tabs or spaces?", options: ["Tabs", "Spaces"], questions: [], recommended: 1, context: "Asked about indentation.", confidence: 0.95 } });
const CODEX_OUT = ["hook: SessionStart", "codex", '{"asks":true,"kind":"QUESTION","question":"Tabs or spaces?","options":["Tabs","Spaces"],"questions":[],"recommended":1,"context":"Asked about indentation.","confidence":1}', "tokens used", "17,016",
  '{"asks":true,"kind":"QUESTION","question":"Tabs or spaces?","options":["Tabs","Spaces"],"questions":[],"recommended":1,"context":"Asked about indentation.","confidence":1}'].join("\n");

// A machine with the given CLIs: `claude` on PATH or not; codex copies as "path version" lines.
function machine({ claude = false, codex = [] } = {}) {
  const calls = [];
  H.exec = async (cmd, args) => {
    calls.push([cmd, ...args]);
    const script = cmd === "sh" ? args[1] ?? "" : "";
    if (cmd === "sh" && script.includes("command -v claude")) return claude ? { code: 0, stdout: "claude\n", stderr: "" } : { code: 1, stdout: "", stderr: "" };
    if (cmd === "sh" && script.includes("for b in")) return { code: codex.length ? 0 : 1, stdout: codex.map((c) => `${c}\n`).join(""), stderr: "" };
    if (cmd === "claude") return claude ? { code: 0, stdout: CLAUDE_OUT, stderr: "" } : { code: 127, stdout: "", stderr: "command not found: claude" };
    if (cmd === "sh" && script.includes("exec --ephemeral")) return codex.length ? { code: 0, stdout: CODEX_OUT, stderr: "" } : { code: 127, stdout: "", stderr: "not found" };
    return { code: 127, stdout: "", stderr: `unexpected ${cmd}` };
  };
  return calls;
}
const engine = (config = {}) => Object.assign(new Engine(), { config: { classifier: "auto", model: "haiku", ...config } });

beforeEach(() => resetHerdr());

test("Claude only: the Claude CLI reads the question, started lean", async () => {
  const calls = machine({ claude: true });
  const e = engine();
  assert.equal(await e.backend(), "claude");
  const out = await e.classify("Should we use tabs or spaces?", { app: "claude-code" }, "message");
  assert.equal(out.asks, true);
  assert.deepEqual(out.options, ["Tabs", "Spaces"]);
  const call = calls.find((c) => c[0] === "claude");
  assert.ok(call.includes("--setting-sources"), "no user settings, for a fast start");
  assert.ok(call.includes("--strict-mcp-config"), "no MCP servers");
  assert.equal(readState().asks.some((a) => a.id === NOTICE_ID), false);
});

test("Codex only: codex exec reads the question, with the newest codex on the machine", async () => {
  const calls = machine({ codex: ["/Users/me/.local/bin/codex codex-cli 0.149.0", "/opt/homebrew/bin/codex codex-cli 0.167.0"] });
  const e = engine();
  assert.equal(await e.backend(), "codex");
  assert.equal(await e.codexBin(), "/opt/homebrew/bin/codex");
  const out = await e.classify("Should we use tabs or spaces?", { app: "codex" }, "message");
  assert.equal(out.asks, true);
  assert.equal(out.recommended, 1);
  const call = calls.find((c) => c[0] === "sh" && String(c[2]).includes("exec --ephemeral"));
  assert.ok(call, "codex exec was run");
  assert.ok(call.includes("/opt/homebrew/bin/codex"), "the newest binary, not the first on PATH");
  assert.equal(calls.some((c) => c[0] === "claude"), false, "claude was never tried");
  assert.equal(readState().asks.some((a) => a.id === NOTICE_ID), false);
});

test("both installed: Claude by default, Codex when the config says so", async () => {
  machine({ claude: true, codex: ["/opt/homebrew/bin/codex codex-cli 0.167.0"] });
  assert.equal(await engine().backend(), "claude");
  assert.equal(await engine({ classifier: "codex" }).backend(), "codex");
  assert.equal(await engine({ classifier: "claude" }).backend(), "claude");
  const out = await engine({ classifier: "codex" }).classify("Tabs or spaces?", { app: "claude-code" }, "message");
  assert.equal(out.question, "Tabs or spaces?");
});

test("neither installed: no model call, and one notice card that says which agents are supported", async () => {
  const calls = machine();
  const e = engine();
  assert.equal(await e.backend(), null);
  assert.equal(await e.classify("Tabs or spaces?", { app: "claude-code" }, "message"), null);
  assert.equal(calls.some((c) => c[0] === "claude" || String(c[2] ?? "").includes("exec --ephemeral")), false, "nothing was started");
  const notices = readState().asks.filter((a) => a.id === NOTICE_ID);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].state, "pending");
  assert.equal(notices[0].notice, true);
  assert.match(notices[0].question, /Claude Code or Codex/);
  assert.match(notices[0].question, /More agents are coming/);
  await engine().backend();
  assert.equal(readState().asks.filter((a) => a.id === NOTICE_ID).length, 1, "asked again: still one card");
});

test("the notice survives the engine's tick and goes once a CLI turns up", async () => {
  machine();
  const e = engine();
  await e.backend();
  H.terminals = [{ address: "t1", state: "live", status: { app: "claude-code", state: "idle" }, turn: 3, labels: {} }];
  const cx = { spawn() {}, notify() {}, timer: { after() {}, every() {} } };
  e.tick(cx); e.tick(cx);
  assert.equal(readState().asks.find((a) => a.id === NOTICE_ID)?.state, "pending", "the stale pass leaves it alone");
  machine({ claude: true });
  await engine().backend();
  assert.equal(readState().asks.some((a) => a.id === NOTICE_ID), false, "gone once claude is found");
});
