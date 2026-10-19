// Provider-specific readiness lives here so the UI and recording gate agree.
export const ASR_PROVIDERS = ["openai", "apple"];
export const DEFAULT_APPLE_SPEECH_LOCALE = "zh-CN";

/** Defaults apply only when the user has not explicitly selected a provider. */
export function defaultAsrProvider(nativePlatform) {
  return nativePlatform === "macos" ? "apple" : "openai";
}

export function resolveAsrProvider(settings, nativePlatform) {
  return ASR_PROVIDERS.includes(settings?.asrProvider)
    ? settings.asrProvider : defaultAsrProvider(nativePlatform);
}
export const APPLE_SPEECH_LANGUAGES = [
  ["zh-CN", "普通话（中国大陆）"],
  ["zh-TW", "普通话（台湾）"],
  ["zh-HK", "粤语（香港）"],
  ["en-US", "英语（美国）"],
  ["en-GB", "英语（英国）"],
  ["ja-JP", "日语"],
  ["ko-KR", "韩语"],
  ["fr-FR", "法语"],
  ["de-DE", "德语"],
  ["es-ES", "西班牙语"],
];

export function normalizeAppleSpeechLocale(value) {
  if (typeof value !== "string" || !value.trim()) return DEFAULT_APPLE_SPEECH_LOCALE;
  try { return Intl.getCanonicalLocales(value.trim().replaceAll("_", "-"))[0] || DEFAULT_APPLE_SPEECH_LOCALE; }
  catch { return DEFAULT_APPLE_SPEECH_LOCALE; }
}

export function isAppleAsr(settings) {
  return settings?.asrProvider === "apple";
}

/** Configured means recording can be attempted; permission/capability is checked separately. */
export function speechConfigured(settings, nativePlatform) {
  if (isAppleAsr(settings)) return nativePlatform === "macos";
  return Boolean(settings?.asrEndpoint?.trim() && settings?.asrModel?.trim());
}

export function speechModelLabel(settings) {
  return isAppleAsr(settings) ? "Apple 系统语音识别" : settings?.asrModel || "尚未设置模型";
}

export function appleSpeechIssue(status) {
  if (!status?.platformSupported) return "Apple 系统语音识别仅支持 macOS 桌面应用";
  if (status.authorization === "denied") return "语音识别权限已关闭，请在“系统设置 → 隐私与安全性 → 语音识别”中允许 WithType";
  if (status.authorization === "restricted") return "系统限制了语音识别权限，请检查此 Mac 的管理策略";
  if (status.authorization !== "authorized") return "请先允许 WithType 使用系统语音识别";
  if (!status.supportsOnDeviceRecognition) return "当前语言或设备不支持本机语音识别，请更换语言或使用 OpenAI 兼容服务";
  if (!status.available) return "当前语言的系统语音识别暂不可用，请检查系统语言资源后重试";
  return "";
}
