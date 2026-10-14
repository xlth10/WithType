# Voice Cancellation And Threshold Implementation Plan

> **Goal:** Raise smart-mode direct output to 15 effective characters, simplify the dictation HUD, prevent stale hover controls, and make Escape cancel every active voice task.

**Architecture:** Keep the text decision in the existing dictation pipeline. Keep HUD presentation state inside the React overlay. Register Escape only while the Rust-managed overlay state is active, then route it through the existing `cancel-recording` event so dictation, ask, translation, and skill tasks share one cancellation path.

**Tech Stack:** React 19, Tauri 2, Rust, Node test runner.

---

## Task 1: Lock the requested behavior with tests

**Files:**
- Modify: `tests/pipeline.test.mjs`
- Modify: `tests/desktop-ui-contract.test.mjs`

1. Add pipeline boundary tests proving 15 effective characters bypass text processing and 16 characters invoke it.
2. Add UI contract checks proving dictation recording has no visible status text and controls are driven by an explicit class rather than `:hover`.
3. Add Rust source contract checks for temporary Escape registration and the existing cancel event.
4. Run the focused tests and confirm they fail for the expected missing behavior.

## Task 2: Raise the smart direct-output threshold

**Files:**
- Modify: `src/dictation/pipeline.js`

1. Introduce one named `SMART_DIRECT_OUTPUT_MAX_LENGTH = 15` constant.
2. Use it for both the model-processing and direct-output branches.
3. Run the pipeline tests and confirm the 15/16 boundary passes.

## Task 3: Fix the HUD text and stale controls

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/styles.css`

1. Render no status label for ordinary dictation while recording; retain processing, success, error, and non-dictation labels.
2. Track control visibility with overlay-local state.
3. Reset that state whenever the task state changes or cancellation is clicked.
4. Reveal controls only after pointer movement in the current HUD session and hide them on pointer leave.
5. Replace CSS `:hover` reveal selectors with a `.controls-visible` state class while retaining keyboard focus styling.

## Task 4: Add global Escape cancellation

**Files:**
- Modify: `src-tauri/src/lib.rs`

1. Define Escape as the temporary cancellation shortcut.
2. Register it whenever overlay state is non-idle and unregister it when state returns to idle.
3. Handle Escape before configurable shortcut dispatch and emit the existing `cancel-recording` event on key press.
4. Keep Escape out of the persistent shortcut registry so it does not intercept other applications while Typefree is idle.

## Task 5: Verify the complete desktop change

**Files:**
- Verify only

1. Run `npm test`.
2. Run `cargo test --manifest-path src-tauri/Cargo.toml`.
3. Run `npm run build`.
4. Run `npm run desktop:build` and confirm the installer artifacts are produced.

No commit is included because the current `main` worktree already contains user-owned uncommitted assets and UI changes, and no commit was requested.
