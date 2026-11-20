// The two mods carry the same state.js; a drift between them breaks the shared state.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("mods/asks/state.js and mods/tabs-asks/state.js are identical", () => {
  const a = fs.readFileSync(new URL("../mods/asks/state.js", import.meta.url), "utf8");
  const b = fs.readFileSync(new URL("../mods/tabs-asks/state.js", import.meta.url), "utf8");
  assert.equal(a, b);
});

test("parse.js imports nothing from Herdr", () => {
  const src = fs.readFileSync(new URL("../mods/tabs-asks/parse.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /from "herdr"/);
});
