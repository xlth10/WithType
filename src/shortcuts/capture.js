// 把键盘事件转为 Tauri global-shortcut 可解析的组合键。
// 使用 code 而不是 key：中文输入法激活时 key 可能是 Process，物理按键仍然稳定。

const MODIFIER_CODES = new Set([
  "ControlLeft", "ControlRight", "AltLeft", "AltRight",
  "ShiftLeft", "ShiftRight", "MetaLeft", "MetaRight",
]);

// 主键白名单。要与后端能解析的范围（global-hotkey 的 parse_key）对齐：
// 后端认得标点、方向键、NUMPAD、F13–F24 等，前端若只放行字母数字，
// 用户就会觉得「某些键明明没被占用却录不进来」，而报错只说「请用字母、数字…」。
const PUNCTUATION_CODES = new Map(Object.entries({
  Backquote: "Backquote", Minus: "Minus", Equal: "Equal",
  BracketLeft: "BracketLeft", BracketRight: "BracketRight", Backslash: "Backslash",
  Semicolon: "Semicolon", Quote: "Quote", Comma: "Comma", Period: "Period", Slash: "Slash",
}));
const NAMED_CODES = new Map(Object.entries({
  Space: "Space", Enter: "Enter", Tab: "Tab",
  Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown",
  Insert: "Insert", Delete: "Delete",
  ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight",
}));

/** 功能键 F1–F24；F13–F24 只有外接键盘或软件映射才有。 */
function functionKey(code) {
  const match = /^F([1-9]|1[0-9]|2[0-4])$/.exec(code);
  return match ? code : null;
}

function mainKey(code) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return `Num${code.slice(6)}`; // 后端别名 NUM0–NUM9
  const fn = functionKey(code);
  if (fn) return fn;
  if (PUNCTUATION_CODES.has(code)) return PUNCTUATION_CODES.get(code);
  if (NAMED_CODES.has(code)) return NAMED_CODES.get(code);
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
    return { kind: "invalid", message: "这个按键不能作为主键；请用字母、数字、空格、方向键、标点或 F1–F24" };
  }
  return { kind: "shortcut", value: [...modifiers, key].join("+") };
}

// 快捷键的「是不是同一个键」由 src/text/settingsMigration.js 的 shortcutKey 负责：
// 那里同时给配置归一化用，只留一份实现。
export function displayShortcut(value, platform = globalThis.navigator?.platform || "") {
  return String(value || "").replaceAll("+", " + ").replaceAll("Super", /Mac/i.test(platform) ? "⌘" : "Win");
}
