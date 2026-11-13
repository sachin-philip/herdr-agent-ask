// Detection and understanding. Runs inside the tab bar mod because that copy is always
// shown, so asks are found and counted before the panel is ever opened. The screen and
// report parsers live in parse.js (no Herdr import), so they can be tested with plain Node.
import { terminals, agents, focused, hc, exec, notify, appHome } from "herdr";
import { readState, update, hash, statusOf, reportOf, msgOf, agentName, wizardOn, declinedOn, logAnswer, MAX_ASKS, KEEP_MS } from "./state.js";
import { SCHEMA, normalize, parseScreen, parseReport, parseLastMessage } from "./parse.js";
export { SCHEMA, normalize, parseScreen, parseReport, parseLastMessage, parseClaudeMessage, parseCodexMessage } from "./parse.js";
const MAX_CHECKED = 300;
// A terminal labelled asks.trailing=off has its questions carded by something else (a task
// runner asking the person itself): its finished turns make no card here, and a card made
// from one before the label came goes, so the person never sees the same question twice.
// Its dialogs still make cards. `hc label <terminal> asks.trailing=off`; `asks.trailing=` ends it,
// and the turn the terminal last finished is checked then, as if it had just ended.
const trailingOff = (t) => t?.labels?.["asks.trailing"] === "off";
// The card shown when neither the Claude Code nor the Codex CLI is on the machine.
export const NOTICE_ID = "notice:no-classifier";
export const NOTICE_TEXT = "Asks reads plain-text questions with the Claude Code or Codex CLI, and neither is on this machine. Only those two agents are supported for now; dialogs still work. More agents are coming: ask for yours at github.com/sachin-philip/herdr-agent-ask/issues.";
const noticeAsk = (now) => ({ id: NOTICE_ID, notice: true, address: null, pane: null, space: null, space_name: "", agent: "Asks", program: null, app: null, cwd: null, turn: 0, msg: "",
  detected_at: now, state: "pending", kind: "NOTICE", question: NOTICE_TEXT, options: [], recommended: null, context: "", raw: "", source: "none", confidence: 1, enriched: true,
  answer: null, answered_at: null, error: null, note: null });
const one = (s) => (s ?? "").replace(/\s+/g, " ").trim();

export class Engine {
  constructor() { this.config = null; this.enriching = new Set(); this.notified = new Set(); this.checking = new Set(); this.started = false; }

  // Called every two seconds and from render: agents() is live, so a blocked agent is seen at once.
  tick(cx) {
    const now = Date.now();
    const live = terminals().filter((t) => t.state === "live");
    const byAddress = new Map(live.map((t) => [t.address, t]));
    const list = agents();
    const fresh = [], stopped = [], toCheck = [], healed = [];
    update((s) => {
      for (const t of live) {
        if (statusOf(t) !== "blocked") continue;
        const msg = msgOf(t);
        const id = `${t.address}:${t.turn ?? 0}:${hash(msg)}`;
        const known = s.asks.find((a) => a.id === id);
        if (known) {
          // Marked stale while the dialog is in fact still up (a reload, a slow report): bring it back.
          if (known.state === "stale") { known.state = "pending"; known.note = null; delete known.ended_at; }
          continue;
        }
        for (const a of s.asks) if (a.address === t.address && a.state === "pending") { a.state = "stale"; a.note = "Resolved in terminal"; a.ended_at = now; }
        const agent = list.find((x) => x.address === t.address) ?? null;
        const report = reportOf(t), parsed = parseReport(report);
        const ask = {
          id, address: t.address, pane: agent?.pane ?? null, space: agent?.space ?? t.labels?.["herdr.space"] ?? null,
          space_name: agent?.space_name ?? (t.labels?.where ?? "").split(" / ")[0] ?? "",
          agent: agentName(agent, t), program: agent?.program ? { key: agent.program.key, name: agent.program.name, icon: agent.program.icon, tint: agent.program.tint } : null,
          app: report?.app ?? agent?.app ?? null, cwd: t.cwd ?? null, turn: t.turn ?? 0, msg,
          detected_at: now, state: "pending",
          kind: parsed?.kind ?? "UNCLEAR", question: parsed?.question ?? "", options: parsed?.options ?? [], recommended: parsed?.recommended ?? null,
          context: "", raw: "", source: parsed?.source ?? "none", confidence: parsed ? 1 : 0, enriched: false,
          answer: null, answered_at: null, error: null, note: null,
        };
        // A logged-out agent: the report says it all, there is no dialog to read.
        if (ask.kind === "STOPPED") ask.enriched = true;
        s.asks.unshift(ask);
        fresh.push(ask);
      }
      // A turn that stopped on an error the agent reports (no connection, the API down): one
      // card per (terminal, turn) with Continue, which sends "continue" as a message.
      for (const t of live) {
        if (statusOf(t) !== "error") continue;
        const id = `${t.address}:e:${t.turn ?? 0}`;
        if (s.asks.some((a) => a.id === id)) continue;
        for (const a of s.asks) if (a.address === t.address && a.state === "pending") { a.state = "stale"; a.note = "Resolved in terminal"; a.ended_at = now; }
        const agent = list.find((x) => x.address === t.address) ?? null;
        const ask = {
          id, address: t.address, pane: agent?.pane ?? null, space: agent?.space ?? t.labels?.["herdr.space"] ?? null,
          space_name: agent?.space_name ?? (t.labels?.where ?? "").split(" / ")[0] ?? "",
          agent: agentName(agent, t), program: agent?.program ? { key: agent.program.key, name: agent.program.name, icon: agent.program.icon, tint: agent.program.tint } : null,
          app: reportOf(t)?.app ?? agent?.app ?? null, cwd: t.cwd ?? null, turn: t.turn ?? 0, msg: msgOf(t),
          detected_at: now, state: "pending", delivery: "send", stopped: true,
          kind: "STOPPED", question: one(msgOf(t)) || "Stopped on an error", options: [{ n: 1, label: "Continue", send: "continue", detail: "" }], recommended: null,
          context: "", raw: "", source: "report", confidence: 1, enriched: true,
          answer: null, answered_at: null, error: null, note: null,
        };
        s.asks.unshift(ask);
        stopped.push(ask);
      }
      // Right after a reload terminals() can be empty or without reports for a moment: a card
      // goes stale only when its dialog has been gone for 3 s, and never while nothing is listed.
      if (live.length) for (const a of s.asks) {
        if (a.notice) continue;
        const t = byAddress.get(a.address);
        const st = statusOf(t);
        // An answer the panel gave up on (no reaction in time) was often just held by hc until
        // the terminal went quiet: once the agent moves on, it was delivered after all.
        if (a.state === "failed") {
          if (!t) { a.state = "stale"; a.note = "Agent closed"; a.ended_at = now; continue; }
          // Only a turn that moved on means the answer landed. A dialog that merely closed may
          // have been cancelled in the terminal: that card is resolved there, not delivered.
          if (a.sent_turn != null && (t.turn ?? 0) > a.sent_turn) { a.state = "delivered"; a.answered_at = now; a.error = null; a.note = "Picked up late"; healed.push(a); continue; }
          if (a.delivery !== "send" && !(st === "blocked" && msgOf(t) === a.msg)) { a.state = "stale"; a.note = "Resolved in terminal"; a.ended_at = now; continue; }
          if (now - (a.sent_at ?? a.detected_at) > 10 * 60 * 1000) { a.state = "stale"; a.note = "Not delivered"; a.ended_at = now; }
          continue;
        }
        if (a.state === "sending") continue;
        if (a.state !== "pending") continue;
        const gone = !t ? "Agent closed"
          : a.stopped ? (st === "error" && (t.turn ?? 0) === (a.turn ?? 0) ? null : "Continued in terminal")
          : a.delivery === "send" && trailingOff(t) ? "Asked elsewhere"
          : a.delivery === "send" ? ((st === "idle" || st === "done") && (t.turn ?? 0) === (a.turn ?? 0) ? null : "Answered in terminal")
          : st !== "blocked" || msgOf(t) !== a.msg ? "Resolved in terminal" : null;
        if (!gone) { delete a.gone_since; continue; }
        a.gone_since ??= now;
        if (now - a.gone_since >= 3000) { a.state = "stale"; a.note = gone; a.ended_at = now; delete a.gone_since; }
      }
      // Finished turns: a turn the agent ended in prose may still be a question for the person.
      // Each (address, turn) is checked once; the first pass skips turns already idle when we started.
      s.checked ??= [];
      const checked = new Set(s.checked);
      if (this.config && this.config.trailing_questions !== false && this.config.classify !== "off") for (const t of live) {
        const st = statusOf(t);
        if (st !== "done" && st !== "idle") continue;
        const key = `${t.address}:p:${t.turn ?? 0}`;
        if (checked.has(key) || s.asks.some((a) => a.id === key)) continue;
        // Not marked checked: once the label comes off, the turn it ended on is checked then.
        if (trailingOff(t)) continue;
        checked.add(key); s.checked.push(key);
        if (!this.started && st === "idle") continue;
        toCheck.push(t);
      }
      if (s.checked.length > MAX_CHECKED) s.checked = s.checked.slice(-MAX_CHECKED);
      s.asks = s.asks.filter((a) => a.state === "pending" || a.state === "sending" || now - (a.ended_at ?? a.answered_at ?? a.detected_at) < KEEP_MS).slice(0, MAX_ASKS);
    });
    if (this.config) this.started = true;
    for (const a of healed) logAnswer(a, this.config, a.answered_at, "picked up late");
    for (const t of toCheck) this.checkTurn(t, list.find((x) => x.address === t.address) ?? null, cx);
    for (const ask of stopped) if (this.config?.toast && focused()?.terminal !== ask.address) notify({ title: `${ask.agent} stopped`, body: ask.question, level: "warning", timeout: 5000, action: { name: "tabs-asks.open" } });
    for (const ask of fresh) {
      if (ask.kind !== "STOPPED") this.enrich(ask.id, cx);
      if (this.config?.toast !== false && !this.notified.has(ask.id) && focused()?.terminal !== ask.address) {
        this.notified.add(ask.id);
        notify({ title: `${ask.agent} is asking`, body: ask.question || "needs your input", level: "warning", timeout: 5000, action: { name: "tabs-asks.open" } });
      }
    }
  }

  // Read the screen for numbering, the question line and context; ask a model only when the
  // report said nothing usable (another agent, or an unknown report).
  enrich(id, cx) {
    if (this.enriching.has(id)) return;
    this.enriching.add(id);
    cx.spawn(async (cx) => {
      try {
        const ask = readState().asks.find((a) => a.id === id);
        if (!ask) return;
        let screen = null;
        try {
          const r = await hc(["read", ask.address, "--json"]);
          if (r.code === 0) screen = JSON.parse(r.stdout);
        } catch {}
        const text = screen?.text ?? "";
        const parsed = parseScreen(text);
        const patch = { raw: text.split("\n").slice(-40).join("\n").slice(-3000), context: parsed.context, enriched: true };
        const tabs = wizardOn(text);
        if (tabs) {
          // Several questions in one dialog: the report only knows the first, so no option on the
          // card would be safe to press. The card says so and opens the terminal.
          Object.assign(patch, { kind: "DECISION", wizard: true, options: [], recommended: null,
            question: `${tabs.length} questions in one dialog: ${tabs.join(" · ")}. Answer them in the terminal.` });
          update((s) => { const a = s.asks.find((x) => x.id === id); if (a) Object.assign(a, patch); });
          return;
        }
        if (ask.source === "report") {
          // Keep the report's words; take the screen's numbering, question line and details when they line up.
          if (ask.options.length && parsed.options.length >= ask.options.length && ask.options.every((o, i) => parsed.options[i].label.startsWith(o.label.slice(0, 12)))) {
            patch.options = ask.options.map((o, i) => ({ ...o, n: parsed.options[i].n, detail: parsed.options[i].detail }));
          } else if (!ask.options.length && parsed.options.length) {
            patch.options = parsed.options;
          }
          if (parsed.question && ask.kind === "APPROVAL") patch.question = `${parsed.question} ${ask.question}`.trim();
        } else if (parsed.options.length) {
          patch.options = parsed.options; patch.source = "screen"; patch.confidence = 0.7;
          patch.kind = parsed.options.some((o) => /^yes\b/i.test(o.label)) && parsed.options.some((o) => /^no\b/i.test(o.label)) ? "APPROVAL" : "DECISION";
          if (parsed.question) patch.question = parsed.question;
        }
        if (this.config?.classify !== "off" && (this.config?.classify === "always" || (ask.source !== "report" && !patch.options?.length))) {
          const model = await this.classify(text, ask);
          if (model) {
            const seen = model.options.filter((o) => text.includes(o));
            if (seen.length === model.options.length && model.confidence >= 0.6) {
              patch.kind = model.kind; patch.question = model.question || patch.question || ask.question; patch.context = model.context || patch.context;
              if (!patch.options?.length && !ask.options.length) patch.options = model.options.map((label, i) => ({ n: parsed.options[i]?.n ?? i + 1, label, detail: "" }));
              patch.recommended = model.recommended; patch.source = patch.source === "screen" ? "screen+model" : "model"; patch.confidence = model.confidence;
            } else if (ask.source !== "report") { patch.kind = "UNCLEAR"; }
          }
        }
        if (patch.kind !== "UNCLEAR" && !(patch.options?.length ?? ask.options.length) && (patch.kind ?? ask.kind) !== "QUESTION" && ask.source !== "report") patch.kind = "UNCLEAR";
        update((s) => { const a = s.asks.find((x) => x.id === id); if (a) Object.assign(a, patch); });
      } finally { this.enriching.delete(id); cx.notify(); }
    });
  }

  // With `debug: true` in asks.json, one line per step goes to ~/.config/herdr-app/asks.log.
  debug(line) {
    if (!this.config?.debug) return;
    exec("sh", ["-c", 'printf "%s %s\n" "$(date +%H:%M:%S)" "$1" >> "$2"', "asks", String(line).slice(0, 600), `${appHome()}/asks.log`]).catch(() => {});
  }

  // `tabs-asks.recheck`: forget the finished-turn checks for every live agent's current
  // turn, so the next tick reads those turns again (after a rule change, or a miss).
  recheck() {
    const live = terminals().filter((t) => t.state === "live");
    const keys = new Set(live.map((t) => `${t.address}:p:${t.turn ?? 0}`));
    update((s) => {
      s.checked = (s.checked ?? []).filter((k) => !keys.has(k));
      s.asks = s.asks.filter((a) => !(keys.has(a.id) && a.state !== "delivered"));
    });
    this.debug(`recheck ${[...keys].join(" ")}`);
  }

  // Read the finished turn; if it ends asking the person something, make a QUESTION card.
  checkTurn(t, agent, cx) {
    const key = `${t.address}:p:${t.turn ?? 0}`;
    if (this.checking.has(key)) return;
    this.checking.add(key);
    cx.spawn(async (cx) => {
      try {
        const r = await hc(["read", t.address, "--json", "--lines", "100"]);
        if (r.code !== 0) { this.debug(`${key} read failed: ${r.stderr}`); return; }
        const text = JSON.parse(r.stdout).text ?? "";
        const { message, hasQuestion } = parseLastMessage(text, reportOf(t)?.app ?? agent?.app ?? null);
        this.debug(`${key} message ${message.length} chars, question=${hasQuestion}`);
        if (!hasQuestion || message.length < 8) return;
        // Not questions for the person: a login prompt or an API error the agent printed.
        if (/API Error|Please run \/login|rate limit/i.test(message)) { this.debug(`${key} skipped: error text`); return; }
        const model = normalize(await this.classify(message, { app: reportOf(t)?.app ?? agent?.app, program: agent?.program, msg: "" }, "message"));
        this.debug(`${key} model: ${JSON.stringify(model)}`);
        if (!model || !model.asks || model.confidence < 0.6) return;
        const now = Date.now();
        const ask = {
          id: key, address: t.address, pane: agent?.pane ?? null, space: agent?.space ?? t.labels?.["herdr.space"] ?? null,
          space_name: agent?.space_name ?? (t.labels?.where ?? "").split(" / ")[0] ?? "",
          agent: agentName(agent, t), program: agent?.program ? { key: agent.program.key, name: agent.program.name, icon: agent.program.icon, tint: agent.program.tint } : null,
          app: reportOf(t)?.app ?? agent?.app ?? null, cwd: t.cwd ?? null, turn: t.turn ?? 0, msg: "",
          detected_at: now, state: "pending", delivery: "send",
          kind: "QUESTION", question: model.question, options: model.options.map((label, i) => ({ n: i + 1, label, detail: "" })), recommended: model.recommended,
          questions: (model.questions ?? []).map((q) => ({ text: q.text, options: q.options.map((label, i) => ({ n: i + 1, label, detail: "" })), recommended: q.recommended })),
          context: model.context, raw: message.slice(-3000), source: "model", confidence: model.confidence, enriched: true,
          answer: null, answered_at: null, error: null, note: null,
        };
        // Labelled while the model was reading: the turn's question is carded elsewhere.
        if (trailingOff(terminals().find((x) => x.address === t.address))) { this.debug(`${key} asks.trailing=off`); return; }
        let added = false;
        update((s) => { if (!s.asks.some((a) => a.id === key)) { s.asks.unshift(ask); added = true; } });
        if (added && this.config?.toast && focused()?.terminal !== t.address) notify({ title: `${ask.agent} is asking`, body: ask.question, level: "warning", timeout: 5000, action: { name: "tabs-asks.open" } });
      } catch {}
      finally { this.checking.delete(key); cx.notify(); }
    });
  }

  async classify(text, ask, mode = "dialog") {
    const prompt = mode === "message" ? [
      "A coding agent just finished a turn and printed this message to the person. Decide whether it is waiting on an answer. Return JSON only.",
      "asks: true only if the agent needs the person to decide, confirm or tell it something before it can usefully continue (a real question, a choice, a go-ahead). false for rhetorical questions, offers like 'let me know if you want X', summaries, or finished work.",
      "kind: QUESTION when asks is true, else UNCLEAR.",
      "question: the thing being asked, under 160 characters, in the person's language, no preamble. If the message asks several separate questions, summarise what they are about, e.g. '9 questions before scaffolding: backend, first user, stack…'.",
      "questions: when the message asks several separate questions, one entry per question, in order: text = the question in its own words (no numbering); options = the alternatives the message lists under THAT question, as short labels in its own words, in order, empty if it gives none; recommended = 0-based index of the one the agent says it prefers, else null. Empty array for a single question.",
      "options: alternatives the message offers as answers to ONE question (A or B, yes or no, a list of candidates), as short labels in its own words, in order. A list of questions is never options. Empty if it asks open-endedly or asks several questions. Never invent.",
      "recommended: 0-based index of the option the agent said it prefers, else null.",
      "context: under 120 characters, past tense, what the agent did this turn.",
      "confidence: 0 to 1.",
      `Agent program: ${ask.app ?? ask.program?.name ?? "unknown"}.`,
      "Message:", "```", text.slice(-6000), "```",
    ].join("\n") : [
      "You classify a dialog a coding agent shows a person in its terminal. Return JSON only.",
      "kind: APPROVAL = a permission or confirmation gate; DECISION = enumerated options to choose from; QUESTION = open-ended; UNCLEAR = anything else or no dialog.",
      "question: what is being asked, under 160 characters, in the person's language, no preamble.",
      "options: copied verbatim from the screen, in order, without their numbers. Never invent, merge or reorder. Empty if none.",
      "questions: always empty here.",
      "recommended: 0-based index of an option the agent itself marked recommended, else null.",
      "context: under 120 characters, past tense, what the agent was doing when it stopped.",
      "confidence: 0 to 1.",
      `Agent program: ${ask.app ?? ask.program?.name ?? "unknown"}. Status report: ${JSON.stringify(ask.msg)}.`,
      "Screen (last lines):", "```", text.split("\n").slice(-45).join("\n").slice(-6000), "```",
    ].join("\n");
    const backend = await this.backend();
    if (!backend) { this.debug("no classifier: neither claude nor codex is on PATH"); return null; }
    try {
      const o = backend === "codex" ? await this.askCodex(prompt) : await this.askClaude(prompt);
      return o && Array.isArray(o.options) ? o : null;
    } catch (e) { this.debug(`${backend} threw: ${e?.message ?? e}`); return null; }
  }

  // Which CLI runs the classifier: `classifier` in asks.json (`claude` or `codex`), or `auto`:
  // claude when installed, else codex, else nothing (and a one-time notice asking for an issue
  // so another agent's CLI can be added). Looked up once; reset when the config is reloaded.
  async backend() {
    const want = this.config?.classifier ?? "auto";
    if (want === "claude") return "claude";
    if (want === "codex") return (await this.codexBin()) ? "codex" : null;
    if (this._backend !== undefined) return this._backend;
    const r = await exec("sh", ["-c", "command -v claude >/dev/null 2>&1 && echo claude"]);
    this._backend = r.code === 0 && /claude/.test(r.stdout) ? "claude" : (await this.codexBin()) ? "codex" : null;
    this.debug(`classifier: ${this._backend ?? "none"}`);
    // Neither CLI: say so where the person looks, as a card in every space (once; Dismiss keeps
    // it away). The card goes by itself once a CLI turns up.
    const now = Date.now(), found = this._backend;
    update((s) => {
      const has = s.asks.some((a) => a.id === NOTICE_ID);
      if (!found && !has) s.asks.unshift(noticeAsk(now));
      if (found && has) s.asks = s.asks.filter((a) => a.id !== NOTICE_ID);
    });
    return this._backend;
  }

  // The newest codex on this machine: Codex's own installer leaves an older copy in
  // ~/.local/bin that can sit first on PATH, and old versions reject newer model names.
  async codexBin() {
    if (this._codex !== undefined) return this._codex;
    const r = await exec("sh", ["-c", 'for b in "$(command -v codex 2>/dev/null)" /opt/homebrew/bin/codex /usr/local/bin/codex "$HOME/.local/bin/codex" "$HOME/.codex/bin/codex"; do [ -n "$b" ] && [ -x "$b" ] && printf "%s %s\n" "$b" "$("$b" --version 2>/dev/null | head -1)"; done']);
    let best = null, bestV = [];
    for (const line of (r.stdout ?? "").split("\n")) {
      const m = /^(\S+) .*?(\d+)\.(\d+)\.(\d+)/.exec(line.trim());
      if (!m) continue;
      const v = [+m[2], +m[3], +m[4]];
      const newer = !best || v[0] > bestV[0] || (v[0] === bestV[0] && (v[1] > bestV[1] || (v[1] === bestV[1] && v[2] > bestV[2])));
      if (newer) { best = m[1]; bestV = v; }
    }
    this._codex = best;
    this.debug(`codex: ${best ?? "none"}${best ? " " + bestV.join(".") : ""}`);
    return best;
  }

  async askClaude(prompt) {
    // Skipping the person's MCP servers and settings cuts the CLI's start from ~4 s to ~1 s;
    // the classifier needs neither (it runs no tools). A login that lives in settings
    // (apiKeyHelper, env) needs them though: on an auth error the call is made once more with
    // settings on, and that is remembered.
    const base = ["-p", "--no-session-persistence", "--model", this.config?.model ?? "haiku", "--output-format", "json", "--json-schema", SCHEMA, "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}'];
    const lean = !this._claudeNeedsSettings;
    let r = await exec("claude", [...base, ...(lean ? ["--setting-sources", ""] : []), prompt]);
    const text = `${r.stderr} ${r.stdout}`;
    if (lean && (r.code !== 0 || /"is_error":\s*true/.test(r.stdout)) && /log ?in|auth|api key|credential|unauthori[sz]ed|401/i.test(text)) {
      this.debug("claude: auth error without settings; retrying with the person's settings on");
      this._claudeNeedsSettings = true;
      r = await exec("claude", [...base, prompt]);
    }
    if (r.code !== 0) { this.debug(`claude exit ${r.code}: ${r.stderr} ${r.stdout.slice(0, 200)}`); return null; }
    const out = JSON.parse(r.stdout);
    if (out.is_error) { this.debug(`claude error: ${String(out.result).slice(0, 200)}`); return null; }
    return out.structured_output ?? (typeof out.result === "string" ? JSON.parse(out.result) : null);
  }

  // `codex exec` with the same schema: the schema goes to a file (that is how codex takes it)
  // and the answer is the last JSON line it prints. stdin is closed, or codex waits on it.
  async askCodex(prompt) {
    const schema = `${appHome()}/asks-schema.json`;
    const model = this.config?.codex_model ? ["-m", this.config.codex_model] : [];
    const bin = await this.codexBin();
    if (!bin) { this.debug("codex: not found"); return null; }
    const r = await exec("sh", ["-c", 'printf "%s" "$1" > "$2" || exit 1; bin="$3"; schema="$2"; prompt="$4"; shift 4; exec "$bin" exec --ephemeral --skip-git-repo-check -s read-only --output-schema "$schema" "$@" "$prompt" < /dev/null', "asks", SCHEMA, schema, bin, prompt, ...model]);
    if (r.code !== 0) { this.debug(`codex exit ${r.code}: ${one(r.stderr).slice(0, 200)} ${one(r.stdout).slice(0, 200)}`); return null; }
    const lines = r.stdout.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("{"));
    for (let i = lines.length - 1; i >= 0; i--) { try { return JSON.parse(lines[i]); } catch {} }
    this.debug(`codex gave no JSON: ${one(r.stdout).slice(0, 200)}`);
    return null;
  }
}
