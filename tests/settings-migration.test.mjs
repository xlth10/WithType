// 配置迁移与归一化测试。
//
// 这段代码会碰到三种输入：旧 localStorage、settings.json、用户手工改过的文件。
// 出错的方式都很安静——模式退化成 AI 模式、两个快捷键撞车、密钥被写进配置文件——
// 所以每一条都要在这里钉住。

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_ASK_SHORTCUT,
  DEFAULT_ACTION_SHORTCUT,
  DEFAULT_COPY_SHORTCUT,
  DEFAULT_PROCESSING_MODE,
  DEFAULT_SETTINGS,
  DEFAULT_SHORTCUT,
  hasStoredSettings,
  normalizeSettings,
  toPersistedSettings,
} from "../src/text/settingsMigration.js";

test("新安装默认自动整理，旧配置仍按迁移规则保留", () => {
  assert.equal(DEFAULT_PROCESSING_MODE, "smart");
  assert.equal(DEFAULT_SETTINGS.processingMode, "smart");
  assert.equal(DEFAULT_SETTINGS.autoIntent, false);
  assert.equal(normalizeSettings({}).settings.processingMode, "smart");
  assert.equal(normalizeSettings(null).settings.processingMode, "smart");
});

test("旧版 mode 迁移到 processingMode", () => {
  assert.equal(normalizeSettings({ mode: "original" }).settings.processingMode, "original");
  assert.equal(normalizeSettings({ mode: "corrected" }).settings.processingMode, "corrected");
  assert.equal(normalizeSettings({ mode: "clean" }).settings.processingMode, "clean");
});

test("旧的 translate 模式落到原文，并给出逐字提示", () => {
  const { settings, notices } = normalizeSettings({ mode: "translate" });
  assert.equal(settings.processingMode, "original");
  assert.deepEqual(notices, [
    "原「翻译为英文」模式已下线，文字整理已切换为「保留原文」，可在文字整理页重新选择。",
  ]);
});

test("未知的 mode 值不迁移，回落到默认模式", () => {
  assert.equal(normalizeSettings({ mode: "teleport" }).settings.processingMode, "smart");
  assert.equal(normalizeSettings({ mode: 123 }).settings.processingMode, "smart");
});

test("已有的 processingMode 优先于旧 mode", () => {
  const { settings, notices } = normalizeSettings({ mode: "translate", processingMode: "smart" });
  assert.equal(settings.processingMode, "smart");
  assert.deepEqual(notices, [], "已经带上 processingMode 的配置不该再提示迁移");
});

test("三个快捷键相同时强制拉开，并提示用户", () => {
  const { settings, notices } = normalizeSettings({
    shortcut: DEFAULT_SHORTCUT,
    askShortcut: DEFAULT_SHORTCUT,
    actionShortcut: DEFAULT_SHORTCUT,
  });
  assert.equal(settings.shortcut, DEFAULT_SHORTCUT);
  assert.equal(settings.askShortcut, DEFAULT_ASK_SHORTCUT);
  assert.equal(settings.actionShortcut, DEFAULT_ACTION_SHORTCUT);
  assert.equal(notices.length, 2);
});

test("自定义快捷键撞车时第三个键改用默认组合键", () => {
  const { settings } = normalizeSettings({ shortcut: "Ctrl+Shift+D", actionShortcut: "Ctrl+Shift+D" });
  assert.equal(settings.shortcut, "Ctrl+Shift+D");
  assert.equal(settings.actionShortcut, DEFAULT_ACTION_SHORTCUT);
});

test("修饰键顺序、大小写或别名不同也算撞车，必须拉开", () => {
  const reversed = normalizeSettings({ shortcut: "Ctrl+Alt+Space", askShortcut: "Alt+Ctrl+Space" });
  assert.equal(reversed.settings.shortcut, "Ctrl+Alt+Space");
  assert.notEqual(reversed.settings.askShortcut, "Alt+Ctrl+Space");

  const lowercased = normalizeSettings({ shortcut: "Ctrl+Alt+Space", askShortcut: "ctrl+alt+space" });
  assert.notEqual(lowercased.settings.askShortcut, "ctrl+alt+space");

  const aliased = normalizeSettings({ shortcut: "Ctrl+Alt+K", actionShortcut: "Control+Option+K" });
  assert.notEqual(aliased.settings.actionShortcut, "Control+Option+K");
  assert.equal(aliased.settings.actionShortcut, DEFAULT_ACTION_SHORTCUT);

  const winSuper = normalizeSettings({ shortcut: "Super+K", askShortcut: "Win+K" });
  assert.notEqual(winSuper.settings.askShortcut, "Win+K");
});

test("三个快捷键不同时原样保留、不提示", () => {
  const { settings, notices } = normalizeSettings({
    shortcut: "Ctrl+Shift+D",
    askShortcut: "Ctrl+Shift+E",
    actionShortcut: "Ctrl+Shift+F",
  });
  assert.equal(settings.shortcut, "Ctrl+Shift+D");
  assert.equal(settings.askShortcut, "Ctrl+Shift+E");
  assert.equal(settings.actionShortcut, "Ctrl+Shift+F");
  assert.deepEqual(notices, []);
});

test("复制上次结果的快捷键补默认值，冲突时使用独立组合并落盘", () => {
  assert.equal(normalizeSettings({}).settings.copyShortcut, DEFAULT_COPY_SHORTCUT);
  const { settings, notices } = normalizeSettings({ shortcut: DEFAULT_COPY_SHORTCUT, copyShortcut: DEFAULT_COPY_SHORTCUT });
  assert.notEqual(settings.copyShortcut, settings.shortcut);
  assert.notEqual(settings.copyShortcut, settings.askShortcut);
  assert.notEqual(settings.copyShortcut, settings.actionShortcut);
  assert.ok(notices.length > 0);
  assert.equal(toPersistedSettings(settings).copyShortcut, settings.copyShortcut);
});

test("旧语音命令快捷键迁移到第三个入口，并保留命令动作", () => {
  const { settings, notices } = normalizeSettings({ commandShortcut: "Ctrl+Shift+E" });
  assert.equal(settings.askShortcut, DEFAULT_ASK_SHORTCUT);
  assert.equal(settings.actionShortcut, "Ctrl+Shift+E");
  assert.equal(settings.actionType, "command");
  assert.equal(notices.length, 1);
});

test("旧命令默认键与新随便问默认键冲突时改用第三个默认键", () => {
  const { settings } = normalizeSettings({ commandShortcut: DEFAULT_ASK_SHORTCUT });
  assert.equal(settings.askShortcut, DEFAULT_ASK_SHORTCUT);
  assert.equal(settings.actionShortcut, DEFAULT_ACTION_SHORTCUT);
  assert.equal(settings.actionType, "command");
});

test("超时被夹到 3 秒到 5 分钟之间", () => {
  assert.equal(normalizeSettings({ textTimeoutMs: 10 }).settings.textTimeoutMs, 3000);
  assert.equal(normalizeSettings({ textTimeoutMs: 999999 }).settings.textTimeoutMs, 300000);
  assert.equal(normalizeSettings({ textTimeoutMs: "x" }).settings.textTimeoutMs, 60000);
  assert.equal(normalizeSettings({ textTimeoutMs: 45000 }).settings.textTimeoutMs, 45000);
  assert.equal(normalizeSettings({ textTimeoutMs: 3000.4 }).settings.textTimeoutMs, 3000);
});

test("认证方式只接受 none，其余一律 bearer", () => {
  assert.equal(normalizeSettings({ textAuthMode: "none" }).settings.textAuthMode, "none");
  assert.equal(normalizeSettings({ textAuthMode: "weird" }).settings.textAuthMode, "bearer");
  assert.equal(normalizeSettings({}).settings.textAuthMode, "bearer");
});

test("类型不符的字段回落到默认值", () => {
  const { settings } = normalizeSettings({
    asrEndpoint: 42,
    autoPaste: "yes",
    launchAtLogin: 1,
    vocabulary: null,
    selectedSkillId: {},
  });
  assert.equal(settings.asrEndpoint, DEFAULT_SETTINGS.asrEndpoint);
  assert.equal(settings.autoPaste, DEFAULT_SETTINGS.autoPaste);
  assert.equal(settings.launchAtLogin, DEFAULT_SETTINGS.launchAtLogin);
  assert.equal(settings.vocabulary, DEFAULT_SETTINGS.vocabulary);
  assert.equal(settings.selectedSkillId, DEFAULT_SETTINGS.selectedSkillId);
});

test("hasStoredSettings 只在有内容的普通对象上为真", () => {
  assert.equal(hasStoredSettings({ a: 1 }), true);
  assert.equal(hasStoredSettings({}), false);
  assert.equal(hasStoredSettings(null), false);
  assert.equal(hasStoredSettings(undefined), false);
  assert.equal(hasStoredSettings([]), false);
  assert.equal(hasStoredSettings("x"), false);
});

test("落盘结果不包含任何密钥字段", () => {
  const persisted = toPersistedSettings({
    ...DEFAULT_SETTINGS,
    apiKey: "sk-should-never-be-persisted",
    asrApiKey: "sk-should-never-be-persisted",
    textApiKey: "sk-should-never-be-persisted",
  });
  const keys = Object.keys(persisted);
  assert.deepEqual(keys.sort(), Object.keys(DEFAULT_SETTINGS).sort());
  for (const key of keys) {
    assert.ok(!/key|secret|token|password/i.test(key), `落盘配置里出现了疑似密钥字段：${key}`);
  }
  assert.ok(!JSON.stringify(persisted).includes("sk-should-never-be-persisted"));
});

test("落盘结果始终是归一化后的完整配置", () => {
  const persisted = toPersistedSettings({ mode: "translate" });
  assert.equal(persisted.processingMode, "original");
  assert.equal(persisted.askShortcut, DEFAULT_ASK_SHORTCUT);
  assert.equal(persisted.actionShortcut, DEFAULT_ACTION_SHORTCUT);
  assert.deepEqual(Object.keys(persisted).sort(), Object.keys(DEFAULT_SETTINGS).sort());
});


test("自动学习旧配置默认开启，显式关闭可持久化", () => {
  assert.equal(normalizeSettings({}).settings.autoLearn, true);
  assert.equal(toPersistedSettings({ autoLearn: false }).autoLearn, false);
  assert.equal(normalizeSettings({ autoLearn: "false" }).settings.autoLearn, true);
});

test("流式默认开启，提前整理仅显式启用且配置可以持久化", () => {
  assert.equal(normalizeSettings({}).settings.textStreaming, true);
  assert.equal(normalizeSettings({}).settings.textIncremental, false);
  const saved = toPersistedSettings({ textStreaming: false, textIncremental: true });
  assert.equal(normalizeSettings(saved).settings.textStreaming, false);
  assert.equal(normalizeSettings(saved).settings.textIncremental, true);
  assert.equal(normalizeSettings({ textIncremental: "true" }).settings.textIncremental, false);
});

test("快捷短语旧配置默认不绑定，也不占用现有快捷键", () => {
  const { settings, notices } = normalizeSettings({});
  assert.equal(settings.phraseShortcut, "");
  assert.equal(settings.phraseText, "");
  assert.deepEqual(notices, []);
});

test("快捷短语完整保存前导零、空格、换行和名称", () => {
  const phraseText = " 0012345\r\n第二行 ";
  const saved = toPersistedSettings({ phraseShortcut: "Ctrl+Alt+P", phraseName: "手机号", phraseText });
  assert.equal(normalizeSettings(saved).settings.phraseText, phraseText);
  assert.equal(saved.phraseName, "手机号");
  assert.equal(saved.phraseShortcut, "Ctrl+Alt+P");
});

test("短语快捷键别名冲突时只解除短语绑定并保留内容", () => {
  const { settings, notices } = normalizeSettings({ shortcut: "Ctrl+Alt+P", phraseShortcut: "Option+Control+P", phraseText: "00123" });
  assert.equal(settings.shortcut, "Ctrl+Alt+P");
  assert.equal(settings.phraseShortcut, "");
  assert.equal(settings.phraseText, "00123");
  assert.equal(notices.length, 1);
});

test("短语内容与名称校验类型和长度，使用字符计数保留完整 Unicode", () => {
  assert.equal(normalizeSettings({ phraseText: 123 }).settings.phraseText, "");
  const { settings } = normalizeSettings({ phraseText: "墨".repeat(2001), phraseName: "字".repeat(41) });
  assert.equal(settings.phraseText.length, 2000);
  assert.equal(settings.phraseName.length, 40);
});


test("复制结果迁移保留已有快捷短语，并按语义检测五个入口的冲突", () => {
  const { settings } = normalizeSettings({ phraseShortcut: "Option+Control+V", phraseText: "00123" });
  assert.equal(settings.phraseShortcut, "Option+Control+V");
  assert.equal(settings.copyShortcut, "Ctrl+Alt+Shift+V");
  assert.equal(settings.phraseText, "00123");
});
