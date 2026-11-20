// Shared state and helpers for the Asks mods. The same file lives in mods/asks/ and
// mods/tabs-asks/ (mods import only their own folder). Keep both copies identical.
import { shared, setShared, readTextFile, appHome, terminals, agents, exec } from "herdr";

export const KEY = "asks.state";
export const SCHEMA = 1;
export const MAX_ASKS = 60;
export const KEEP_MS = 24 * 3600 * 1000;
export const DEFAULTS = { label: "Asks", toast: false, log: "~/.config/herdr-app/decisions/{space}.md", classify: "auto", classifier: "auto", model: "haiku", codex_model: "", trailing_questions: true };
// toast is off: Herdr already posts "needs you" for a blocked agent; true adds a second toast with the question.

// Claude Code's AskUserQuestion with several questions (a "wizard") draws a tab bar over the
// dialog: "←  ☐ Focus  ☐ Skill doctor  ✔ Submit  →". Its status report names only the first
// question and never changes from tab to tab, so a number key plus Enter would answer the next
// question with whatever is highlighted. The panel never presses keys while that bar is up.
const TABBAR = /^\s*←\s+(.*[☐☒].*?)\s+→\s*$/;
export function wizardOn(text) {
  const lines = (text ?? "").replace(/\r/g, "").split("\n").slice(-40);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = TABBAR.exec(lines[i]);
    if (m) return m[1].split(/\s{2,}/).map((s) => s.trim().replace(/^[☐☒]\s*/, "")).filter((s) => s && !/^✔/.test(s));
  }
  return null;
}
// The person said no to the dialog in the terminal: not an answer, whatever the status says.
export function declinedOn(text) {
  // Only the current turn counts: the lines after the person's last sent prompt (a dialog's
  // cursor line "❯ 1. Yes" is not a prompt), so an interruption from an earlier turn is ignored.
  const lines = (text ?? "").replace(/\r/g, "").split("\n");
  let start = Math.max(0, lines.length - 15);
  for (let i = lines.length - 1; i >= 0; i--) if (/^❯\s+\S/.test(lines[i]) && !/^❯\s*\d{1,2}\.\s/.test(lines[i])) { start = i; break; }
  return /User declined to answer|doesn't want to proceed|Request interrupted|Interrupted ·/.test(lines.slice(start).join("\n"));
}

// One line per answer in the decisions log; used by every path that marks a card delivered.
// `~/…` is the person's home; `{space}` the space's name, `{repo}` the agent's folder; a
// relative path is inside the agent's folder.
export async function logAnswer(ask, config, at, note) {
  const slug = (s) => (s ?? "").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "space";
  const rel = (config?.log ?? DEFAULTS.log).replace(/\{space\}/g, slug(ask.space_name)).replace(/\{repo\}/g, slug((ask.cwd ?? "").split("/").pop()));
  if (!rel) return;
  if (!rel.startsWith("/") && !rel.startsWith("~/") && !ask.cwd) return;
  const path = rel.startsWith("/") || rel.startsWith("~/") ? rel : `${ask.cwd}/${rel}`;
  const one = (s) => (s ?? "").replace(/\s+/g, " ").trim();
  const d = new Date(at), p2 = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  const repo = (ask.cwd ?? "").split("/").pop();
  const line = `- ${stamp} · ${one(ask.agent)}${repo ? ` @ ${repo}` : ""} · ${ask.kind} · ${one(ask.question)} → ${one(ask.answer)}${note ? ` (${note})` : ""}`;
  try { await exec("sh", ["-c", 'case "$2" in "~/"*) p="$HOME/${2#\\~/}";; *) p="$2";; esac; d=$(dirname "$p"); mkdir -p "$d" && printf "%s\\n" "$1" >> "$p"', "asks", line, path]); } catch {}
}

export function readState() {
  const s = shared(KEY);
  return s && s.schema === SCHEMA && Array.isArray(s.asks) ? s : { schema: SCHEMA, asks: [] };
}

// Read, change, write. Writes only when something changed so mods don't re-render for nothing.
export function update(fn) {
  const before = JSON.stringify(readState());
  const s = JSON.parse(before);
  const out = fn(s);
  const after = JSON.stringify(s);
  if (after !== before) setShared(KEY, s);
  return out;
}

export async function loadConfig() {
  try {
    const text = await readTextFile(`${appHome()}/asks.json`);
    return text ? { ...DEFAULTS, ...JSON.parse(text) } : { ...DEFAULTS };
  } catch { return { ...DEFAULTS }; }
}

export function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

// hc ls describes status as {app, state, kind?, msg?}; the app flattens it to a word and
// keeps the report in `report`. Accept either shape.
export function statusOf(t) {
  return typeof t?.status === "string" ? t.status : t?.status?.state ?? null;
}
export function reportOf(t) {
  if (t?.report && typeof t.report === "object") return t.report;
  return typeof t?.status === "object" && t.status ? t.status : null;
}
export function msgOf(t) { return reportOf(t)?.msg ?? ""; }

export function liveTerminal(address) {
  return terminals().find((t) => t.address === address && t.state === "live") ?? null;
}

// The agent still sits at the same dialog it did when the ask was made.
export function stillAsking(ask) {
  const t = liveTerminal(ask.address);
  return Boolean(t) && statusOf(t) === "blocked" && msgOf(t) === ask.msg;
}

// A prose question (the agent ended its turn asking) is still open while the agent sits on
// that same turn, not working and not at a dialog. A turn that stopped on an error (a
// `stopped` card) is open while the agent still reports that error on that turn.
export function stillIdle(ask) {
  const t = liveTerminal(ask.address);
  const st = statusOf(t);
  return Boolean(t) && (st === "idle" || st === "done" || (Boolean(ask.stopped) && st === "error")) && (t.turn ?? 0) === (ask.turn ?? 0);
}

export function agentFor(address) {
  return agents().find((a) => a.address === address) ?? null;
}

// The sidebar's name for an agent: a named tab, else what the terminal says, else the program.
export function agentName(a, t) {
  if (!a) return t?.name || t?.address || "agent";
  const tab = a.tab_name ?? "";
  if (tab && !/^\d+$/.test(tab)) return tab;
  const title = (a.title ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
  if (title && title !== a.program?.name && !/^[~/]/.test(title)) return title;
  return a.program?.name || tab || a.address;
}

export function age(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}
