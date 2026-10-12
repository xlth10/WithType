import assert from "node:assert/strict";
import { test } from "node:test";
import { shortcutConflict } from "../src/text/settingsMigration.js";

test("shortcut capture rejects equivalent phrase and recording bindings in either direction", () => {
  const settings = { shortcut: "Ctrl+Alt+Space", askShortcut: "Ctrl+Alt+Shift+Space", actionShortcut: "Ctrl+Alt+Shift+T", phraseShortcut: "Ctrl+Alt+P" };
  assert.equal(shortcutConflict(settings, "phrase", "Option+Control+Space"), "dictation");
  assert.equal(shortcutConflict(settings, "action", "alt+control+p"), "phrase");
  assert.equal(shortcutConflict(settings, "phrase", "Alt+Ctrl+P"), null);
  assert.equal(shortcutConflict(settings, "phrase", ""), null);
  assert.equal(shortcutConflict(settings, "phrase", "Ctrl+Alt+K"), null);
});
