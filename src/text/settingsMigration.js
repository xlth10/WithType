// 配置的默认值、归一化与旧版本迁移。
// 只做纯函数变换，不读写任何存储；谁持久化由调用方决定。

/** 录音结束后对 ASR 文本所做的处理。 */
export const PROCESSING_MODES = ["original", "corrected", "clean", "smart", "skill"];

/** 新安装走自动整理；短句本地直出，长句在服务可用时整理。 */
export const DEFAULT_PROCESSING_MODE = "smart";

export const DEFAULT_SHORTCUT = "Ctrl+Alt+Space";
export const DEFAULT_ASK_SHORTCUT = "Ctrl+Alt+Shift+Space";
export const DEFAULT_ACTION_SHORTCUT = "Ctrl+Alt+Shift+T";

// 与后端 replace_shortcut 一致的按键语义比较：修饰键顺序、大小写、Ctrl/Control、
// Super/Win/Command 这类别名都不应算成两个不同的组合键。裸字符串比对会漏掉这些，
// 于是配置里能同时存下两个「其实一样」的键，重启后其中一个注册失败。
const MODIFIER_ALIASES = { control: "ctrl", option: "alt", command: "super", cmd: "super", win: "super", meta: "super" };

/** 把一个快捷键字符串归一成可比较的形式；空值返回空串。 */
export function shortcutKey(value) {
  return String(value ?? "")
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .map((part) => MODIFIER_ALIASES[part] || part)
    .sort()
    .join("+");
}
export const ACTION_TYPES = ["translate", "skill", "command"];

export const DEFAULT_SETTINGS = {
  asrEndpoint: "",
  asrModel: "Qwen/Qwen3-ASR-1.7B",
  audioDeviceId: "",
  shortcut: DEFAULT_SHORTCUT,
  askShortcut: DEFAULT_ASK_SHORTCUT,
  actionShortcut: DEFAULT_ACTION_SHORTCUT,
  actionType: "translate",
  defaultTranslationLanguage: "英文",
  actionSkillId: "",
  skillDelivery: "paste",
  autoPaste: true,
  autoLearn: true,
  launchAtLogin: false,
  historyRetentionDays: 30,
  keepHistoryAudio: false,
  processingMode: DEFAULT_PROCESSING_MODE,
  vocabulary: "Qwen3=快问三|千问三",
  textEndpoint: "",
  textModel: "",
  textFastModel: "",
  textFallbackModels: "",
  textTimeoutMs: 60000,
  // bearer = 走 Authorization 头；none = 私有内网服务显式声明不需要认证。
  textAuthMode: "bearer",
  selectedSkillId: "",
  autoIntent: false,
};

// 旧版 settings.mode 只有这四项，且 translate 在界面上一直禁用、没有实现。
// 迁移时把 translate 落到 original，并提示用户重新选择，而不是替他挑一个 AI 模式。
const LEGACY_MODE_MAP = {
  original: "original",
  corrected: "corrected",
  clean: "clean",
  translate: "original",
};

const TEXT_TIMEOUT_MIN_MS = 3000;
const TEXT_TIMEOUT_MAX_MS = 300000;

function clampTimeout(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(TEXT_TIMEOUT_MAX_MS, Math.max(TEXT_TIMEOUT_MIN_MS, Math.round(parsed)));
}

function asString(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

function asBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * 把任意来源（旧 localStorage、settings.json、手工编辑过的文件）的对象
 * 归一化成当前版本的完整配置。未知字段丢弃，缺失字段补默认值。
 *
 * 返回 { settings, notices }：notices 是需要展示给用户的迁移提示。
 */
export function normalizeSettings(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const notices = [];

  let processingMode;
  if (PROCESSING_MODES.includes(source.processingMode)) {
    processingMode = source.processingMode;
  } else if (typeof source.mode === "string") {
    // 老配置只有 mode，这里一次性搬迁。
    const mapped = LEGACY_MODE_MAP[source.mode];
    if (mapped) {
      processingMode = mapped;
      if (source.mode === "translate") {
        notices.push("原「翻译为英文」模式已下线，文字整理已切换为「原文」，可在文字整理页重新选择。");
      }
    }
  }
  if (!processingMode) processingMode = DEFAULT_PROCESSING_MODE;

  const shortcut = asString(source.shortcut, DEFAULT_SHORTCUT).trim() || DEFAULT_SHORTCUT;
  let askShortcut = asString(source.askShortcut, DEFAULT_ASK_SHORTCUT).trim() || DEFAULT_ASK_SHORTCUT;
  const legacyCommand = typeof source.commandShortcut === "string" && !source.actionShortcut && !source.actionType;
  let actionShortcut = asString(source.actionShortcut, legacyCommand ? source.commandShortcut : DEFAULT_ACTION_SHORTCUT).trim() || DEFAULT_ACTION_SHORTCUT;
  // 用归一后的键比较，而不是裸字符串：修饰键顺序或别名不同不代表键不同。
  const taken = [shortcutKey(shortcut)];
  if (shortcutKey(askShortcut) === taken[0]) {
    askShortcut = [DEFAULT_ASK_SHORTCUT, DEFAULT_ACTION_SHORTCUT, "Ctrl+Alt+Shift+A"].find((key) => !taken.includes(shortcutKey(key)));
    notices.push("语音输入与随便问不能共用快捷键，已调整随便问的快捷键。");
  }
  taken.push(shortcutKey(askShortcut));
  if (taken.includes(shortcutKey(actionShortcut))) {
    actionShortcut = [DEFAULT_ACTION_SHORTCUT, DEFAULT_ASK_SHORTCUT, "Ctrl+Alt+Shift+A"].find(
      (key) => !taken.includes(shortcutKey(key)),
    );
    notices.push("三个入口不能共用快捷键，已调整第三个快捷键。");
  }
  if (legacyCommand) {
    notices.push("旧版语音命令已迁移为第三个快捷键的动作；可在快捷键页改为翻译或技能。");
  }

  const textAuthMode = source.textAuthMode === "none" ? "none" : "bearer";

  return {
    settings: {
      asrEndpoint: asString(source.asrEndpoint, DEFAULT_SETTINGS.asrEndpoint).trim(),
      asrModel: asString(source.asrModel, DEFAULT_SETTINGS.asrModel).trim(),
      audioDeviceId: asString(source.audioDeviceId, DEFAULT_SETTINGS.audioDeviceId),
      shortcut,
      askShortcut,
      actionShortcut,
      actionType: ACTION_TYPES.includes(source.actionType) ? source.actionType : legacyCommand ? "command" : DEFAULT_SETTINGS.actionType,
      defaultTranslationLanguage: ["英文", "日文", "韩文", "中文", "法文", "德文", "西班牙文"].includes(source.defaultTranslationLanguage) ? source.defaultTranslationLanguage : DEFAULT_SETTINGS.defaultTranslationLanguage,
      actionSkillId: asString(source.actionSkillId, DEFAULT_SETTINGS.actionSkillId),
      skillDelivery: source.skillDelivery === "card" ? "card" : "paste",
      autoPaste: asBoolean(source.autoPaste, DEFAULT_SETTINGS.autoPaste),
      autoLearn: asBoolean(source.autoLearn, DEFAULT_SETTINGS.autoLearn),
      launchAtLogin: asBoolean(source.launchAtLogin, DEFAULT_SETTINGS.launchAtLogin),
      historyRetentionDays: [0, 7, 30, 90, 365].includes(source.historyRetentionDays) ? source.historyRetentionDays : DEFAULT_SETTINGS.historyRetentionDays,
      keepHistoryAudio: asBoolean(source.keepHistoryAudio, DEFAULT_SETTINGS.keepHistoryAudio),
      processingMode,
      vocabulary: asString(source.vocabulary, DEFAULT_SETTINGS.vocabulary),
      textEndpoint: asString(source.textEndpoint, DEFAULT_SETTINGS.textEndpoint).trim(),
      textModel: asString(source.textModel, DEFAULT_SETTINGS.textModel).trim(),
      textFastModel: asString(source.textFastModel, DEFAULT_SETTINGS.textFastModel).trim().slice(0, 200),
      textFallbackModels: asString(source.textFallbackModels, DEFAULT_SETTINGS.textFallbackModels).trim().slice(0, 1000),
      textTimeoutMs: clampTimeout(source.textTimeoutMs, DEFAULT_SETTINGS.textTimeoutMs),
      textAuthMode,
      selectedSkillId: asString(source.selectedSkillId, DEFAULT_SETTINGS.selectedSkillId),
      autoIntent: asBoolean(source.autoIntent, DEFAULT_SETTINGS.autoIntent),
    },
    notices,
  };
}

/** settings.json 是否已经有内容（用于判断要不要从 localStorage 迁移一次）。 */
export function hasStoredSettings(raw) {
  return Boolean(raw) && typeof raw === "object" && !Array.isArray(raw) && Object.keys(raw).length > 0;
}

/** 只保留需要落盘的字段：密钥一律不进配置文件，由系统凭据库保存。 */
export function toPersistedSettings(settings) {
  const { settings: normalized } = normalizeSettings(settings);
  return normalized;
}
