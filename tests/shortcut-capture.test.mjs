import assert from "node:assert/strict";
import { test } from "node:test";

import { displayShortcut, shortcutFromKeydown } from "../src/shortcuts/capture.js";
import { shortcutKey } from "../src/text/settingsMigration.js";

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

test("Esc 取消；单按修饰键等待；未修饰的普通按键不能注册为全局键", () => {
  assert.deepEqual(shortcutFromKeydown(keydown("Escape", {}, "Escape")), { kind: "cancel" });
  assert.deepEqual(shortcutFromKeydown(keydown("ControlLeft", { ctrlKey: true })), { kind: "waiting" });
  assert.equal(shortcutFromKeydown(keydown("KeyA")).kind, "invalid");
  assert.equal(shortcutFromKeydown(keydown("KeyA", { shiftKey: true })).kind, "invalid");
});

test("主键白名单与后端 parse_key 对齐：标点、方向键、小键盘、F13–F24 都能录", () => {
  assert.deepEqual(
    shortcutFromKeydown(keydown("Slash", { ctrlKey: true })),
    { kind: "shortcut", value: "Ctrl+Slash" },
  );
  assert.deepEqual(
    shortcutFromKeydown(keydown("BracketLeft", { ctrlKey: true, altKey: true })),
    { kind: "shortcut", value: "Ctrl+Alt+BracketLeft" },
  );
  assert.deepEqual(
    shortcutFromKeydown(keydown("ArrowUp", { ctrlKey: true })),
    { kind: "shortcut", value: "Ctrl+ArrowUp" },
  );
  assert.deepEqual(
    shortcutFromKeydown(keydown("Numpad7", { ctrlKey: true })),
    { kind: "shortcut", value: "Ctrl+Num7" },
  );
  assert.deepEqual(
    shortcutFromKeydown(keydown("F13", { ctrlKey: true })),
    { kind: "shortcut", value: "Ctrl+F13" },
  );
  assert.deepEqual(
    shortcutFromKeydown(keydown("Tab", { ctrlKey: true, shiftKey: true })),
    { kind: "shortcut", value: "Ctrl+Shift+Tab" },
  );
  // 仍然拒绝真正无法解析的键，避免录制出一个后端注册不了的组合。
  assert.equal(shortcutFromKeydown(keydown("AudioVolumeUp", { ctrlKey: true })).kind, "invalid");
  assert.equal(shortcutFromKeydown(keydown("CapsLock", { ctrlKey: true })).kind, "invalid");
  assert.equal(shortcutFromKeydown(keydown("F25", { ctrlKey: true })).kind, "invalid");
});

test("组合键冲突比较不受修饰键顺序、大小写和别名影响", () => {
  assert.equal(shortcutKey("Alt+Ctrl+Space"), shortcutKey("Ctrl+Alt+Space"));
  assert.equal(shortcutKey("Win+K"), shortcutKey("Super+K"));
  assert.equal(shortcutKey("ctrl+k"), shortcutKey("Ctrl+K"));
  assert.equal(shortcutKey("Control+Alt+Space"), shortcutKey("Ctrl+Alt+Space"));
  assert.notEqual(shortcutKey("Ctrl+Alt+K"), shortcutKey("Ctrl+Shift+K"));
  assert.notEqual(shortcutKey("Ctrl+Alt+K"), shortcutKey("Ctrl+Alt+J"));
  assert.equal(shortcutKey(undefined), "");
  assert.equal(shortcutKey(""), "");
  assert.equal(displayShortcut("Ctrl+Alt+Space"), "Ctrl + Alt + Space");
  assert.equal(displayShortcut("Super+K", "Win32"), "Win + K");
  assert.equal(displayShortcut("Super+K", "MacIntel"), "⌘ + K");
});