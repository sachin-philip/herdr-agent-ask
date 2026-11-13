// What the engine reads off a terminal: Claude Code's and Codex's screens, Claude Code's
// status report, and the classifier's answer. Pure functions, no Herdr import: `node --test
// tests/` runs them against real screens in tests/fixtures.

// A prompt the person sent, not the input box at the bottom (which sits under a rule
// and may hold text typed but not yet sent), nor a dialog's cursor ("❯ 1. Yes").
function sentPrompt(lines, i) {
  if (!/^❯\s+\S/.test(lines[i]) || OPTION.test(lines[i])) return false;
  let j = i - 1;
  while (j >= 0 && !lines[j].trim()) j--;
  return !(j >= 0 && RULE.test(lines[j]));
}

// A list of separate questions is not a list of answers. If the model returned the
// questions as options (or several questions at once), there is nothing to click: the
// card lists the questions and takes one typed answer.
export function normalize(model) {
  if (!model) return model;
  const isQ = (s) => /\?\s*$/.test(s);
  const sub = (q) => {
    const o = typeof q === "string" ? { text: q } : q ?? {};
    const options = (Array.isArray(o.options) ? o.options : []).map((x) => String(x).trim()).filter((x) => x && !isQ(x));
    const recommended = Number.isInteger(o.recommended) && o.recommended >= 0 && o.recommended < options.length ? o.recommended : null;
    return { text: String(o.text ?? "").trim(), options, recommended };
  };
  const questions = (Array.isArray(model.questions) ? model.questions : []).map(sub).filter((q) => q.text);
  const options = Array.isArray(model.options) ? model.options.map((o) => String(o).trim()).filter(Boolean) : [];
  const asking = options.filter(isQ).length;
  if (questions.length > 1 || (options.length > 1 && asking >= Math.ceil(options.length / 2))) {
    return { ...model, options: [], recommended: null, questions: questions.length > 1 ? questions : options.filter(isQ).map(sub) };
  }
  return { ...model, options, questions: [] };
}

export const SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    asks: { type: "boolean" },
    kind: { type: "string", enum: ["APPROVAL", "DECISION", "QUESTION", "UNCLEAR"] },
    question: { type: "string" },
    options: { type: "array", items: { type: "string" } },
    questions: { type: "array", items: { type: "object", properties: {
      text: { type: "string" }, options: { type: "array", items: { type: "string" } }, recommended: { type: ["integer", "null"] },
    }, required: ["text", "options", "recommended"], additionalProperties: false } },
    recommended: { type: ["integer", "null"] },
    context: { type: "string" },
    confidence: { type: "number" },
  },
  required: ["asks", "kind", "question", "options", "questions", "recommended", "context", "confidence"],
  additionalProperties: false,
});

const OPTION = /^\s*([>❯]\s*)?(\d{1,2})\.\s+(.*?)\s*$/;
const RULE = /^[\s─╌═━]+$/;

// Numbered options on a screen, with the cursor's line and the line under each option.
export function parseScreen(text) {
  // Some agents draw the dialog inside a box ("│ > 1. Yes"), and newer Claude Code draws a bar
  // before the question line ("│ Which colour?"): the borders come off first.
  const lines = (text ?? "").replace(/\r/g, "").split("\n").map((l) => l.replace(/^\s*│\s?/, "").replace(/\s*│\s*$/, ""));
  // Only the dialog at the bottom: start after the last rule above the first option run.
  let options = [], cursor = null, context = "", question = "";
  for (let i = 0; i < lines.length; i++) {
    const m = OPTION.exec(lines[i]);
    if (!m) continue;
    const n = Number(m[2]);
    if (options.length && n !== options.at(-1).n + 1) { options = []; cursor = null; }
    if (!options.length && n !== 1) continue;
    const detail = lines[i + 1] && !OPTION.test(lines[i + 1]) && !RULE.test(lines[i + 1]) && /^\s{4,}\S/.test(lines[i + 1]) ? lines[i + 1].trim() : "";
    options.push({ n, label: m[3], detail });
    if (m[1]) cursor = n;
  }
  if (options.length) {
    const first = lines.findIndex((l) => OPTION.exec(l)?.[2] === "1" && l.includes(options[0].label));
    for (let i = first - 1; i >= 0 && first - i < 12; i--) {
      const l = lines[i].trim();
      if (!l || RULE.test(l)) continue;
      if (/\?\s*$/.test(l) && !question) { question = l; continue; }
      if (question) break;
    }
  }
  // Context: the agent's last line of prose in the current turn (after the last prompt the person sent).
  // Claude Code marks its own lines ⏺ on macOS and ● elsewhere: both count.
  let start = 0;
  for (let i = lines.length - 1; i >= 0; i--) if (sentPrompt(lines, i)) { start = i; break; }
  for (let i = lines.length - 1; i >= start; i--) {
    const l = lines[i];
    if (/^[⏺●]\s+\S/.test(l) && !/^[⏺●]\s+(User answered|Write\(|Read\(|Bash\(|Edit\()/.test(l)) { context = l.replace(/^[⏺●]\s+/, "").trim(); break; }
  }
  return { options, cursor, context, question };
}

// Claude Code says what it wants in its status report: no model needed.
export function parseReport(report) {
  const msg = report?.msg ?? "";
  if (report?.kind === "question") {
    const m = /^answer:\s*([\s\S]*?)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*$/.exec(msg);
    if (m) {
      const opts = m[2].split(" · ").map((s) => s.trim()).filter(Boolean);
      const rec = opts.findIndex((o) => /\(recommended\)/i.test(o));
      return { kind: "DECISION", question: m[1], options: opts.map((label, i) => ({ n: i + 1, label, detail: "" })), recommended: rec >= 0 ? rec : null, source: "report" };
    }
    return { kind: "QUESTION", question: msg.replace(/^answer:\s*/, ""), options: [], recommended: null, source: "report" };
  }
  if (report?.kind === "permission") {
    const m = /^approve\s+([^:]+):\s*([\s\S]*)$/.exec(msg);
    return { kind: "APPROVAL", question: m ? `Allow ${m[1]}: ${m[2]}` : msg.replace(/^approve\s*/, "Allow "), options: [], recommended: null, source: "report" };
  }
  // Logged out (an expired or invalid login): nothing sent would get through, so the card
  // has no answers and says where to fix it.
  if (report?.kind === "auth") return { kind: "STOPPED", question: `Logged out: run /login in the terminal.${msg ? ` (${msg})` : ""}`, options: [], recommended: null, source: "report" };
  if (report?.kind) return { kind: "UNCLEAR", question: msg || `${report.kind}`, options: [], recommended: null, source: "report" };
  return null;
}

// Codex: the person's prompts start with `›`, the agent's messages with `•` (continuation
// lines indented two spaces), tool calls are `•` bullets too (`Ran`, `Explored`, `Called`…)
// with their output under `└`, and a turn ends with `Worked for 4s • 9:14 PM`. The input box
// at the bottom is also a `›` line (`Ask Codex to do anything`, or text typed but not sent):
// a prompt counts only when a `•` line follows it before the next `›`.
const CODEX_TOOL = /^•\s+(Ran|Explored|Called|Edited|Read|Searched|Updated Plan|Proposed|Added|Deleted|Wrote|Listed|Web search|Viewed|Created)\b/;
export function parseCodexMessage(text) {
  const lines = (text ?? "").replace(/\r/g, "").split("\n");
  let start = -1;
  for (let i = lines.length - 1; i >= 0 && start < 0; i--) {
    const m = /^›\s+(\S.*)$/.exec(lines[i]);
    if (!m || /^Ask Codex to do anything/.test(m[1])) continue;
    for (let j = i + 1; j < lines.length && !/^›/.test(lines[j]); j++) if (/^•\s/.test(lines[j])) { start = i; break; }
  }
  if (start < 0) return { message: "", hasQuestion: false };
  const out = [];
  let skipping = false;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^›/.test(l) || /^\s+Worked for\s/.test(l)) break;
    if (/^\s*[⚠■]/.test(l)) continue;
    if (/^•\s/.test(l)) {
      skipping = CODEX_TOOL.test(l);
      if (!skipping) out.push(l.replace(/^•\s+/, "").trimEnd());
      continue;
    }
    if (skipping) continue;
    out.push(l.replace(/^\s{2}/, "").trimEnd());
  }
  const message = out.join("\n").trim();
  return { message, hasQuestion: /\?(\s|$)/.test(message) };
}

// The agent's own words since the person's last prompt, without tool lines and the
// "✻ done" footer: what a finished turn said. hasQuestion is the cheap pre-filter.
// `app` (the terminal's status report) picks the screen format; without it, Claude Code's
// is tried first and Codex's when that finds no prompt.
export function parseLastMessage(text, app = null) {
  if (app === "codex") return parseCodexMessage(text);
  const r = parseClaudeMessage(text);
  return r.message || app ? r : parseCodexMessage(text);
}

export function parseClaudeMessage(text) {
  const lines = (text ?? "").replace(/\r/g, "").split("\n");
  let start = -1;
  for (let i = lines.length - 1; i >= 0; i--) if (sentPrompt(lines, i)) { start = i; break; }
  if (start < 0) return { message: "", hasQuestion: false };
  // Skip the prompt's own continuation lines.
  let i = start + 1;
  while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*[⏺●•·✻✢✶✽*]/.test(lines[i])) i++;
  const out = [];
  let skipDialog = false;
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (/^[✻✢✶✽*]\s.*·\s*(done|idle)/.test(l) || RULE.test(l) || /^❯/.test(l)) break;
    if (/^\s*(⎿|Searched for|Read \d|Ran \d|Listed \d|Wrote \d|Edited \d)/.test(l)) continue;
    // A dialog the person answered or declined leaves "⏺ User declined to answer questions" and
    // the questions under it on screen: not something the agent is asking now.
    if (/^[⏺●]\s+User (declined|answered)/.test(l)) { skipDialog = true; continue; }
    if (skipDialog && /^\s{2,}/.test(l)) continue;
    skipDialog = false;
    if (/^[⏺●•]\s+(Write|Read|Bash|Edit|Grep|Glob|Update|Search|Task)\(/.test(l)) continue;
    out.push(l.replace(/^[⏺●•]\s+/, "").trimEnd());
  }
  const message = out.join("\n").trim();
  return { message, hasQuestion: /\?(\s|$)/.test(message) };
}
