import assert from "node:assert/strict";
import { test } from "node:test";
import { appleSpeechIssue, normalizeAppleSpeechLocale, speechConfigured, speechModelLabel } from "../src/dictation/asrProvider.js";
import { DEFAULT_SETTINGS, normalizeSettings, toPersistedSettings } from "../src/text/settingsMigration.js";

const apple = { ...DEFAULT_SETTINGS, asrProvider: "apple", asrEndpoint: "", asrModel: "" };
const readyStatus = { platformSupported: true, authorization: "authorized", available: true, supportsOnDeviceRecognition: true };

test("旧语音配置仍使用 OpenAI，Apple 选择与语言独立持久化", () => {
  const existing = { asrEndpoint: "https://speech.example.test/v1", asrModel: "my-asr" };
  const migrated = normalizeSettings(existing).settings;
  assert.equal(migrated.asrProvider, "openai");
  assert.equal(migrated.appleSpeechLocale, "zh-CN");
  assert.equal(migrated.asrEndpoint, existing.asrEndpoint);
  const saved = toPersistedSettings({ ...migrated, asrProvider: "apple", appleSpeechLocale: "en-US" });
  assert.equal(saved.asrProvider, "apple");
  assert.equal(saved.appleSpeechLocale, "en-US");
  assert.equal(saved.asrEndpoint, existing.asrEndpoint, "切换识别方式不应删除原服务");
  assert.equal(saved.asrModel, existing.asrModel);
  assert.equal(normalizeSettings({ asrProvider: "unexpected" }).settings.asrProvider, "openai");
});

test("Apple 语言归一化保留有效 BCP 47，非法值回落中文", () => {
  assert.equal(normalizeAppleSpeechLocale(" en_us "), "en-US");
  assert.equal(normalizeAppleSpeechLocale("zh-Hant-TW"), "zh-Hant-TW");
  for (const invalid of [null, 123, "", "not-a-valid-locale-????"]) {
    assert.equal(normalizeSettings({ appleSpeechLocale: invalid }).settings.appleSpeechLocale, "zh-CN");
  }
});

test("Apple 无需服务地址和密钥，且只在原生 macOS 可开始输入", () => {
  assert.equal(speechConfigured(apple, "macos"), true);
  for (const platform of ["windows", "linux", "browser", "", undefined]) assert.equal(speechConfigured(apple, platform), false);
  assert.equal(speechConfigured({ ...apple, asrProvider: "openai" }, "macos"), false);
  assert.equal(speechConfigured({ asrEndpoint: " https://speech.example.test ", asrModel: "asr" }, "windows"), true);
  assert.equal(speechModelLabel(apple), "Apple 系统语音识别");
});

test("Apple 必须同时具备授权、系统可用性和端侧能力，不能默默联网回退", () => {
  assert.equal(appleSpeechIssue(readyStatus), "");
  assert.match(appleSpeechIssue({ ...readyStatus, platformSupported: false }), /仅支持 macOS/);
  assert.match(appleSpeechIssue({ ...readyStatus, authorization: "notDetermined" }), /请先允许/);
  assert.match(appleSpeechIssue({ ...readyStatus, authorization: "denied" }), /系统设置.*隐私与安全性.*语音识别/);
  assert.match(appleSpeechIssue({ ...readyStatus, authorization: "restricted" }), /管理策略/);
  assert.match(appleSpeechIssue({ ...readyStatus, supportsOnDeviceRecognition: false }), /不支持本机语音识别/);
  assert.match(appleSpeechIssue({ ...readyStatus, available: false }), /暂不可用/);
});
