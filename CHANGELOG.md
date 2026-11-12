# Changelog

## Unreleased

- Parse boxed option dialogs (`│ > 1. Yes`), so agents like CodeBuddy show clickable options.

## 0.3.0 · 2026-11-10

- **Flat spaces list** (PR #3, thanks paragbaxi). `group_spaces_by_machine: false` in
  `asks.json` drops the header per machine once a second machine is added and shows one list.
  The default keeps the headers.
- **Installer** recognises its own older copy of the spaces mod after the repo rename, instead
  of refusing to update it.
- **No more false "failed" cards** (issue #1). After an answer, the panel polls the agent for up
  to 8 s and counts the terminal's turn moving on as delivered, so a fast agent that already
  replied, or a paste hc held until the terminal went quiet, no longer fails the card. Retry
  never sends an answer twice: a card whose agent moved on becomes "Picked up late", and the
  engine heals such cards on its own.
- **Faster.** The classifier starts the Claude CLI without your MCP servers and settings, which
  cuts a plain-text question's detection from ~6 s to ~3 s; the engine ticks every second.
- **Log path** (issue #2). `log` accepts `~/…`; the README says the default lands in the
  agent's repo and how to move it.

## 0.2.2 · 2026-11-10

- **Preview, take two.** The product shot now shows the options on every card: the plain-text
  question's choices, the approval's Yes / Yes, and accept edits / No, and the payment menu.

## 0.2.1 · 2026-11-10

- **New preview.** A product shot of the panel with all three card kinds (a plain-text
  question, an approval, an option menu) and the Asks button; it is the README header and the
  gallery picture.

## 0.2.0 · 2026-11-09

- **Named Asks.** Button, panel, README, recipe and gallery entry all say Asks. The default
  tab-bar label is `Asks`; a `label` in `asks.json` still wins.
- **Shared as a layout.** `layouts/asks.json` is Herdr's main layout with the tab bar and
  spaces list pointed at the clones and the panel added, so the gallery's own install flow
  works. `install.mjs` stays for people who keep their own layout.
- **Plain-text questions.** A finished turn that ends by asking you something becomes a card
  (`trailing_questions`, on by default). Text typed into the prompt box but not sent no longer
  hides the agent's message.
- **Several questions at once.** One card lists them; click a question to unfold the options
  the agent gave for it, draft an answer per question, and send them together as one message.
- **Count per space.** The spaces list shows a red pill with the number of asks waiting in each
  space (`spaces-asks`).
- `tabs-asks.recheck` re-reads every agent's current turn after a rule change.
- Fixed a panel re-render failure that froze it on its last good frame.

## 0.1.0 · 2026-11-07

- First build: cards for Claude Code permission dialogs and option menus, answered from the
  panel with a key press or typed text; `Answered` list; one line per answer in
  `docs/decisions.md`; `All` scope; `asks.accept`; installer with `--uninstall`.
