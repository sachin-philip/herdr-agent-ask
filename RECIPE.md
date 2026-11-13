# Asks

Every question your agents ask in a space, in one side panel. Whether an agent stops at a
permission dialog, offers a menu of options, or simply ends its turn with a plain-text question,
it appears here as a card the moment it happens, so you see what every agent is waiting on and
keep track of the space as a whole without opening each terminal. Answer on the card and the
answer goes straight into that agent's terminal; each answer is logged for the next agent. An
Asks button in the tab bar counts what is waiting, and each space in the sidebar shows its own
count.

![Asks](preview.png)

This file is the brief: enough to build it from an empty folder. The files next to it are one
build of it, shared as a layout: `layouts/asks.json` is Herdr's main layout with the
tab bar and spaces list pointed at the two clones and the panel added, so copying the layout
and the three mods and switching to it is all it takes. To keep a layout of your own instead,
run `node install.mjs`, which clones the layout you are showing and makes the same three
changes to the clone. Before adding it, know that it runs `hc` to read and answer terminals,
`claude -p` for plain-text questions, and a shell to append to the decisions log.

## What you see

- In the tab bar, left of `Files`: a 26 px button, speech-bubble icon (`mods/tabs-asks/asks.svg`)
  and the word `Asks` (the `label` setting), styled like the Files and Changes buttons (`t.selected` when its panel
  shows). When questions wait in the shown space, a 16 px red pill (`theme().blocked` on
  `theme().background`, 10.5 px semibold) with the count; when only other spaces have some, dim
  text `+N` or `N elsewhere`.
- The panel is a child of the layout's existing `panel-body` stack, so it opens where Files
  opens, at the same width (368 px, min 280, max 900 in `main`), and is hidden by default.
  Rounded 10 px card, `t.background`, 1 px `t.border`, like Files.
- Header, 42 px: `Asks` semibold; the space name right-aligned in `t.dim` (or `All spaces`);
  a 20 px `All` toggle chip.
- A dim line: `N waiting · M answered today`.
- Cards, 12 px padding, `t.surface`, 10 px radius, 8 px apart, newest first:
  1. the agent's program icon (16 px), its sidebar name semibold, the space name when `All` is on
     (beside the name when both fit, else on the next line), a spinner while sending, the age
     (`<1m`, `3m`, `2h`). Every text on a card wraps in the card's width and is never cut
     short; a row whose text can run to several lines aligns to its first line, so its badge,
     chip or icon stays level with it.
  2. a kind chip, 16 px, 10 px semibold uppercase on a colour: `APPROVAL` on `t.blocked`,
     `DECISION` on `t.accent`, `QUESTION` on `t.working`, `STOPPED` on `t.blocked`, `UNCLEAR` on `t.dim`; then the context
     line (the agent's last prose line this turn) in `t.dim`: one line cut with an ellipsis; a
     click on the row opens it in full, running on from the chip with its next lines at the
     card's edge, and another click closes it. At the row's end, `More` (`Less` when open) when
     the agent's last message says more than the card. Open, it shows that message (its last 60
     lines) under the row on `t.background`, then up to 8 of its links as `↗ <url>` rows in
     `t.accent`; a click opens the link (`cx.open_url`, http(s) only).
  3. the question, 13 px, wrapping.
  4. one row per option: an 18 px number badge, the label verbatim (wrapping), `recommends` in
     `t.accent` on the option the agent recommended (its border is `t.accent` too), and the
     option's description under it in `t.dim`, wrapping.
  5. actions, 26 px: `Other answer` (toggles a box under the card: a textarea of 2 to 8 lines,
     `Send`, `Cancel` and the hint `Enter: new line · ⌘Enter: send`), `Take recommended` while
     a question with a recommendation has no answer (`Recommended for the rest` once one has),
     `No, because…` on an `APPROVAL` whose dialog says `Tab to amend` (its box sends with
     `Send no`), `Open terminal`, and `Dismiss` at the right. Each card keeps its own boxes and
     their half-typed text until sent. A failed card shows the error in `t.blocked` and a
     `Retry` button.
- Under the cards, a foldable `Answered N` list: one row (26 px or taller) per answered, stale
  or failed ask: a check (or x), the agent (one line, at most 90 px, in full on hover), `→ answer`
  or the note (`Resolved in terminal`, `Agent closed`), wrapping, the age. Clicking a row
  focuses that agent.
- A card for a message with several questions lists them as numbered rows under a one-line
  summary. Clicking a row unfolds the choices the agent gave for that question (its recommended
  one marked) and an `Other answer…` line; a pick turns the row's badge `t.accent` and shows
  `→ <answer>` under it. `Send answers (k/n)` appears once something is drafted. A pick opens
  the next unanswered question.
- A card for a dialog with several questions (tabs) lists them the same way, each under its
  header. A pick-any question shows ☐/☑ per option, `Pick any` and `Next`, and has no typed
  answer (Claude Code takes none there). `Send answers (n/n)` appears only when all have one.
- In the sidebar's spaces list, after a space's name: a 16 px red pill with the number of open
  questions waiting in that space (also in the narrow rail).
- Empty: `No asks waiting in <space>. Agents show up here when they stop to ask you something.`

## How it behaves

- An ask appears within two seconds of an agent turning `blocked` (sooner if something
  redraws the tab bar). Its identity is `address:turn:hash(report msg)`, so the same dialog is
  never listed twice and a new dialog from the same agent replaces the old card (old one:
  `Resolved in terminal`).
- Claude Code's status report is the source of truth: `kind: question`, `msg: "answer: <question>
  (<opt> · <opt> · …)"` gives a `DECISION` with verbatim options, the one containing
  `(Recommended)` marked; `kind: permission`, `msg: "approve <Tool>: <target>"` gives an
  `APPROVAL` whose options (`Yes`, `Yes, and …`, `No`) come from the screen. Right after, the
  screen (`hc read <t> --json`) is read for option numbers, descriptions, the question line above
  a permission prompt, and the context line.
- Stopped turns: a terminal whose status is `error` (`{state: "error", msg: "API Error:
  Connection refused …"}`, Claude Code after its retries) gets one card per turn
  (`address:e:turn`): kind `STOPPED`, the report's `msg` as the question, `delivery: "send"`,
  `stopped: true` and one option `{label: "Continue", send: "continue"}`; an option's `send` is
  the message behind a button whose label is not the message. The card is open while the
  terminal reports `error` on that turn (`stillIdle` allows `error` for a `stopped` card), goes
  `Continued in terminal` 3 s after it does not; `asks.accept` presses its `Continue`. A logged-out agent
  reports `{state: "blocked", kind: "auth", msg: "Please run /login · …"}`: `parseReport` makes
  that a `STOPPED` card with no options, and the screen is not read for it. No model either way.
- Finished turns: every `done` or `idle` turn is checked once (`address:p:turn`, remembered in
  the shared state's `checked`, the first pass skipping turns already idle). The agent's words
  since the person's last prompt are taken: for Claude Code the last `❯` prompt (tool lines and
  the `✻ … done` footer dropped); for Codex (`parseCodexMessage`) the last `›` prompt that has a
  `•` line after it (the input box at the bottom is a `›` line too, `Ask Codex to do anything`
  or text typed but not sent), `•` tool bullets (`Ran`, `Explored`, `Called`, `Edited`…) and
  their `└` output dropped, stopping at the `Worked for 4s • 9:14 PM` footer. The terminal's
  reported `app` picks the format; without one, Claude Code's is tried, then Codex's;
  with a `?` in them, `claude -p` (`mode: message`) says whether the agent is waiting on the
  person (`asks`), the main question (`(+N more)` for several), any options it laid out, and a
  context line. `asks` true and confidence ≥ 0.6 make a `QUESTION` card with `delivery: "send"`.
  It stays open while the agent is idle or done on that same turn; a new turn (the person
  answered in the terminal) makes it `Answered in terminal`. The person's last prompt is the
  last `❯` line not sitting under a rule (the input box at the bottom is skipped).
- Several questions in one message come back from the model as `questions: [{text, options,
  recommended}]` and no top-level options (`normalize()` enforces it). Picks are drafts in the
  panel; `Send answers` delivers `1. <question> → <answer>` lines as one `hc send` message.
- Several questions in one dialog: Claude Code draws a tab bar (`←  ☐ Colour  ☐ Toppings
  ☐ Size  ✔ Submit  →`, ☒ once answered) and its report carries only the first question.
  `parseTabs` finds the bar (in the last 40 lines, below the person's last prompt);
  `Engine.readTabs` presses `right` once per later tab and reads each with `parseTab`
  (question, options with details, recommended, `multi`, the `Type something` row as `other`),
  then `left` back to the first, waiting for the screen each time. All read: `delivery:
  "tabs"`, `kind: DECISION`, the questions, and `3 questions: Colour · Toppings · Size` as the
  question. A tab already answered in the terminal, or one it can't read, makes it the wizard
  card: `wizard: true`, no options, `N questions in one dialog: … Answer them in the terminal.`
  (from `wizardOn`), and the panel presses no key for it.
  The classifier is never asked. One pick-any question gets a bar too and is read the same way.
- Sending a tabs card (`sendTabs`): every question needs an answer and the dialog must still be
  up. The dialog goes back to its first tab if it isn't there (stepping `up` off a `Type
  something` row first). Then per question: a pick presses its number (Claude Code moves on by
  itself); pick-any presses each option whose tick differs, then `right`; a typed answer presses
  the `Type something` number and `hc send --force`s the text. After each, the next question
  (or, after the last, the review page) must show within 6 s, else `failed` naming the question.
  The review page must not say `not answered all`; then `Submit answers`. Retry sends the kept
  answers again from the first tab. `asks.accept` on a tabs card takes every question's
  recommended (else first) option.
- `No, because…`: the cursor goes to `No` (`down`/`up` from where `optionRows` reads it), then
  `tab` (Claude Code's `Tab to amend`), then `hc send --force` with the reason. Delivered when the
  turn moves on or the dialog changes.
- `hc send` refuses a terminal whose output has not settled (`still starting`, e.g. right after a
  key the panel pressed): typed answers try again every 1.5 s, up to six times.
- A waiting card's `agent` and `space_name` follow `agents()` on every tick, so a renamed tab
  renames its card, and the decisions log uses the name at answer time.
- Other agents: numbered options on screen (`1.`, `❯ 2.` …) make a `DECISION` (`APPROVAL` when a
  `Yes` and a `No` are among them). With none, and `classify` not `off`, `claude -p
  --output-format json --json-schema … --model haiku` classifies the last 45 lines; its options
  must all appear verbatim on screen and confidence must be ≥ 0.6, else the card is `UNCLEAR`
  with `Open terminal` only.
- Clicking an option: first `terminals()` is checked (still live, still `blocked`, same report
  msg), else the card becomes `Resolved in terminal`. Then `hc keys <t> <n>`; `hc get` is polled
  every 0.4 s for up to 1.5 s, and if the same dialog is still there, `hc keys <t> enter`, then
  polled for up to 8 s. The dialog gone, or the terminal's `turn` past the one the answer was sent
  on, means delivered; still the same dialog after 8 s means `failed` with Retry. Claude Code
  selects on the number alone.
- On a `delivery: "send"` card, clicking an option sends its label (minus `(recommended)`) with
  `hc send <t> "<text>"`; the agent must still be idle or done on the same turn. Delivered means
  the agent is no longer idle, or its `turn` moved past the one the answer was sent on, polled for
  up to 8 s. The `turn` check matters: a fast agent can take the answer, reply and be `done` again
  before the first poll (issue #1), and hc holds a paste until nobody has typed in that terminal
  for ~3 s. The button reads `Answer` when there are no options.
- `Other answer`: `hc send --force <t> "<text>"` while the dialog is up (Claude Code's question
  dialog takes typed text as the answer); `hc send --if idle` otherwise. Same 8 s poll.
- `hc send --json` says whether the message `started` a turn. Codex sometimes drops a paste
  outright (seen on fresh agents right after a turn, about one send in three, not reproducible
  on demand): on `started: false` the panel reads the screen; the text on a prompt line
  (`› Spaces`, not anywhere on screen, since a short answer is usually in the question too)
  means Enter did not submit, so `hc keys enter`; otherwise `hc send --force` once more. One
  extra attempt at most.
- A `failed` card remembers `sent_turn`. Retry first checks the turn: moved on means the earlier
  answer landed late, so the card becomes delivered ("Picked up late") instead of sending twice.
  The engine's tick does the same; a failed card whose agent is gone becomes `Agent closed`, and
  one with no reaction for ten minutes becomes `Not delivered` in the Answered list. `Open
  terminal` on a closed agent marks the card `Agent closed` instead of a failed-command toast.
- The classifier backend (`Engine.backend`): `classifier` in asks.json, or `auto` = `claude` on
  PATH, else the newest `codex` among PATH, Homebrew, /usr/local and `~/.local/bin`
  (`Engine.codexBin`; Codex's installer leaves old copies that reject newer model names), else
  none plus a one-time notice. `askCodex` writes the schema to `asks-schema.json`, runs
  `codex exec --ephemeral --skip-git-repo-check -s read-only --output-schema … < /dev/null`
  (stdin must be closed or codex waits on it) and takes the last JSON line.
- Delivered: the card collapses into the Answered list and one line is appended to the
  decisions log, by default `~/.config/herdr-app/decisions/<space>.md` (`log` in asks.json;
  `{space}`, `{repo}`, `~/`, absolute, or relative to the agent's folder):
  `- 2026-11-07 22:41 · asks-test @ demo · DECISION · Which font should the heading use? → Geist (Recommended)`.
  Dismissed and stale cards are not logged.
- A pending ask whose agent is no longer blocked, shows another dialog, or is gone becomes stale
  (`Resolved in terminal` / `Agent closed`). Finished cards are kept 24 h, at most 60 in all.
- Key commands: `tabs-asks.toggle` (bound to `cmd-shift-a` under `layout:asks`), `tabs-asks.open`,
  `asks.accept` (answer the newest waiting ask in the shown space with its recommended option).
- Toasts: off by default (Herdr posts its own "needs you"); `toast: true` in
  `~/.config/herdr-app/asks.json` adds one with the question, clicking it opens the panel.
- The panel remembers `All` in its own localStorage; the tab bar remembers which panel each space
  had open, as the shipped tab bar does.

## Built from

- `mods/tabs-asks/main.js`: Herdr's shipped `tabs` mod (0.1.13) with: `panelButton("asks", …)`
  always present (the enabled list is `shared("workspace.panels")` plus `asks`), the badge,
  `togglePanel`, a `nextCommand()` loop (`toggle`, `open`), and an `Engine` created in `init`,
  ticked by `cx.timer.every(2000)` and from `render`. Its `win-*.svg` are copies of the shipped ones.
- `mods/tabs-asks/parse.js`: the pure parts, no Herdr import: `parseReport`, `parseScreen`,
  `parseLastMessage` (`parseClaudeMessage`, `parseCodexMessage`), `normalize`, `SCHEMA`.
  `node --test` runs `tests/*.test.mjs` against screens in `tests/fixtures` (captured with
  `hc read <t> --json --lines 100`), and GitHub Actions runs it on every PR.
- `mods/tabs-asks/engine.js`: `Engine.tick` (diff `terminals()` against the shared state;
  finished-turn pass; failed-card healing), `Engine.enrich` (screen read, model fallback),
  `Engine.readTabs` (with `waitTab`), `Engine.checkTurn`, `Engine.classify` (two prompt modes, `dialog` and `message`),
  `Engine.backend` / `Engine.codexBin` / `askClaude` / `askCodex`, `Engine.recheck`
  (`tabs-asks.recheck`).
  With no CLI, `backend()` puts one `NOTICE` card (`notice: true`, no space, shown in every
  space, Dismiss only, never counted in badges, skipped by the stale pass) and removes it once a
  CLI is found.
- `tests/herdr-stub.mjs` stands in for the `herdr` module (registered by `tests/register.mjs`);
  tests steer it through `globalThis.__herdr` (exec/hc handlers, terminals, an in-memory shared
  store), which is how `tests/classifier.test.mjs` runs the engine's backend choice and `tick`
  without the app.
- `scripts/check-mods.sh` loads the three mods in `herdr-app check`; `scripts/e2e.py` runs the
  live matrix (Claude alone, Codex alone, both) against the open window.
- `mods/spaces-asks/main.js`: Herdr's shipped `spaces` mod (0.1.13) with `waiting(spaceId)` over
  `shared("asks.state")` and a count pill in `row` and `compact`; `grouped` skips the machine
  headers when `group_spaces_by_machine` is `false` in asks.json (read in `init`, every 30 s),
  and `tail` then ends a row from another machine with its name unless `show_machine_names` is
  `false`.
- `mods/asks/main.js`: the panel. `answer`, `sendText`, `sendDrafts`, `sendTabs`, `sendReason`,
  `recommend`, `wizard`, `deliver`, `retry`, `open`, `card`, `question`, `receipt`, `render`. Text
  boxes are `TextareaState`s made on click (never in `render`), one per card and purpose (`id`,
  `id:i` per question, `id:no`) in `this.boxes`, kept until sent.
- `mods/asks/dialog.js` = `mods/tabs-asks/dialog.js`: `parseTabs`, `parseTab`, `optionRows`, the
  AskUserQuestion tabs and a dialog's rows, pure (`tests/dialog.test.mjs`).
- `mods/asks/state.js` = `mods/tabs-asks/state.js`: the shared record under
  `shared("asks.state")` (`{schema: 1, asks: [...]}`), `update(fn)` (writes only on change),
  `loadConfig()` from `~/.config/herdr-app/asks.json`, `statusOf`/`reportOf`/`msgOf` (status may
  be a word or `{app, state, kind, msg}`), `stillAsking`, `agentName` (named tab, else the
  terminal's title, else the program).
- Ask record: `id, address, pane, space, space_name, agent, program{key,name,icon,tint}, app, cwd,
  turn, msg, detected_at, state (pending|sending|delivered|failed|stale|dismissed), kind, question,
  options[{n,label,detail}], recommended, questions[{header?, text, options[{n,label,detail?}],
  recommended, multi?, other?}], context, message, amend, raw, source (report|screen|model|…),
  confidence, enriched, delivery (keys|send|tabs),
  answer, chosen, answered_at, ended_at, error, note`.
- `herdr` functions: `terminals`, `agents`, `spaces`, `focused`, `panes`, `layout`, `shared`,
  `setShared`, `run` (`layout.show|hide|select`, `pane.focus`, `agent.focus`), `hc` (`read`,
  `get`, `keys`, `send`), `exec` (`claude -p …`, `sh -c … >> decisions.md`), `notify`,
  `nextCommand`, `readTextFile`, `appHome`, `theme`, `settings`, `window`, `openOverlay` (the
  shipped tab menus).
- Layout `layouts/asks.json`: Herdr's shipped `main` (0.1.14) with the tab-bar block's
  `content.mod` set to `tabs-asks`, the spaces block's to `spaces-asks`, and `{ "id": "asks",
  "type": "block", "content": { "mod": "asks" } }` added to the `panel-body` stack (sidebar 268 px,
  panel 368 px, min 280, max 900, hidden). `keys.json`: `"layout:asks": { "cmd-shift-a":
  "tabs-asks.toggle" }` (and the same under `global`). `install.mjs` (Node 18+, the Herdr app
  open) makes the same three changes to a clone of the shown layout, named `asks`, carries that
  layout's keys along, and `--uninstall` reverses it.
- Icons: `asks.svg`, `check.svg`, `x.svg`, `terminal.svg`, `send.svg` (Lucide-style, stroke
  `currentColor`, drawn with `svg()` so they take the text colour).

## Watch out

- Copying `mods/` alone shows nothing: the shipped tab bar cannot grow a button and the shipped
  spaces list cannot grow a pill, so the layout must point at `tabs-asks` and `spaces-asks`.
  That is what the installer does; by hand it is three edits to a cloned layout file.
- The layout must have a tab-bar block (`content.mod: "tabs"`) and the `panel` / `panel-body`
  nodes; `main` and clones of it do. `terminals` and `win98` don't, and the installer stops.
  Without a spaces block (`content.mod: "spaces"`) the per-space count is skipped.
- A mod copy starts the first time it is shown. That is why detection is in the tab bar, not in
  the panel: a hidden stack child never runs until opened.
- `<mod>.<command>` reaches shown copies only: `asks.accept` works while the panel is open;
  `tabs-asks.*` always.
- `hc send` from inside another agent's terminal wraps text in `<hc from="…">` tags; from the app
  there is no parent terminal, so the text arrives bare. `notes = false` in
  `~/.config/herdr-core/config.toml` turns the tags off everywhere.
- A person can answer the dialog in the terminal while a card is open; the pre-send check and the
  1 s tick turn such cards stale. A key pressed by the panel after the dialog closed would land in the
  agent's prompt line, which is why the check happens right before `hc keys`.
- Claude Code's permission dialog option 2 is long (`Yes, and switch to accept edits … (shift+tab)`):
  it wraps onto a second line, never shortened in the data.
- The `❯` cursor line's label is what the person has typed into Claude Code's free-text option
  (e.g. `4. default gre`); it is parsed as an option only when the numbering runs from 1, and the
  report's options win over the screen's labels.
- The context line is the last `⏺` (macOS) or `●` (Linux) prose line after the last `❯` prompt
  (a dialog's cursor line, `❯ 1. Red`, is not a prompt); tool lines
  (`Write(`, `Bash(` …) and `User answered` are skipped. Before the screen is read the card says
  `Reading the dialog…`.
- `exec` has a 30 s limit; Haiku answers in 2–7 s. The model is never on the path for a Claude
  Code dialog, but it is for every finished turn with a `?` in it (`trailing_questions`).
- Do not filter finished turns by `report.app` or `t.agent`: the app's `terminals()` entries
  don't always carry them, and the first build silently skipped every turn because of that.
  `debug: true` in asks.json writes each step to `asks.log`; that is how it was found.
- The person's last prompt is the last `❯` line that is NOT under a rule: the input box at the
  bottom also starts with `❯` and may hold text typed but not sent, and anchoring on it makes
  the agent's message empty. `tabs-asks.recheck` re-runs the finished-turn check for every
  live agent's current turn, which is how to test a parser or prompt change on a real screen.
- A list of several questions is not a list of options. The classifier returns them in
  `questions` as `{text, options, recommended}`, and `normalize()` drops any top-level options
  that are mostly questions. The card lists the questions; clicking one unfolds its options and an
  `Other answer…` input, picks are drafts in the panel (`this.drafts[ask.id][i]`, not shared
  state), and `Send answers (k/n)` sends `1. <question> → <answer>` lines as one message. A
  multi-line `hc send` reaches Claude Code as one message (bracketed paste); verified.
- On a dialog's `Type something` row the arrow keys move the text cursor, so `left` there does
  not change tabs: step `up` off the row first.
- `readTabs` presses keys in the agent's terminal while it reads, about a second for three tabs.
  Someone typing in that terminal right then would see the tabs move; it ends on the first tab.
- The panel sends a box only on ⌘Enter (`secondary`) or `Send`; plain Enter adds a line.
- gpui-kit style setters want a value: `.bg(cond ? x : undefined)` fails the whole re-render with
  "expected a string, got nil" (the panel then shows its last good frame with a red bar). Use
  `.when(cond, el => el.bg(x))`.
- `spaces-asks` is a clone of the shipped `spaces` mod (`herdr-app do mod.clone --name spaces --as
  spaces-asks`) with `waiting(spaceId)` reading `shared("asks.state")` and a pill after the space
  name (and in the narrow rail). Mods re-render on every `setShared`, so it needs no timer.
- `shared()` is persisted and every mod re-renders on `setShared`, so `update()` compares JSON
  before writing and raw screen text is capped at 3000 characters per ask.
- The `agents()` list has no sub-agents without panes; an ask from one is keyed by address but has
  `pane: null`, and `Open terminal` uses `agent.focus` then.
- `herdr-app shot` returns the last drawn frame; when the window is idle it does not prove a
  redraw.

## Done when

- `herdr-app check` passes for `mods/asks`, `mods/tabs-asks` and `mods/spaces-asks`;
  `herdr-app status` lists no errors and `"layout": "asks"`.
- The tab bar shows `Asks` left of `Files`; clicking it opens the right panel at the Files
  width; clicking again hides it; `cmd-shift-a` does the same.
- With Claude Code in a space, `hc send <t> "Use the AskUserQuestion tool to ask which colour …
  Red, Green, Blue; recommend Green"` puts a `DECISION` card in that space's panel within 2 s,
  options `1 Green (Recommended)` (marked), `2 Red`, `3 Blue`, and `Asks 1` in the tab bar.
- Clicking `Red` makes the agent's screen say `→ Red` within 3 s, the card moves to `Answered`
  with `→ Red`, and `~/.config/herdr-app/decisions/<space>.md` gains the line.
- Answering the dialog in the terminal instead turns the card into `Resolved in terminal`.
- `Other answer` + `Tabler icons instead` + ⌘Enter: the agent reports that free-text answer.
- A three-question AskUserQuestion (one of them pick-any) makes one card listing all three;
  answering each and `Send answers (3/3)` makes the agent report all three answers.
- A permission prompt for a Write, `No, because…` + `call it b.txt instead` + `Send no`: the
  agent asks to write `b.txt` instead.
- A `claude --permission-mode default` agent asked to write a file shows an `APPROVAL` card
  `Do you want to create note.txt? Allow Write: …/note.txt` with options `1 Yes`, `2 Yes, and
  switch to accept edits …`, `3 No`; clicking `Yes` writes the file.
- An agent asked to "tell me in plain text what you need me to decide" ends its turn with a
  list of questions and, within ~10 s, a `QUESTION` card appears with `Answer`; typing a reply and
  Enter sends it and the agent starts working.
- From another space the button reads `Asks 1 elsewhere` (no red pill); `All` in the panel lists
  the ask with its space name; the sidebar shows a red `1` after the space that has it.
- An agent asked for "three questions as plain text, numbered, with three options each and a
  recommendation" gives one `QUESTION` card with three numbered rows; clicking row 2 unfolds its
  three options with `recommends` on one; picking one shows `→ <option>` and `Send answers (1/3)`;
  sending puts one message with the `2. … → …` line into the agent.
