import assert from "node:assert/strict";
import { test } from "node:test";

import { displayShortcut, shortcutFromKeydown, shortcutIdentity } from "../src/shortcuts/capture.js";

function keydown(code, modifiers = {}, key = "") {
  return { code, key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...modifiers };
}

test("按键录制生成 Tauri 可解析的固定顺序", () => {
  assert.deepEqual(
    shortcutFromKeydown(keydown("KeyK", { ctrlKey: true, altKey: true, shiftKey: true })),
    { kind: "shortcut", value: "Ctrl+Alt+Shift+K" },
  );
  assert.deepEqual(
    shortcutFromKeydown(keydown("Space", { ctrlKey: true, altKey: true })),
    { kind: "shortcut", value: "Ctrl+Alt+Space" },
  );
  assert.deepEqual(
    shortcutFromKeydown(keydown("Digit7", { metaKey: true })),
    { kind: "shortcut", value: "Super+7" },
  );
});

test("Esc 取消；单按修饰键等待；普通文字不能注册为全局键", () => {
  assert.deepEqual(shortcutFromKeydown(keydown("Escape", {}, "Escape")), { kind: "cancel" });
  assert.deepEqual(shortcutFromKeydown(keydown("ControlLeft", { ctrlKey: true })), { kind: "waiting" });
  assert.equal(shortcutFromKeydown(keydown("KeyA")).kind, "invalid");
  assert.equal(shortcutFromKeydown(keydown("KeyA", { shiftKey: true })).kind, "invalid");
  assert.equal(shortcutFromKeydown(keydown("Slash", { ctrlKey: true })).kind, "invalid");
});

test("组合键冲突比较不受修饰键顺序和别名影响", () => {
  assert.equal(shortcutIdentity("Alt+Ctrl+Space"), shortcutIdentity("Ctrl+Alt+Space"));
  assert.equal(shortcutIdentity("Win+K"), shortcutIdentity("Super+K"));
  assert.notEqual(shortcutIdentity("Ctrl+Alt+K"), shortcutIdentity("Ctrl+Shift+K"));
  assert.equal(displayShortcut("Ctrl+Alt+Space"), "Ctrl + Alt + Space");
  assert.equal(displayShortcut("Super+K", "Win32"), "Win + K");
  assert.equal(displayShortcut("Super+K", "MacIntel"), "⌘ + K");
});
