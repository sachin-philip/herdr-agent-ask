// Claude Code's AskUserQuestion dialog, read off the screen. Pure functions, no Herdr
// import. The same file lives in mods/asks/ and mods/tabs-asks/ (mods import only their own
// folder): keep both copies identical.

// Claude Code's dialog for several questions at once (or for one with several picks) draws
// a tab bar over them: "←  ☐ Colour  ☒ Size  ✔ Submit  →" (☒: answered). Its status
// report names only the first question; the others are read from the screen, one tab at a
// time. Only a bar in the last 40 lines counts, and none above the person's last prompt.
const TABBAR = /^\s*←\s+(.*?)\s+→\s*$/;
const OPTION_LINE = /^\s*(❯\s*)?(\d{1,2})\.\s+(.*?)\s*$/;
const RULE_LINE = /^[\s─╌═━]+$/;
// Claude Code may draw a bar before a tab's question: "│ Which colour?".
const QUOTE_BAR = /^\s*│\s?/;
function lastBar(lines) {
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 40); i--) {
    if (TABBAR.test(lines[i])) return i;
    if (/^❯\s+\S/.test(lines[i]) && !OPTION_LINE.test(lines[i])) return -1;
  }
  return -1;
}

// The tabs, one per question, in order: [{ header, answered }], or null for no tab bar.
export function parseTabs(text) {
  const lines = (text ?? "").replace(/\r/g, "").split("\n");
  const i = lastBar(lines);
  if (i < 0) return null;
  const tabs = TABBAR.exec(lines[i])[1].split(/\s{2,}/).map((s) => /^([☐☒])\s+(.+)$/.exec(s.trim())).filter(Boolean)
    .map((x) => ({ header: x[2].trim(), answered: x[1] === "☒" }));
  return tabs.length ? tabs : null;
}

// The tab on screen: its question, its options ({ n, label, detail }; a multi-pick tab's
// "[ ] " is taken off and `multi` set), the number of its "Type something" row (`other`),
// the cursor's row, and whether it is the closing "Review your answers" page (`review`,
// with the number of "Submit answers" in `submit`). A question too long for the terminal's
// width runs on over the next lines, up to a blank line or the first option: all of it is
// the question.
export function parseTab(text) {
  const lines = (text ?? "").replace(/\r/g, "").split("\n");
  const bar = lastBar(lines);
  if (bar < 0) return null;
  let question = "", asked = false, other = null, cursor = null, multi = false, submit = null, last = null;
  const options = [];
  for (const line of lines.slice(bar + 1)) {
    const m = OPTION_LINE.exec(line);
    if (!m) {
      const text = line.replace(QUOTE_BAR, "").trim();
      if (!options.length && other == null && !asked && text && !RULE_LINE.test(line)) question = question ? `${question} ${text}` : text;
      else if (last && !last.detail && /^\s{4,}\S/.test(line) && !RULE_LINE.test(line)) last.detail = line.trim();
      if (question && (!text || RULE_LINE.test(line))) asked = true;
      if (RULE_LINE.test(line) && (options.length || other != null)) break;
      last = null;
      continue;
    }
    const n = Number(m[2]);
    if (m[1]) cursor = n;
    let label = m[3];
    const box = /^\[([ ✔✓xX])\]\s+(.*)$/.exec(label);
    if (box) { multi = true; label = box[2]; }
    last = null;
    if (/^Type something\.?$/i.test(label)) { other = n; continue; }
    if (/^Chat about this$/i.test(label)) break;
    if (/^Submit answers$/i.test(label)) submit = n;
    last = { n, label, detail: "", ...(box ? { checked: box[1] !== " " } : {}) };
    options.push(last);
  }
  const review = submit != null || /^Review your answers/i.test(question);
  const rec = options.findIndex((o) => /\(recommended\)/i.test(o.label));
  const incomplete = review && lines.slice(bar + 1).some((l) => /not answered all/i.test(l));
  return { question, options, recommended: rec >= 0 ? rec : null, other, cursor, multi, review, submit, incomplete };
}

// The numbered rows of the dialog at the bottom of a screen, and the row the cursor is on.
export function optionRows(text) {
  let options = [], cursor = null;
  for (const line of (text ?? "").replace(/\r/g, "").split("\n")) {
    const m = OPTION_LINE.exec(line);
    if (!m) continue;
    const n = Number(m[2]);
    if (options.length && n !== options.at(-1).n + 1) { options = []; cursor = null; }
    if (!options.length && n !== 1) continue;
    options.push({ n, label: m[3] });
    if (m[1]) cursor = n;
  }
  return { options, cursor };
}
