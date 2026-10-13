// Offline models of src-tauri/src/lib.rs, not Windows API executions.
// These deliberately reproduce the current state transitions and restore guard.
// No OS clipboard, key injection, app launch, or network access occurs here.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";

const source = "src-tauri/src/lib.rs";
const results = [];

{
  const sessions = { active: new Set(), cancelled: new Set() };
  const cancelPaste = (id) => {
    // cancel_paste: only records cancellation of an already-active session.
    if (sessions.active.has(id)) sessions.cancelled.add(id);
  };
  const enterPaste = (id) => {
    // paste_text: active.insert(session_id); cancelled.remove(session_id).
    sessions.active.add(id);
    sessions.cancelled.delete(id);
  };
  cancelPaste("task");
  enterPaste("task");
  const pasteWasCancelled = sessions.cancelled.has("task");
  assert.equal(pasteWasCancelled, false);
  results.push({
    scenario: "cancel-before-paste-registration",
    source,
    sourceLines: [514, 547, 558],
    sequence: ["cancel_paste(task)", "paste_text registers task", "paste_was_cancelled(task)"],
    actual: pasteWasCancelled,
    expectedForPersistentCancellation: true,
    limitation: "Confirms state-loss branch; does not prove Windows IPC scheduling or a real paste.",
  });
}

{
  let clipboard = "original";
  const paste = (text) => {
    const previous = clipboard;
    clipboard = text;
    // restore thread: restore only if current text still equals its own text.
    return () => {
      if (clipboard === text && previous !== undefined) clipboard = previous;
    };
  };
  const restoreA = paste("dictation A");
  const restoreB = paste("dictation B");
  restoreA();
  restoreB();
  assert.equal(clipboard, "dictation A");
  results.push({
    scenario: "overlapping-clipboard-restores",
    source,
    sourceLines: [574, 588, 590],
    sequence: ["initial original", "paste A", "paste B before A restore", "restore A skips", "restore B restores A"],
    actual: clipboard,
    expectedForOriginalRestore: "original",
    limitation: "Pure text-state model; no Windows clipboard calls or real timing measurements.",
  });
}

const report = { method: "offline-state-model", scenarios: results };
writeFileSync(new URL("./native-delivery-state-results.json", import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
