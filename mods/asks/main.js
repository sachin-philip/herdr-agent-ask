// The Asks panel: every decision an agent in the shown space is waiting on, as a card you
// answer from here. Detection lives in mods/tabs-asks (always shown); this mod shows the
// shared state and delivers answers with hc.
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, TextareaState, Textarea } from "gpui-base";
import { spaces, focused, run, theme, hc, exec, nextCommand, appHome } from "herdr";
import { readState, update, stillAsking, stillIdle, liveTerminal, wizardOn, declinedOn, logAnswer, age, loadConfig } from "./state.js";
import { parseTab, optionRows } from "./dialog.js";

// How long the panel waits for the agent to react to an answer. hc holds a paste or key
// press until nobody has typed in that terminal for ~3 s, and a turn takes a moment to start.
const SETTLE_MS = 8000;

const KIND = { APPROVAL: "blocked", DECISION: "accent", QUESTION: "working", STOPPED: "blocked", UNCLEAR: "dim", NOTICE: "dim" };
const one = (s) => (s ?? "").replace(/\s+/g, " ").trim();
const bare = (label) => label.replace(/\s*\(recommended\)\s*$/i, "");
// Questions of a multi-question card; older cards stored them as plain strings.
const questionsOf = (ask) => (ask.questions ?? []).map((q) => typeof q === "string" ? { text: q, options: [], recommended: null } : { ...q, options: q.options ?? [], recommended: q.recommended ?? null });
// A drafted answer: { text } typed, or { text, n: [numbers] } picked. Older drafts were strings.
const draftOf = (d) => d == null ? null : typeof d === "string" ? { text: d } : d;
// Web links in what the agent said, for "More".
const linksIn = (text) => [...new Set(((text ?? "").match(/https?:\/\/[^\s<>"'`]+/g) ?? []).map((u) => u.replace(/[.,;:!?)\]]+$/, "")))];
const HINT = "Enter: new line · ⌘Enter: send";

function iconOf(p, size, color) {
  if (!p?.icon) return div().size(size).rounded(4).bg(color).opacity(0.3);
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

export default class Asks extends View {
  init(_props, cx) {
    this.all = localStorage.getItem("scope") === "all";
    this.showAnswered = false;
    // Typed answers: one box per card (key: ask.id), per question (`${id}:${i}`) and for the
    // reason with a no (`${id}:no`), so text half typed in one card stays in that card.
    this.boxes = {};
    // Multi-question cards: which question is unfolded, and the answers drafted so far
    // ({ [ask.id]: { [index]: draft } }). Sent together with "Send answers".
    this.openQ = null; this.drafts = {};
    // Cards whose context line is open in full, and cards showing everything the agent said ("More").
    this.openCtx = new Set(); this.more = new Set();
    this.config = null;
    const config = (cx) => cx.spawn(async (cx) => { this.config = await loadConfig(); cx.notify(); });
    config(cx);
    cx.timer.every(30000, (cx) => { config(cx); cx.notify(); });
    // Key commands ("asks.accept" in keys.json): accept answers the newest waiting ask in the
    // shown space with the option its agent recommends (or the first, for an approval); a
    // dialog of several questions gets the recommended (or first) answer to each.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "accept") {
          const spaceId = spaces().find((s) => s.active)?.id ?? focused()?.space;
          const ask = readState().asks.find((a) => a.state === "pending" && (this.all || a.space === spaceId) && (a.options.length || a.delivery === "tabs") && a.kind !== "UNCLEAR");
          if (ask?.delivery === "tabs") { this.recommend(ask, true); this.sendTabs(ask, cx); }
          else if (ask) this.answer(ask, ask.options[ask.recommended ?? 0], cx);
        }
        cx.notify();
      }
    });
  }

  set(id, patch) { update((s) => { const a = s.asks.find((x) => x.id === id); if (a) Object.assign(a, patch); }); }

  // With `debug: true` in asks.json, delivery steps go to ~/.config/herdr-app/asks.log too.
  debug(line) {
    if (!this.config?.debug) return;
    exec("sh", ["-c", 'printf "%s %s\n" "$(date +%H:%M:%S)" "$1" >> "$2"', "asks", String(line).slice(0, 600), `${appHome()}/asks.log`]).catch(() => {});
  }
  find(id) { return readState().asks.find((a) => a.id === id) ?? null; }

  // Opens the text box `key` (made on first use: a state can't be made in render).
  // `send(text, cx)` runs on its button or ⌘Enter; Enter alone starts a new line.
  openBox(key, placeholder, send) {
    let b = this.boxes[key];
    if (!b) {
      const state = TextareaState.new({ placeholder });
      state.set_auto_grow(2, 8);
      b = this.boxes[key] = { state, text: "", open: false, send };
      state.on("change", (_e, cx) => { b.text = state.value(); cx.notify(); });
      state.on("submit", (e, cx) => { if (e?.secondary && b.text.trim()) b.send(b.text.trim(), cx); });
    }
    b.send = send; b.open = true;
    b.state.focus();
  }
  // Folds the box away; its text stays for next time unless `clear`.
  closeBox(key, clear) {
    if (!this.boxes[key]) return;
    if (clear) delete this.boxes[key]; else this.boxes[key].open = false;
  }
  boxOpen(key) { return Boolean(this.boxes[key]?.open); }
  toggleBox(key, placeholder, send, cx) {
    if (this.boxOpen(key)) this.closeBox(key, false); else this.openBox(key, placeholder, send);
    cx.notify();
  }

  box(key, t, sendLabel) {
    const b = this.boxes[key], ready = Boolean(b.text.trim());
    return v_flex().w_full().gap(5)
      .child(Textarea.new(b.state).w_full().px(10).py(6).rounded(8).border_1().border_color(t.accent).bg(t.background).text_size(12.5).text_color(t.foreground))
      .child(h_flex().gap(6).items_center()
        .child(h_flex().id(`bs-${key}`).h(24).px(8).gap(5).items_center().rounded(7).flex_none().text_size(11.5).border_1()
          .border_color(t.input).bg(t.raised).text_color(ready ? t.foreground : t.dim)
          .when(ready, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => b.send(b.text.trim(), cx)))
          .child(svg("mods/asks/send.svg").size(12)).child(sendLabel))
        .child(div().flex_1().min_w(0).truncate().text_size(10.5).text_color(t.dim).child(HINT))
        .child(div().id(`bc-${key}`).flex_none().text_size(11).text_color(t.muted).cursor_pointer().hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => { this.closeBox(key, false); cx.notify(); }).child("Cancel")));
  }

  // Keeps a question's answer (none: forgets it) and unfolds the next question still
  // unanswered, or folds them all when every one has an answer.
  draft(id, i, d) {
    const ds = (this.drafts[id] ??= {});
    if (d == null) delete ds[i]; else ds[i] = d;
    const ask = this.find(id), n = ask ? questionsOf(ask).length : 0;
    let next = null;
    for (let k = 1; k <= n; k++) { const j = (i + k) % n; if (!ds[j]) { next = j; break; } }
    this.openQ = next == null ? null : `${id}:${next}`;
  }

  // Every question still unanswered takes the answer its agent recommends; with `first`, a
  // question without one takes its first answer (the accept key).
  recommend(ask, first) {
    const ds = (this.drafts[ask.id] ??= {});
    questionsOf(ask).forEach((q, i) => {
      if (ds[i]) return;
      const j = q.recommended ?? (first && q.options.length ? 0 : null);
      if (j != null && q.options[j]) ds[i] = { text: bare(q.options[j].label), n: [q.options[j].n] };
    });
    this.openQ = null;
  }

  // One message with every drafted answer, numbered like the agent's questions.
  sendDrafts(ask, cx) {
    if (ask.delivery === "tabs") return this.sendTabs(ask, cx);
    const d = this.drafts[ask.id] ?? {};
    const qs = questionsOf(ask);
    const lines = qs.map((q, i) => d[i] ? `${i + 1}. ${q.text} → ${draftOf(d[i]).text}` : null).filter(Boolean);
    if (!lines.length) return;
    delete this.drafts[ask.id];
    this.sendText(ask, lines.join("\n"), cx);
  }

  stale(ask) { this.set(ask.id, { state: "stale", note: "Resolved in terminal", ended_at: Date.now() }); }

  // The dialog on screen is a several-question wizard: turn the card into the notice and
  // press nothing. True when it was.
  async wizard(ask) {
    const r = await hc(["read", ask.address, "--json"]);
    const tabs = r.code === 0 ? wizardOn(JSON.parse(r.stdout).text ?? "") : null;
    if (!tabs) return false;
    this.set(ask.id, { state: "pending", wizard: true, options: [], recommended: null, chosen: null, answer: null, error: null,
      question: `${tabs.length} questions in one dialog: ${tabs.join(" · ")}. Answer them in the terminal.` });
    return true;
  }

  async probe(address) {
    const r = await hc(["get", address, "--json"]);
    if (r.code !== 0) return null;
    const g = JSON.parse(r.stdout);
    const st = typeof g.status === "string" ? g.status : g.status?.state ?? null;
    return { state: g.state === "live" ? st : "gone", msg: typeof g.status === "object" ? g.status?.msg ?? "" : "", turn: g.turn ?? 0 };
  }

  // Probe every 400 ms until `done(g)` or the time is up; returns the last probe.
  async settle(address, sleep, done, ms = SETTLE_MS) {
    const until = Date.now() + ms;
    let g = null;
    for (;;) {
      g = await this.probe(address);
      if (!g || g.state === "gone" || done(g)) return g;
      if (Date.now() >= until) return g;
      await sleep(400);
    }
  }

  // Read the screen every 200 ms until `parse(text)` passes `ok`, or the time is up; the last
  // parse. (hc holds keys until nobody has typed in that terminal for a moment.)
  async watch(address, parse, ok, sleep, ms = 6000) {
    const until = Date.now() + ms;
    let seen = null;
    for (;;) {
      const r = await hc(["read", address, "--json"]);
      if (r.code === 0) { try { seen = parse(JSON.parse(r.stdout).text ?? ""); } catch {} }
      if ((seen && ok(seen)) || Date.now() >= until) return seen;
      await sleep(200);
    }
  }

  // Text typed into the terminal. hc refuses a terminal whose output hasn't settled since it
  // started ("still starting", nothing typed): wait and try again, for up to ~10 s.
  async type(address, text, force, sleep) {
    for (let k = 0; ; k++) {
      const r = await hc(["send", "--json", ...(force ? ["--force"] : []), address, text]);
      if (r.code === 0) return r;
      if (k < 6 && /still starting/.test(r.stderr + r.stdout)) { await sleep(1500); continue; }
      throw new Error(one(r.stderr) || "Could not send the answer");
    }
  }

  async press(address, ...keys) {
    const r = await hc(["keys", address, ...keys.map(String)]);
    if (r.code !== 0) throw new Error(one(r.stderr) || "Could not press the key");
  }

  // Press the option's number; Enter only if the dialog is still there (Claude Code selects on the number alone).
  answer(ask, option, cx) {
    // A prose question: the option is sent as a message, not pressed as a key.
    // `send` is the message behind a button whose label is not the message (Continue → "continue").
    if (ask.delivery === "send") return this.sendText(ask, option.send ?? bare(option.label), cx);
    if (!stillAsking(ask)) return this.stale(ask);
    const sentTurn = liveTerminal(ask.address)?.turn ?? ask.turn ?? 0;
    this.set(ask.id, { state: "sending", answer: option.label, chosen: option, error: null, sent_turn: sentTurn, sent_at: Date.now() });
    const same = (g) => g.state === "blocked" && g.msg === ask.msg && g.turn <= sentTurn;
    this.deliver(ask, cx, async (sleep) => {
      // The screen first, every time (also on Retry and asks.accept): a wizard's tab bar means
      // the report's one question is not the whole dialog, and a key would answer the wrong one.
      if (await this.wizard(ask)) return { wizard: true };
      let r = await hc(["keys", ask.address, String(option.n)]);
      if (r.code !== 0) throw new Error(one(r.stderr) || "Could not press the key");
      let g = await this.settle(ask.address, sleep, (g) => !same(g), 1500);
      if (g && same(g)) {
        if (await this.wizard(ask)) return { wizard: true };
        r = await hc(["keys", ask.address, "enter"]);
        if (r.code !== 0) throw new Error(one(r.stderr) || "Could not press Enter");
        g = await this.settle(ask.address, sleep, (g) => !same(g));
      }
      return g;
    });
  }

  // A dialog of several questions (Claude Code draws them as tabs): answer each tab in turn,
  // as the person would, then press "Submit answers" on the review page. A picked answer is
  // its number (which also moves on to the next tab); several picks are their numbers, then
  // `right`; a typed answer is the "Type something" row's number, then the text.
  sendTabs(ask, cx) {
    const qs = questionsOf(ask), d = this.drafts[ask.id] ?? {};
    const answers = qs.map((_, i) => draftOf(d[i]));
    if (answers.some((a) => !a)) return;
    if (!stillAsking(ask)) return this.stale(ask);
    const sentTurn = liveTerminal(ask.address)?.turn ?? ask.turn ?? 0;
    const summary = qs.map((q, i) => `${q.header || q.text} → ${answers[i].text}`).join(" · ");
    this.set(ask.id, { state: "sending", answer: summary, chosen: { tabs: answers }, error: null, sent_turn: sentTurn, sent_at: Date.now() });
    delete this.drafts[ask.id];
    qs.forEach((_, i) => this.closeBox(`${ask.id}:${i}`, true));
    const addr = ask.address;
    this.deliver(ask, cx, async (sleep) => {
      const tab = (ok) => this.watch(addr, parseTab, ok, sleep);
      let shown = await tab(() => true);
      if (shown?.question !== qs[0].text) {
        // Back to the first tab. On a "Type something" row the arrows edit its text: step off it first.
        if (shown && shown.cursor != null && shown.cursor === shown.other) await this.press(addr, "up");
        await this.press(addr, ...Array(qs.length).fill("left"));
        shown = await tab((p) => p.question === qs[0].text);
      }
      if (shown?.question !== qs[0].text) throw new Error("The dialog isn't on its first question. Open the terminal to answer it.");
      for (let i = 0; i < qs.length; i++) {
        const q = qs[i], a = answers[i];
        if (a.n && q.multi) {
          const want = new Set(a.n);
          for (const o of shown.options) {
            if (want.has(o.n) === Boolean(o.checked)) continue;
            await this.press(addr, o.n);
            shown = await tab((p) => p.question === q.text && Boolean(p.options.find((x) => x.n === o.n)?.checked) === want.has(o.n));
          }
          await this.press(addr, "right");
        } else if (a.n) {
          await this.press(addr, a.n[0]);
        } else {
          if (q.other == null) throw new Error(`Question ${i + 1} takes no typed answer. Open the terminal to answer it.`);
          await this.press(addr, q.other);
          await tab((p) => p.cursor === q.other);
          await this.type(addr, a.text, true, sleep);
        }
        const next = qs[i + 1];
        shown = await tab((p) => next ? p.question === next.text : p.review);
        if (!(next ? shown?.question === next.text : shown?.review)) throw new Error(`Question ${i + 1} didn't take its answer. Open the terminal to finish it.`);
      }
      if (shown.incomplete) throw new Error("The dialog says a question has no answer. Open the terminal to finish it.");
      await this.press(addr, shown.submit ?? 1);
      return this.settle(addr, sleep, (g) => !(g.state === "blocked" && g.msg === ask.msg));
    });
  }

  // "No, because…": Claude Code's permission dialog takes a reason with a no. Move to the
  // "No" row, press Tab ("Tab to amend"), then send the reason as text.
  sendReason(ask, text, cx) {
    const no = ask.options.find((o) => /^no\b/i.test(o.label));
    if (!no) return;
    if (!stillAsking(ask)) return this.stale(ask);
    const sentTurn = liveTerminal(ask.address)?.turn ?? ask.turn ?? 0;
    this.set(ask.id, { state: "sending", answer: `${no.label}: ${text}`, chosen: { reason: text }, error: null, sent_turn: sentTurn, sent_at: Date.now() });
    this.closeBox(`${ask.id}:no`, true);
    const addr = ask.address;
    this.deliver(ask, cx, async (sleep) => {
      const rows = await this.watch(addr, optionRows, (p) => p.cursor != null, sleep, 3000);
      if (rows?.cursor == null) throw new Error("Could not find the dialog's cursor. Open the terminal to answer it.");
      const steps = no.n - rows.cursor;
      if (steps) await this.press(addr, ...Array(Math.abs(steps)).fill(steps > 0 ? "down" : "up"));
      const on = await this.watch(addr, optionRows, (p) => p.cursor === no.n, sleep, 3000);
      if (on?.cursor !== no.n) throw new Error("Could not move to the No answer. Open the terminal to answer it.");
      await this.press(addr, "tab");
      await sleep(300);
      await this.type(addr, text, true, sleep);
      return this.settle(addr, sleep, (g) => g.turn > sentTurn || !(g.state === "blocked" && g.msg === ask.msg));
    });
  }

  // Free text into a dialog (Claude Code's question dialog takes typed text as its own answer) or to an idle agent.
  sendText(ask, text, cx) {
    const live = stillAsking(ask);
    if (!live && !stillIdle(ask)) return this.set(ask.id, { state: "stale", note: ask.stopped ? "Continued in terminal" : ask.delivery === "send" ? "Answered in terminal" : "Resolved in terminal", ended_at: Date.now() });
    const sentTurn = liveTerminal(ask.address)?.turn ?? ask.turn ?? 0;
    this.set(ask.id, { state: "sending", answer: text, chosen: { text }, error: null, sent_turn: sentTurn, sent_at: Date.now() });
    this.closeBox(ask.id, true);
    // Taken: the turn moved on, or (idle agent) it is no longer idle, or (dialog) the dialog is gone.
    // (A stopped agent that still reports its error on the same turn has not taken it either.)
    const taken = (g) => g.turn > sentTurn || (live ? !(g.state === "blocked" && g.msg === ask.msg) : !(g.state === "idle" || g.state === "done" || (ask.stopped && g.state === "error")));
    this.deliver(ask, cx, async (sleep) => {
      // `hc send --json` reports whether the message started a turn. Codex now and then drops
      // a paste (seen on fresh agents, not reproducible on demand): when nothing started and the
      // text is not sitting in the input box, send it once more; if it is sitting there unsent,
      // press Enter. Never more than one extra attempt.
      let r = await this.type(ask.address, text, live, sleep);
      this.debug(`${ask.id} send${live ? " --force" : ""} turn ${sentTurn}: code ${r.code} out ${one(r.stdout).slice(0, 200)} err ${one(r.stderr).slice(0, 200)}`);
      let started = null;
      try { started = JSON.parse(r.stdout).started ?? null; } catch {}
      let g = await this.settle(ask.address, sleep, taken, started === false ? 1500 : SETTLE_MS);
      if (g && !taken(g) && started === false) {
        // "In the box" means on a prompt line (`› Spaces`, `❯ Spaces`), not anywhere on screen:
        // a short answer such as `Spaces` is usually also in the agent's question.
        const head = text.split("\n")[0].slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const rd = await hc(["read", ask.address, "--json"]);
        const onScreen = rd.code === 0 && Boolean(head) && new RegExp(`^[›❯>]\\s*${head}`, "m").test(JSON.parse(rd.stdout).text ?? "");
        this.debug(`${ask.id} not started; text on screen: ${onScreen}`);
        if (onScreen) await hc(["keys", ask.address, "enter"]);
        else { r = await this.type(ask.address, text, true, sleep); this.debug(`${ask.id} resent: ${one(r.stdout).slice(0, 200)}`); }
        g = await this.settle(ask.address, sleep, taken);
      }
      this.debug(`${ask.id} settled: ${JSON.stringify(g)} taken=${g ? taken(g) : null}`);
      if (g && !taken(g)) return { state: "blocked", msg: ask.msg };
      return g;
    });
  }

  deliver(ask, cx, act) {
    cx.spawn(async (cx) => {
      const sleep = (ms) => new Promise((res) => cx.timer.after(ms, () => res()));
      try {
        const g = await act(sleep);
        if (g?.wizard) return;
        if (g && g.state === "blocked" && g.msg === ask.msg) throw new Error("Not delivered: the agent did not react. Retry sends it again, or answer in the terminal.");
        // A dialog that closed because the person said no in the terminal is not an answer.
        const rd = await hc(["read", ask.address, "--json"]);
        if (rd.code === 0 && declinedOn(JSON.parse(rd.stdout).text ?? "")) { this.set(ask.id, { state: "stale", note: "Declined in terminal", ended_at: Date.now(), answer: null }); return; }
        const now = Date.now();
        this.set(ask.id, { state: "delivered", answered_at: now, error: null });
        await logAnswer(readState().asks.find((a) => a.id === ask.id) ?? ask, this.config, now);
      } catch (e) {
        this.set(ask.id, { state: "failed", error: String(e?.message ?? e) });
      } finally { cx.notify(); }
    });
  }

  retry(ask, cx) {
    // The earlier answer may have landed after the panel gave up: never send it twice.
    const t = liveTerminal(ask.address);
    if (t && ask.sent_turn != null && (t.turn ?? 0) > ask.sent_turn) { const now = Date.now(); this.set(ask.id, { state: "delivered", answered_at: now, error: null, note: "Picked up late" }); logAnswer(ask, this.config, now, "picked up late"); return; }
    if (ask.chosen?.tabs) { this.drafts[ask.id] = { ...ask.chosen.tabs }; return this.sendTabs(ask, cx); }
    if (ask.chosen?.reason) return this.sendReason(ask, ask.chosen.reason, cx);
    if (ask.chosen?.text) return this.sendText(ask, ask.chosen.text, cx);
    if (ask.chosen) return this.answer(ask, ask.chosen, cx);
    this.set(ask.id, { state: "pending", error: null });
  }

  open(ask) {
    // A closed agent has no pane to focus: say so on the card instead of a failed-command toast.
    if (!liveTerminal(ask.address)) return this.set(ask.id, { state: "stale", note: "Agent closed", ended_at: Date.now() });
    if (ask.pane) run("pane.focus", { pane: ask.pane });
    else run("agent.focus", { terminal: ask.address });
  }

  // A question of a multi-question card, folded to its line, or unfolded with its answers.
  question(ask, q, i, t, sending) {
    const tabs = ask.delivery === "tabs", key = `${ask.id}:${i}`, open = this.openQ === key;
    const chosen = draftOf(this.drafts[ask.id]?.[i]), picked = new Set(chosen?.n ?? []);
    const pick = (o) => (_e, cx) => {
      if (!q.multi) { this.closeBox(key, false); this.draft(ask.id, i, { text: bare(o.label), n: [o.n] }); return cx.notify(); }
      // Several picks: each click adds or takes one away; "Next" moves on.
      if (picked.has(o.n)) picked.delete(o.n); else picked.add(o.n);
      const ns = q.options.filter((x) => picked.has(x.n)), ds = (this.drafts[ask.id] ??= {});
      if (ns.length) ds[i] = { text: ns.map((x) => bare(x.label)).join(", "), n: ns.map((x) => x.n) }; else delete ds[i];
      cx.notify();
    };
    const keep = (text, cx) => { this.closeBox(key, true); this.draft(ask.id, i, { text }); cx.notify(); };
    // A typed answer goes where a dialog has a "Type something" row, and to any prose question.
    const typable = !q.multi && (!tabs || q.other != null);
    return v_flex().id(`q-${ask.id}-${i}`).w_full().gap(4).rounded(8).px(6).py(4).when(open, (el) => el.bg(t.background))
      .child(h_flex().id(`qh-${ask.id}-${i}`).w_full().gap(8).items_start().cursor_pointer().hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => { this.openQ = open ? null : key; cx.notify(); })
        .child(div().w(18).h(18).flex_none().rounded(4).flex().items_center().justify_center().text_size(10.5).font_semibold().bg(chosen ? t.accent : t.raised).text_color(chosen ? t.background : t.muted).child(String(i + 1)))
        .child(v_flex().flex_1().min_w(0).gap(1)
          .child(div().text_size(12).text_color(chosen || open ? t.foreground : t.muted).child(q.text))
          .when(Boolean(chosen), (el) => el.child(div().text_size(11.5).text_color(t.accent).child(`→ ${chosen.text}`)))))
      .when(open && !sending, (el) => el.child(v_flex().w_full().pl(26).gap(3)
        .when(Boolean(q.multi), (el) => el.child(div().text_size(10.5).text_color(t.dim).child("Pick any")))
        .children(q.options.map((o, j) => h_flex().id(`qo-${ask.id}-${i}-${j}`).w_full().px(8).py(4).gap(6).items_start().rounded(6).border_1()
          .border_color(q.recommended === j || picked.has(o.n) ? t.accent : t.border).bg(t.surface).cursor_pointer().hover((s) => s.bg(t.hover).border_color(t.input))
          .on_click(pick(o))
          .when(Boolean(q.multi), (el) => el.child(div().flex_none().text_size(12).text_color(picked.has(o.n) ? t.accent : t.dim).child(picked.has(o.n) ? "☑" : "☐")))
          .child(div().flex_1().min_w(0).text_size(12).tooltip(o.detail || o.label).child(o.label))
          .when(q.recommended === j, (el) => el.child(div().mt(2).text_size(10).flex_none().text_color(t.accent).child("recommends")))))
        .when(Boolean(q.multi) && picked.size > 0, (el) => el.child(h_flex().id(`qn-${ask.id}-${i}`).px(8).py(4).rounded(6).text_size(11.5).text_color(t.foreground).cursor_pointer()
          .hover((s) => s.bg(t.hover)).on_click((_e, cx) => { this.draft(ask.id, i, this.drafts[ask.id]?.[i]); cx.notify(); }).child("Next")))
        .when(typable, (el) => el.child(this.boxOpen(key)
          ? this.box(key, t, "Keep")
          : h_flex().id(`qt-${ask.id}-${i}`).px(8).py(4).rounded(6).text_size(11.5).text_color(t.muted).cursor_pointer().hover((s) => s.text_color(t.foreground))
              .on_click((_e, cx) => this.toggleBox(key, "Type your answer", keep, cx))
              .child(q.options.length ? "Other answer…" : "Type an answer…")))));
  }

  card(ask, t, now) {
    const sending = ask.state === "sending", failed = ask.state === "failed", tabs = ask.delivery === "tabs";
    const questions = questionsOf(ask), drafts = this.drafts[ask.id] ?? {}, drafted = questions.filter((_, i) => drafts[i]).length;
    const color = t[KIND[ask.kind] ?? "dim"];
    const wide = this.openCtx.has(ask.id);
    // "More": what the agent said before it stopped, when it says more than the card does.
    const said = ask.message || (ask.delivery === "send" ? ask.raw : "") || "", more = this.more.has(ask.id);
    const canMore = Boolean(one(said)) && one(said) !== one(ask.context) && one(said) !== one(ask.question);
    const recommendable = questions.some((q, i) => !drafts[i] && q.recommended != null && q.options[q.recommended]);
    const canSay = !sending && !tabs && !ask.wizard && ask.kind !== "UNCLEAR" && ask.kind !== "APPROVAL";
    const canRefuse = !sending && ask.kind === "APPROVAL" && Boolean(ask.amend) && ask.options.some((o) => /^no\b/i.test(o.label));
    const chip = (text, c) => div().px(5).h(16).flex_none().flex().items_center().rounded(4).text_size(10).font_semibold().bg(c).opacity(0.9).text_color(t.background).child(text);
    const action = (id, icon, label, fn, primary) => h_flex().id(id).h(26).px(8).gap(5).items_center().rounded(7).flex_none().text_size(11.5).cursor_pointer()
      .border_1().border_color(primary ? t.input : t.border).bg(primary ? t.raised : t.surface).text_color(primary ? t.foreground : t.muted)
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => fn(cx)).child(svg(icon).size(12)).child(label);
    const option = (o, i) => v_flex().id(`opt-${ask.id}-${o.n}`).w_full().px(10).py(6).gap(2).rounded(8).border_1().border_color(ask.recommended === i ? t.accent : t.border).bg(t.background)
      .when(!sending, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).border_color(t.input)).on_click((_e, cx) => this.answer(ask, o, cx)))
      .child(h_flex().gap(8).items_start()
        .child(div().w(18).h(18).mt(1).flex_none().rounded(4).flex().items_center().justify_center().text_size(10.5).font_semibold().bg(t.raised).text_color(t.muted).child(String(o.n)))
        .child(div().flex_1().min_w(0).text_size(12.5).child(o.label))
        .when(ask.recommended === i, (el) => el.child(div().mt(3).text_size(10).flex_none().text_color(t.accent).child("recommends"))))
      .when(Boolean(o.detail), (el) => el.child(div().pl(26).text_size(11).text_color(t.dim).child(o.detail)));
    const say = (text, cx) => { const a = this.find(ask.id); if (a) this.sendText(a, text, cx); };
    const refuse = (text, cx) => { const a = this.find(ask.id); if (a) this.sendReason(a, text, cx); };
    return v_flex().id(`ask-${ask.id}`).w_full().p(12).gap(8).rounded(10).bg(t.surface).border_1().border_color(failed ? t.blocked : t.border)
      .child(h_flex().gap(8).items_start()
        .child(div().flex_none().mt(2).child(iconOf(ask.program, 16, t.muted)))
        .child(h_flex().flex_1().min_w(0).flex_wrap().gap_x(6).items_start()
          .child(div().min_w(0).font_semibold().text_size(12.5).child(ask.agent))
          .when(this.all && Boolean(ask.space_name), (el) => el.child(div().min_w(0).mt(1).text_size(11).text_color(t.dim).child(`· ${ask.space_name}`))))
        .when(sending, (el) => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .child(div().flex_none().mt(1).text_size(11).text_color(t.dim).child(age(now - ask.detected_at))))
      // The context starts as one cut line beside the kind chip; a click on the row opens it in full, another closes it.
      // Open, it runs on from the chip and its next lines start at the card's edge: a word a child, in a wrapping row.
      // "More" at its end ("Less" when open) shows what the agent said, under the row.
      .child(h_flex().id(`ctx-${ask.id}`).w_full().items_center()
        .when(!wide, (el) => el.gap(8).child(chip(ask.kind, color)))
        .when(wide, (el) => el.flex_wrap().gap_x(3).child(chip(ask.kind, color)).child(div().w(2).flex_none())
          .children(one(ask.context).split(" ").map((w) => div().min_w(0).truncate().text_size(11).text_color(t.dim).child(w))))
        .when(Boolean(ask.context), (el) => el.cursor_pointer()
          .on_click((_e, cx) => { if (wide) this.openCtx.delete(ask.id); else this.openCtx.add(ask.id); cx.notify(); }))
        .when(Boolean(ask.context) && !wide, (el) => el.child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).hover((s) => s.text_color(t.muted)).child(ask.context)))
        .when(!ask.context && canMore, (el) => el.child(div().flex_1()))
        .when(canMore, (el) => el.child(div().id(`more-${ask.id}`).flex_none().text_size(11).text_color(t.muted).cursor_pointer().hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); if (more) this.more.delete(ask.id); else this.more.add(ask.id); cx.notify(); })
          .child(more ? "Less" : "More"))))
      .when(canMore && more, (el) => el.child(v_flex().w_full().gap(4).px(8).py(6).rounded(8).bg(t.background)
        .child(div().w_full().text_size(11.5).text_color(t.muted).whitespace_normal().child(said.split("\n").slice(-60).join("\n")))
        .children(linksIn(said).slice(0, 8).map((url, k) => h_flex().id(`link-${ask.id}-${k}`).w_full().gap(5).items_start().cursor_pointer()
          .text_size(11.5).text_color(t.accent).hover((s) => s.underline()).on_click((_e, cx) => cx.open_url(url))
          .child(div().flex_none().child("↗")).child(div().flex_1().min_w(0).child(url))))))
      .child(div().w_full().text_size(13).text_color(t.foreground).child(ask.question || (ask.enriched ? "Needs you in the terminal" : "Reading the dialog…")))
      .when(ask.options.length > 0 && ask.kind !== "UNCLEAR", (el) => el.child(v_flex().w_full().gap(5).children(ask.options.map(option))))
      .when(questions.length > 1 || (tabs && questions.length > 0), (el) => el.child(v_flex().w_full().gap(4).children(questions.map((q, i) => this.question(ask, q, i, t, sending)))))
      .when(ask.kind === "UNCLEAR" && ask.enriched, (el) => el.child(div().text_size(11.5).text_color(t.dim).child("Asks could not read this dialog. Open the terminal to answer it.")))
      .when(this.boxOpen(ask.id), (el) => el.child(this.box(ask.id, t, "Send")))
      .when(this.boxOpen(`${ask.id}:no`), (el) => el.child(this.box(`${ask.id}:no`, t, "Send no")))
      .when(failed, (el) => el.child(div().text_size(11.5).text_color(t.blocked).child(ask.error ?? "Failed")))
      .child(h_flex().gap(6).items_center().flex_wrap()
        .when(failed, (el) => el.child(action(`retry-${ask.id}`, "mods/asks/send.svg", "Retry", (cx) => this.retry(ask, cx), true)))
        // A dialog takes its answers all at once; a prose question takes what there is.
        .when(!sending && drafted > 0 && (!tabs || drafted === questions.length), (el) => el.child(action(`send-${ask.id}`, "mods/asks/send.svg", `Send answers (${drafted}/${questions.length})`, (cx) => this.sendDrafts(ask, cx), true)))
        .when(!sending && recommendable, (el) => el.child(action(`rec-${ask.id}`, "mods/asks/check.svg", drafted ? "Recommended for the rest" : "Take recommended", (cx) => { this.recommend(ask, false); cx.notify(); })))
        .when(canSay, (el) => el.child(action(`other-${ask.id}`, "mods/asks/send.svg", this.boxOpen(ask.id) ? "Cancel" : ask.options.length ? "Other answer" : "Answer",
          (cx) => this.toggleBox(ask.id, "Type your answer", say, cx))))
        .when(canRefuse, (el) => el.child(action(`no-${ask.id}`, "mods/asks/x.svg", this.boxOpen(`${ask.id}:no`) ? "Cancel" : "No, because…",
          (cx) => this.toggleBox(`${ask.id}:no`, "Why not, or what to do instead", refuse, cx))))
        .when(!ask.notice, (el) => el.child(action(`open-${ask.id}`, "mods/asks/terminal.svg", "Open terminal", () => this.open(ask))))
        .child(div().flex_1())
        .when(!sending, (el) => el.child(action(`dismiss-${ask.id}`, "mods/asks/x.svg", "Dismiss", () => this.set(ask.id, { state: "dismissed", ended_at: Date.now() })))));
  }

  receipt(ask, t, now) {
    const delivered = ask.state === "delivered";
    return h_flex().id(`rc-${ask.id}`).w_full().min_h(26).px(8).py(4).gap(7).items_start().rounded(7).text_size(11.5).text_color(t.muted).hover((s) => s.bg(t.hover))
      .cursor_pointer().on_click(() => this.open(ask))
      .child(svg(delivered ? "mods/asks/check.svg" : "mods/asks/x.svg").size(11).mt(4).flex_none().text_color(delivered ? t.done : t.dim))
      .child(div().flex_none().max_w(90).truncate().text_color(t.foreground).tooltip(ask.agent).child(ask.agent))
      .child(div().flex_1().min_w(0).child(delivered ? `→ ${one(ask.answer)}` : ask.note ?? ask.state))
      .child(div().flex_none().text_color(t.dim).child(age(now - (ask.answered_at ?? ask.ended_at ?? ask.detected_at))));
  }

  render(cx) {
    const t = theme(), now = Date.now();
    const space = spaces().find((s) => s.active), spaceId = space?.id ?? focused()?.space;
    const all = readState().asks.filter((a) => a.notice || this.all || a.space === spaceId);
    const pending = all.filter((a) => a.state === "pending" || a.state === "sending" || a.state === "failed");
    const done = all.filter((a) => !pending.includes(a) && a.state !== "dismissed");
    const today = done.filter((a) => a.state === "delivered" && now - a.answered_at < 86400000).length;
    const toggle = (id, label, on, fn) => div().id(id).h(20).px(7).flex_none().flex().items_center().rounded(5).text_size(11).cursor_pointer()
      .bg(on ? t.selected : t.background).text_color(on ? t.foreground : t.dim).hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => { fn(); cx.notify(); }).child(label);
    return v_flex().id("asks").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child(this.config?.label ?? "Asks"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(this.all ? "All spaces" : space?.name ?? ""))
        .child(toggle("asks-all", "All", this.all, () => { this.all = !this.all; localStorage.setItem("scope", this.all ? "all" : "space"); })))
      .child(div().px(14).py(7).flex_none().text_size(11.5).text_color(t.dim).child(`${pending.length} waiting · ${today} answered today`))
      .child(v_flex().id("asks-list").flex_1().min_h(0).overflow_y_scrollbar().px(8).pb(8).gap(8)
        .children(pending.map((a) => this.card(a, t, now)))
        .when(pending.length === 0, (el) => el.child(div().p(10).text_size(12).text_color(t.dim).child(`No asks waiting in ${this.all ? "any space" : space?.name ?? "this space"}. Agents show up here when they stop to ask you something.`)))
        .when(done.length > 0, (el) => el.child(v_flex().w_full().gap(2).pt(6)
          .child(h_flex().id("asks-done").h(24).px(8).gap(6).items_center().text_size(11).font_medium().text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground))
            .on_click((_e, cx) => { this.showAnswered = !this.showAnswered; cx.notify(); })
            .child(div().child("Answered")).child(div().child(String(done.length))).child(div().flex_1())
            // Clear: forget every finished card in this list (the scope shown), waiting ones stay.
            .child(div().id("asks-clear").px(6).h(18).flex().items_center().rounded(4).text_size(10.5).text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
              .on_click((_e, cx) => { cx.stop_propagation(); const ids = new Set(done.map((a) => a.id)); update((s) => { s.asks = s.asks.filter((a) => !ids.has(a.id)); }); cx.notify(); })
              .child("Clear"))
            .child(svg(`mods/workspace-chrome/chevron-${this.showAnswered ? "down" : "right"}.svg`).size(11).text_color(t.dim)))
          .when(this.showAnswered, (el) => el.children(done.slice(0, 30).map((a) => this.receipt(a, t, now)))))));
  }
}
