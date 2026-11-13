# Asks: every question your agents ask, in one Herdr panel

![Asks panel](https://raw.githubusercontent.com/sachin-philip/herdr-agent-ask/8d6e2ec/preview.png)

Every question your agents ask in a space, in one side panel. Run several agents and the
questions pile up in different terminals: one stops at a permission dialog, one offers a menu
of options, one simply ends its turn with a paragraph that asks you something. All of them
appear in the panel as cards the moment they happen, plain-text questions included, so you
see what every agent is waiting on and keep track of the space as a whole without opening
each terminal.

Answer on the card and the answer goes straight into that agent's terminal: a key press for a
dialog, a message for a plain-text question. Each answer is appended to a decisions log, one
file per space under `~/.config/herdr-app/decisions/`, so you (or an agent you point at it)
can read what was decided instead of asking again.

**Version:** 0.3.5 (see `CHANGELOG.md`). Herdr desktop app only; the TUI plugin is planned (see `docs/PRD.md`).

## What you get

- An **Asks** button in the tab bar beside Files and Changes, with a count of questions waiting in
  the shown space (and `+N` when other spaces have some).
- The **Asks panel** on the right, same width rules as Files, hidden until you open it.
  Click the button or press `cmd-shift-a`. One panel per space; `All` shows every space.
- **Cards** with the agent, the kind (`APPROVAL`, `DECISION`, `QUESTION`, `UNCLEAR`), the
  question, the options verbatim with the agent's recommendation marked, an `Other answer`
  box (several lines; ⌘Enter or `Send` sends it), `More` (what the agent said before it
  stopped, with its links), `No, because…` on approvals, `Open terminal` and `Dismiss`.
- An **Answered** list under the cards, with `Clear` to empty it, and a line per answer in
  the decisions log (`~/.config/herdr-app/decisions/<space>.md`).

## How it works

Herdr already knows when an agent is blocked. Claude Code goes further and reports what it
is asking in its status (`kind: question` with the options, or `kind: permission` with the
tool and target). The panel reads that report, then reads the screen for the option numbers and
the line of context. No model is involved for Claude Code.

**Codex works too.** A Codex turn that ends by asking you something becomes a card the same
way (its screen is read with Codex's own prompt marks), and answers reach it as messages. A
space can mix Claude Code and Codex; each terminal is read in the format of what runs in it.
Codex's own approval dialogs are not yet verified as cards.

**Which model reads plain-text questions.** The classifier runs through a CLI you already
have: the Claude Code CLI when it is installed, else the Codex CLI (`codex exec`, newest copy
on the machine). With neither, dialogs still work but plain-text questions are not detected,
and a card in the panel says that only Claude Code and Codex are supported for now, with the
issue tracker to ask for more; Dismiss keeps it away, and it goes by itself once a CLI is there. `classifier` in
`asks.json` forces one (`"claude"` or `"codex"`).

**When an answer does not land.** Codex now and then drops a pasted message. The panel checks
whether the message started a turn; if not, it presses Enter when the text is sitting in the
input box, or sends it once more. A card that still gets no reaction turns red with `Retry`;
it resolves itself when the agent moves on (`Picked up late`), when the agent is closed, or
after ten minutes (`Not delivered`, in the Answered list).

**When an agent stops on an error.** A turn that ends in an error the agent reports (no
connection, the API down or overloaded) becomes a `STOPPED` card with the error as its text and
one button, `Continue`, which sends `continue` to the agent as a message; `Other answer` sends
your own words instead. The card goes when the agent works again, and a turn that fails again
makes a new one. A logged-out agent (`Please run /login`) gets a `STOPPED` card without
`Continue`, since nothing sent would get through: `Open terminal` and log in there. No model
is involved. This needs an agent that reports the error in its status, as Claude Code does.

**Finished turns count too.** When an agent ends a turn with plain-text questions instead
of a dialog, the engine reads that last message and asks `claude -p` (Haiku) whether the agent is
actually waiting on you. If so it becomes a `QUESTION` card; clicking an option or typing an
answer sends it to the agent as a message. Rhetorical "let me know if…" endings are skipped.
A message that asks several questions at once becomes one card that lists them. Click a
question to unfold the choices the agent gave for it (or type your own); each pick is kept as a
draft and `Send answers (2/3)` delivers them together as one numbered message. The questions
themselves are never offered as clickable answers. After each pick the next unanswered
question opens, and `Take recommended` fills every unanswered one with the agent's pick.

**Several questions in one dialog.** Claude Code's AskUserQuestion can ask several questions
at once, one tab each, but its status report names only the first. The engine reads every tab
(it presses → to see each one and ← to come back, without answering anything), so the card
lists them all: pick an option, tick several on a pick-any question, or type your own.
`Send answers (3/3)` appears once each has an answer; it enters them tab by tab, checks each
one took, and submits. If a tab was already answered in the terminal, or one can't be read,
the card says "N questions in one dialog" with `Open terminal`, and no key is pressed for it.

**No, with a reason.** On a Claude Code permission dialog, `No, because…` opens a box: what you
type goes with the no (Claude Code's "Tab to amend"), so the agent hears what to do instead.

**A card's name follows its tab.** Rename the tab while a card waits and the card shows the
new name; the decisions log gets it too.

**Spaces show a count too.** The spaces list in the sidebar gets a red pill with the number of
asks waiting in each space, so a space you are not looking at still tells you it needs you.

For agents that only report "blocked", the engine parses the numbered options on screen. If that
fails it asks `claude -p` (Haiku, structured output) to classify the dialog, and only trusts
the answer when every option it returns appears verbatim on screen. Otherwise the card is
`UNCLEAR` and offers only `Open terminal`.

Answers go through `hc`: the option's number key, then Enter if the dialog is still there.
Typed answers use `hc send --force` into the dialog. Before anything is sent, the panel checks
the agent still sits at the same dialog; if you answered it in the terminal meanwhile, the
card closes as "Resolved in terminal".

Nothing is ever answered without you clicking it.

## Install

**As a layout** (the gallery way): ask your agent to read `~/.config/herdr-app/AGENTS.md` and add
the layout at `herdr.dev/layouts/sachin-philip/herdr-agent-ask`. It copies `layouts/asks.json`
and the three mods, merges `keys.json`, and switches to the layout. `ctrl-shift-l` switches back.

**Keeping your own layout:**

Needs the Herdr desktop app (0.1.13 or later) and Node 18+.

```sh
git clone https://github.com/sachin-philip/herdr-agent-ask
node herdr-agent-ask/install.mjs
```

The installer copies two mods into `~/.config/herdr-app/mods/`, clones your shown layout
as `asks` with the panel and button added, binds `cmd-shift-a` under `layout:asks`, runs
`herdr-app check` on both mods and switches to the new layout. `cmd-shift-l` switches back;
`node herdr-agent-ask/install.mjs --uninstall` removes everything.

The repo is laid out the way the [Herdr gallery](https://herdr.dev/gallery/) expects a layout
(`layouts/asks.json`, `mods/`, `RECIPE.md`, `preview.png`, a `keys.json` snippet at the
root). The layout is Herdr's main layout with the tab bar and spaces list pointed at the two
clones and the panel added, which is also exactly what the installer does to a clone of yours.

Or ask an agent in a Herdr terminal:

```
Read ~/.config/herdr-app/AGENTS.md, then add this layout: herdr.dev/layouts/sachin-philip/herdr-agent-ask
Follow its RECIPE.md.
```

Tell the person before installing: the mods run `hc` (to read screens and press keys) and
`claude -p` (Haiku) on each finished turn that contains a question mark, and on dialogs
the engine cannot parse. That sends the agent's last message to Anthropic through the person's
own Claude Code login, a few seconds and well under a cent per call. Without the Claude Code
CLI the same message goes to OpenAI through `codex exec` and the person's Codex login
instead, and each call counts against their Codex usage limit (around 17k tokens, since
Codex loads its own instructions). `trailing_questions: false` keeps it to dialogs only;
`classify: "off"` never calls a model.

## Configure

`~/.config/herdr-app/asks.json`, all optional:

```json
{
  "label": "Asks",
  "log": "~/.config/herdr-app/decisions/{space}.md",
  "classify": "auto",
  "classifier": "auto",
  "model": "haiku",
  "codex_model": "",
  "trailing_questions": true,
  "toast": false,
  "debug": false,
  "group_spaces_by_machine": true,
  "show_machine_names": true
}
```

- `label`: the words on the tab-bar button and the panel header.
- `log`: where answers are appended (`""` disables). `{space}` is the space's name and `{repo}`
  the agent's folder name; `~/…` and absolute paths work, and a relative path is inside the
  agent's folder. The default keeps the log out of your repos. `"docs/decisions.md"` puts it
  in the agent's checkout instead, where the next agent there can read it, but it then shows
  up in `git status` and an agent that commits everything will commit it.
- `classify`: `auto` (model only when the report and screen say nothing usable), `always`
  (also adds a context line for parsed asks), `off` (never call a model).
- `classifier`: which CLI runs the model: `auto` (Claude Code if installed, else Codex),
  `claude`, or `codex`. `model` is the Claude model (`haiku`); `codex_model` overrides Codex's
  default model when set.
- `trailing_questions`: check every finished turn for a plain-text question (needs the model).
- `group_spaces_by_machine`: once another machine is added, the spaces list puts a header per
  machine over its spaces, as Herdr's own list does; `false` keeps one flat list with no
  headers, where a space on another machine ends its row with that machine's name, dim.
- `show_machine_names`: `false` leaves that name off too, for a flat list that never mentions
  machines. It changes nothing while the list is grouped.

The installer puts three mods in place: `asks` (the panel), `tabs-asks` (the tab bar with the
button and the detection engine) and `spaces-asks` (the spaces list with the per-space count).
The last two are clones of Herdr's shipped mods with a few lines added; the layout `asks` points
at them.
- `debug`: append one line per detection step to `~/.config/herdr-app/asks.log`.
- `toast`: Herdr already toasts "needs you" for a blocked agent; `true` adds a second toast
  with the question.

Keys: `tabs-asks.toggle` shows or hides the panel, `tabs-asks.open` opens it,
`tabs-asks.recheck` re-reads every agent's current turn (after a rule change or a miss),
`asks.accept` answers the newest waiting ask in the shown space with the recommended option
(not bound by default).

## Develop

```sh
node --import ./tests/register.mjs --test                 # parsers against real screens in tests/fixtures; runs on every PR
sh scripts/check-mods.sh    # loads each mod in the Herdr app's checker (needs the app)
python3 scripts/e2e.py      # live: a throwaway agent asks, the panel answers (needs the app, hc, logins)
cp -R mods/asks/. ~/.config/herdr-app/mods/asks/      # the app reloads on save
```

Three layers: `npm test` covers the pure parts (`mods/tabs-asks/parse.js`: the Claude Code
and Codex screen parsers, the status-report parser, the classifier's normaliser) against
screens captured from real agents, and checks that the two `state.js` copies are identical.
`scripts/check-mods.sh` catches a mod that fails to load or render. `scripts/e2e.py` is the
release check: it starts a Claude Code agent, a Codex agent, or both in the shown space, has
them ask a plain-text question, answers from the panel and reports delivered or not; it costs
the agents a couple of short turns, so it stays a local step. Add a new screen format by
capturing `hc read <t> --json --lines 100` into `tests/fixtures/` and asserting on it.

`mods/asks/state.js` and `mods/tabs-asks/state.js` must stay identical; mods import only
their own folder. Detection lives in `tabs-asks` because the tab bar is always shown, so
questions are found before the panel is ever opened.

## License

MIT.
