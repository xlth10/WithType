import assert from "node:assert/strict";
import { test } from "node:test";
import { BRAND } from "../src/ui/brand.js";
import { fitWelcomeFontSize, normalizeWelcomeText, WELCOME_TEXT_LIMIT } from "../src/ui/welcome.js";
import { normalizeSettings, toPersistedSettings } from "../src/text/settingsMigration.js";

test("old or empty settings keep the default greeting without losing existing preferences", () => {
  for (const value of [undefined, null, "", " \n\t ", 123]) {
    assert.equal(normalizeSettings({ welcomeText: value, asrModel: "private-asr" }).settings.welcomeText, BRAND.welcome);
  }
  assert.equal(normalizeSettings({ asrModel: "private-asr" }).settings.asrModel, "private-asr");
});

test("custom names and complete greetings survive settings persistence", () => {
  for (const text of ["Welcome, outsider", "Welcome，outsider", "今天也自在地表达", "Hi, <Ellen> & friends"]) {
    const saved = JSON.parse(JSON.stringify(toPersistedSettings({ welcomeText: text })));
    assert.equal(normalizeSettings(saved).settings.welcomeText, text);
  }
});

test("greetings stay on one line and the limit preserves whole Unicode code points", () => {
  assert.equal(normalizeWelcomeText("  Welcome，outsider\n \t"), "Welcome，outsider");
  const text = normalizeWelcomeText("墨".repeat(WELCOME_TEXT_LIMIT - 1) + "😊extra");
  assert.equal(Array.from(text).length, WELCOME_TEXT_LIMIT);
  assert.ok(text.endsWith("😊"));
});

test("long greetings fit the same camera framing; short ones keep their original size", () => {
  const maxWidth = (640 - 64) / (2.12 * 1.06);
  const shortWidth = (size) => 8 * size;
  const longWidth = (size) => WELCOME_TEXT_LIMIT * size;
  assert.equal(fitWelcomeFontSize(24, maxWidth, shortWidth), 24);
  const fitted = fitWelcomeFontSize(24, maxWidth, longWidth);
  assert.ok(fitted < 24);
  assert.ok(longWidth(fitted) * 2.12 * 1.06 <= 640 - 64 + .001);
});

test("adding a greeting preserves the formal app's copy shortcut and streaming preferences", () => {
  const saved = toPersistedSettings({
    welcomeText: "Welcome，outsider",
    copyShortcut: "Ctrl+Shift+V",
    textStreaming: false,
    textIncremental: true,
    keepHistoryAudio: true,
    historyRetentionDays: 90,
    processingMode: "original",
    textModel: "private-model",
    textAuthMode: "none",
  });
  const { settings } = normalizeSettings(JSON.parse(JSON.stringify(saved)));
  assert.equal(settings.welcomeText, "Welcome，outsider");
  assert.equal(settings.copyShortcut, "Ctrl+Shift+V");
  assert.equal(settings.textStreaming, false);
  assert.equal(settings.textIncremental, true);
  assert.equal(settings.keepHistoryAudio, true);
  assert.equal(settings.historyRetentionDays, 90);
  assert.equal(settings.processingMode, "original");
  assert.equal(settings.textModel, "private-model");
  assert.equal(settings.textAuthMode, "none");
});
