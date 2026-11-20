#!/usr/bin/env python3
"""End-to-end check against the running Herdr app: start a throwaway agent in the shown
space, have it ask a plain-text question, answer it from the panel (herdr-app do asks.accept)
and report whether the card ends as delivered. Not for CI: it needs the Herdr desktop app,
hc, and a Claude Code login (and the Codex CLI for the codex cases).

    python3 scripts/e2e.py            # claude alone, codex alone, both together
    python3 scripts/e2e.py claude     # one case
    python3 scripts/e2e.py codex both
    python3 scripts/e2e.py dialog     # a one-question AskUserQuestion, answered by key
    python3 scripts/e2e.py wizard     # a two-question dialog: the card refuses, nothing is pressed

Open the Asks panel first (the accept command reaches the panel only while it is shown).
Each case costs the agents one or two short turns.
"""
import json, os, subprocess, sys, time

HOME = os.path.expanduser("~/.config/herdr-app")
ENV = {k: v for k, v in os.environ.items() if k not in ("HC_TERMINAL_ID", "HC_TERMINAL_SOCKET")}
PROMPTS = {
    "claude": "Ask me, as plain text (no tool), whether the build should use esbuild or tsc. Recommend esbuild. List both answers. Then stop and wait.",
    "codex": "Ask me one question as plain text: should indentation use tabs or spaces? Recommend spaces. List both answers as bullets. Do not run any command. Then stop and wait.",
}
LAUNCH = {"claude": "claude --model haiku", "codex": "codex"}


def sh(*a):
    return subprocess.run(a, capture_output=True, text=True, env=ENV).stdout


def hc(*a):
    return sh("hc", *a)


def app(*a):
    return sh("herdr-app", *a)


def send(t, text, force=False):
    subprocess.run(["hc", "send"] + (["--force"] if force else []) + [t, text], env=ENV, capture_output=True)


def get(t):
    return json.loads(hc("get", t, "--json"))


def asks(addr):
    try:
        s = json.load(open(f"{HOME}/shared.json"))
    except Exception:
        return []
    return [a for a in (s.get("asks.state") or {}).get("asks", []) if a["address"] == addr]


def wait_card(addr, timeout=90):
    t0 = time.time()
    while time.time() - t0 < timeout:
        for a in asks(addr):
            if a["state"] == "pending":
                return a
        time.sleep(0.5)


def wait_state(addr, aid, timeout=25):
    t0 = time.time()
    while time.time() - t0 < timeout:
        for a in asks(addr):
            if a["id"] == aid and a["state"] in ("delivered", "failed", "stale"):
                return a
        time.sleep(0.5)
    return next((a for a in asks(addr) if a["id"] == aid), None)


def ready(t, timeout=40):
    t0 = time.time()
    while time.time() - t0 < timeout:
        st = get(t).get("status") or {}
        if isinstance(st, dict) and st.get("app") and st.get("state") in ("idle", "done"):
            return True
        time.sleep(1)
    return False


def screen(t, n=40):
    try:
        return json.loads(hc("read", t, "--json", "--lines", str(n)))["text"].strip()[-1600:]
    except Exception as e:
        return str(e)


def run_case(label, progs, space):
    print(f"=== {label}")
    terms = {}
    for p in progs:
        r = json.loads(app("do", "tab.new", "--name", f"e2e-{p}", "--space", space, "--folder", os.getcwd()))
        time.sleep(2)
        send(r["terminal"], LAUNCH[p])
        terms[p] = (r["terminal"], r["tab"])
    for p, (t, _) in terms.items():
        print(f"  {p} {t} ready={ready(t)}")
    t_send = time.time()
    for p, (t, _) in terms.items():
        send(t, PROMPTS[p], force=True)
    cards, results = {}, []
    for p, (t, _) in terms.items():
        a = wait_card(t)
        cards[p] = a
        if a:
            print(f"  {p}: card {a['kind']} {a['question'][:50]!r} options={[o['label'] for o in a['options']]} after {round(a['detected_at'] / 1000 - t_send, 1)} s")
        else:
            print(f"  {p}: NO CARD in 90 s\n{screen(t)}")
            results.append((label, p, "no card"))
    turns = {p: get(t)["turn"] for p, (t, _) in terms.items() if cards.get(p)}
    t0 = time.time()
    for _ in [p for p in progs if cards.get(p)]:
        app("do", "asks.accept")
        time.sleep(3)
    for p, (t, _) in terms.items():
        a = cards.get(p)
        if not a:
            continue
        b = wait_state(t, a["id"])
        g = get(t)
        state = b["state"] if b else None
        print(f"  {p}: -> {state} after {round(time.time() - t0, 1)} s, answer={b.get('answer') if b else None}, error={b.get('error') if b else None}, agent {g['status'].get('state')} turn {turns[p]}->{g['turn']}")
        results.append((label, p, state))
        if state != "delivered":
            print(f"  --- screen of {p}\n{screen(t)}\n  ---")
    time.sleep(4)
    for p, (t, tab) in terms.items():
        app("do", "tab.close", "--id", tab)
    return results


DIALOG = "Use the AskUserQuestion tool with ONE question: 'Which colour?' with options Green, Red, Blue. Recommend Green."
WIZARD = "Use the AskUserQuestion tool once with TWO questions in the same call: first 'Which colour?' with options Green, Red, Blue (recommend Green); second 'Which size?' with options Small, Medium, Large (recommend Medium)."


def run_dialog(label, prompt, wizard, space):
    """A Claude Code dialog. `wizard`: the card must be the notice and accept must press nothing."""
    print(f"=== {label}")
    r = json.loads(app("do", "tab.new", "--name", "e2e-dialog", "--space", space, "--folder", os.getcwd()))
    t, tab = r["terminal"], r["tab"]
    time.sleep(2)
    send(t, LAUNCH["claude"])
    print(f"  claude {t} ready={ready(t)}")
    send(t, prompt, force=True)
    card = None
    for _ in range(90):
        time.sleep(1)
        c = [a for a in asks(t) if a["state"] == "pending" and a.get("enriched")]
        if c:
            card = c[0]
            break
    if not card:
        print("  NO CARD in 90 s\n" + screen(t))
        app("do", "tab.close", "--id", tab)
        return [(label, "claude", "no card")]
    print(f"  card {card['kind']} wizard={card.get('wizard')} {card['question'][:70]!r} options={[o['label'] for o in card['options']]}")
    before = screen(t)
    app("do", "asks.accept")
    time.sleep(6)
    after = screen(t)
    c = next((a for a in asks(t) if a["id"] == card["id"]), None)
    g = get(t)
    if wizard:
        ok = bool(card.get("wizard")) and not card["options"] and c and c["state"] == "pending" and "☐" in after and g["status"].get("state") == "blocked"
        print(f"  accept on a wizard: card {c['state'] if c else None}, dialog still up={'☐' in after}, agent {g['status'].get('state')} -> {'ok' if ok else 'WRONG'}")
        subprocess.run(["hc", "keys", t, "esc"], env=ENV, capture_output=True)
    else:
        ok = c is not None and c["state"] == "delivered"
        print(f"  accept: card {c['state'] if c else None}, answer={c.get('answer') if c else None}, agent {g['status'].get('state')} -> {'ok' if ok else 'WRONG'}")
        if not ok:
            print(after)
    time.sleep(3)
    app("do", "tab.close", "--id", tab)
    return [(label, "claude", "ok" if ok else "failed")]


def main():
    which = sys.argv[1:] or ["claude", "codex", "both"]
    status = json.loads(app("status"))
    space = status["space"]
    app("do", "tabs-asks.open")
    results = []
    for w in which:
        if w == "claude":
            results += run_case("Claude alone", ["claude"], space)
        elif w == "codex":
            results += run_case("Codex alone", ["codex"], space)
        elif w == "both":
            results += run_case("Claude + Codex together", ["claude", "codex"], space)
        elif w == "dialog":
            results += run_dialog("Claude dialog, one question", DIALOG, False, space)
        elif w == "wizard":
            results += run_dialog("Claude wizard, two questions", WIZARD, True, space)
        else:
            sys.exit(f"unknown case {w!r}: claude, codex, both, dialog, wizard")
    print("RESULTS", results)
    sys.exit(0 if all(r[2] in ("delivered", "ok") for r in results) else 1)


if __name__ == "__main__":
    main()
