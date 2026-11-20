# Changelog

## 0.3.5 · 2026-11-13

- **Delivery tests.** The panel's send path runs under `node --test` against a scripted hc
  and a fake clock: a message taken, a dropped paste resent once, Enter on text left unsent,
  no reaction (failed with the message), a decline in the terminal, Retry after the agent
  moved on, an answer by key, and a wizard refused by both the panel and the engine. 36 tests.
- **Live harness** gains `dialog` and `wizard` cases (`scripts/e2e.py`).
- **Stopped on an error.** A turn that ends in an error the agent reports (no connection, the
  API down) is a `STOPPED` card with `Continue`, which sends `continue`; a new card comes if the
  next turn fails too. A logged-out agent gets a `STOPPED` card that says to run `/login` in
  the terminal, instead of an `UNCLEAR` one. Tests run the engine against the status reports
  and screens of Claude Code with a dead endpoint and an invalid token.
- **Context line opens on a click.** The dim line beside a card's kind chip is one cut line
  again, so a long one no longer crowds the question; a click on the row shows it in full,
  starting beside the chip with its next lines at the card's edge, and another click closes it.
- **Wizards are safe.** Claude Code's several-question dialog (a tab bar over the questions)
  used to show as one question, and the panel's fallback Enter answered the next question with
  whatever was highlighted. The card now says "N questions in one dialog: … Answer them in the
  terminal." with no options; the panel reads the screen before every key press, also on
  Retry and `asks.accept`, and presses nothing while the bar is up. A dialog declined in the
  terminal is "Declined in terminal", not delivered. Late pickups are logged like any answer.
  A declined dialog's remnants and login or API errors no longer become cards; box borders
  come off dialog lines (as in PR #8). Tests cover all of it against captured screens.
- **Codex.** A Codex turn that ends in a plain-text question becomes a card and is answered
  with a message, like Claude Code's. A space can mix both; each terminal is read in the
  format of the program in it.
- **Classifier on a settings-based login.** The Claude CLI is started without the person's
  settings for speed; when that fails with an auth error (a login kept in settings, such as an
  `apiKeyHelper`), the call is repeated with settings on and that is remembered.
- **Classifier without Claude.** Plain-text questions are read by the Claude Code CLI when
  installed, else by the Codex CLI (`codex exec`, newest copy found); `classifier` in
  `asks.json` forces one. With neither, a card in every space says that only Claude Code and
  Codex are supported for now and where to ask for more; it goes once a CLI turns up.
- **Dropped pastes.** Codex sometimes drops a sent answer; the panel notices (hc reports no
  turn started) and presses Enter or resends once. Failed cards resolve themselves: delivered
  when the agent moves on, `Agent closed` when it is gone, `Not delivered` after ten minutes.
  `Open terminal` on a closed agent no longer throws a toast.
- **Clear** on the Answered list forgets every finished card in the shown scope.
- **Tests for the classifier.** The engine runs under `node --test` against a scripted
  `herdr` module: Claude only, Codex only (newest binary wins), both (Claude by default,
  `classifier` decides), and neither (no model started, one notice card that survives the
  tick and leaves once a CLI appears).
- **Tests.** The screen and report parsers moved to `mods/tabs-asks/parse.js` (no Herdr
  import) and run under `node --test` against real captured screens, on every PR through
  GitHub Actions. `scripts/check-mods.sh` loads the mods in the app's checker;
  `scripts/e2e.py` is the live release check (Claude alone, Codex alone, both).
- **Decisions log out of the repo** (issue #2). The default is now one file per space,
  `~/.config/herdr-app/decisions/<space>.md`; each line also names the agent's folder.
  `log` takes `{space}` and `{repo}`; `"docs/decisions.md"` restores the old in-repo file.

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
