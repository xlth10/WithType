// 把键盘事件转为 Tauri global-shortcut 可解析的组合键。
// 使用 code 而不是 key：中文输入法激活时 key 可能是 Process，物理按键仍然稳定。

const MODIFIER_CODES = new Set([
  "ControlLeft", "ControlRight", "AltLeft", "AltRight",
  "ShiftLeft", "ShiftRight", "MetaLeft", "MetaRight",
]);

function mainKey(code) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F(?:[1-9]|1[0-2])$/.test(code)) return code;
  if (code === "Space") return "Space";
  return null;
}

export function shortcutFromKeydown(event) {
  if (event.code === "Escape" || event.key === "Escape") return { kind: "cancel" };
  if (MODIFIER_CODES.has(event.code)) return { kind: "waiting" };

  const modifiers = [];
  if (event.ctrlKey) modifiers.push("Ctrl");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (event.metaKey) modifiers.push("Super");
  if (!event.ctrlKey && !event.altKey && !event.metaKey) {
    return { kind: "invalid", message: "请同时按住 Ctrl、Alt 或 Win 键" };
  }

  const key = mainKey(event.code || "");
  if (!key) {
    return { kind: "invalid", message: "请用字母、数字、空格或 F1–F12 作为主键" };
  }
  return { kind: "shortcut", value: [...modifiers, key].join("+") };
}

export function shortcutIdentity(value) {
  const parts = String(value || "").split("+").map((part) => part.trim().toLowerCase());
  const aliases = { control: "ctrl", option: "alt", command: "super", cmd: "super", win: "super" };
  return parts.map((part) => aliases[part] || part).sort().join("+");
}

export function displayShortcut(value, platform = globalThis.navigator?.platform || "") {
  return String(value || "").replaceAll("+", " + ").replaceAll("Super", /Mac/i.test(platform) ? "⌘" : "Win");
}
