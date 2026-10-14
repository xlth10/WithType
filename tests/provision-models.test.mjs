import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const script = join(root, "scripts", "provision-withtype-models.ps1");
const launcher = join(root, "scripts", "configure-withtype-models.bat");
const powershell = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

test("double-click launcher imports its sibling private profile", async () => {
  const source = await readFile(launcher, "utf8");
  assert.match(source, /provision-withtype-models\.ps1/i);
  assert.match(source, /withtype-model-profile\.json/i);
  assert.match(source, /powershell\.exe/i);
});

test("provisioning merges model settings without exposing keys or replacing preferences", async () => {
  const directory = await mkdtemp(join(tmpdir(), "withtype-provision-"));
  const profilePath = join(directory, "profile.json");
  const settingsPath = join(directory, "settings.json");
  const asrKey = "ASR_SECRET_MUST_NOT_LEAK";
  const textKey = "TEXT_SECRET_MUST_NOT_LEAK";
  try {
    await writeFile(profilePath, JSON.stringify({
      asrEndpoint: "https://models.example.test/v1",
      asrModel: "asr-model",
      textEndpoint: "https://models.example.test/",
      textModel: "main-model",
      textFastModel: "fast-model",
      textFallbackModels: "fallback-model",
      textTimeoutMs: 45000,
      textAuthMode: "bearer",
      asrApiKey: asrKey,
      textApiKey: textKey,
    }));
    await writeFile(settingsPath, JSON.stringify({
      shortcut: "Alt+1",
      autoPaste: false,
      textModel: "old-model",
    }));

    const result = spawnSync(powershell, [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", script,
      "-ProfilePath", profilePath,
      "-SettingsPath", settingsPath,
      "-SkipCredentials",
    ], { cwd: root, encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.ok(!`${result.stdout}${result.stderr}`.includes(asrKey));
    assert.ok(!`${result.stdout}${result.stderr}`.includes(textKey));
    const settings = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.equal(settings.shortcut, "Alt+1");
    assert.equal(settings.autoPaste, false);
    assert.equal(settings.asrEndpoint, "https://models.example.test/v1");
    assert.equal(settings.asrModel, "asr-model");
    assert.equal(settings.textEndpoint, "https://models.example.test/");
    assert.equal(settings.textModel, "main-model");
    assert.equal(settings.textFastModel, "fast-model");
    assert.equal(settings.textFallbackModels, "fallback-model");
    assert.equal(settings.textTimeoutMs, 45000);
    assert.equal(settings.textAuthMode, "bearer");
    assert.equal("asrApiKey" in settings, false);
    assert.equal("textApiKey" in settings, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("provisioning writes API keys to Windows Credential Manager without logging them", async () => {
  const directory = await mkdtemp(join(tmpdir(), "withtype-credential-"));
  const profilePath = join(directory, "profile.json");
  const settingsPath = join(directory, "settings.json");
  const suffix = `${process.pid}-${Date.now()}`;
  const asrTarget = `withtype-test-asr-${suffix}`;
  const textTarget = `withtype-test-text-${suffix}`;
  const asrKey = "TEMP_ASR_CREDENTIAL_SECRET";
  const textKey = "TEMP_TEXT_CREDENTIAL_SECRET";
  const cmdkey = join(process.env.SystemRoot || "C:\\Windows", "System32", "cmdkey.exe");
  try {
    await writeFile(profilePath, JSON.stringify({
      asrEndpoint: "https://models.example.test/v1",
      asrModel: "asr-model",
      textEndpoint: "https://models.example.test/",
      textModel: "main-model",
      textFastModel: "fast-model",
      textFallbackModels: "fallback-model",
      textTimeoutMs: 60000,
      textAuthMode: "bearer",
      asrApiKey: asrKey,
      textApiKey: textKey,
    }));

    const result = spawnSync(powershell, [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", script,
      "-ProfilePath", profilePath,
      "-SettingsPath", settingsPath,
      "-AsrCredentialTarget", asrTarget,
      "-TextCredentialTarget", textTarget,
    ], { cwd: root, encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.ok(!`${result.stdout}${result.stderr}`.includes(asrKey));
    assert.ok(!`${result.stdout}${result.stderr}`.includes(textKey));
    const listed = spawnSync(cmdkey, ["/list"], { encoding: "utf8" });
    assert.equal(listed.status, 0, listed.stderr);
    assert.ok(listed.stdout.includes(asrTarget));
    assert.ok(listed.stdout.includes(textTarget));
  } finally {
    spawnSync(cmdkey, [`/delete:${asrTarget}`], { encoding: "utf8" });
    spawnSync(cmdkey, [`/delete:${textTarget}`], { encoding: "utf8" });
    await rm(directory, { recursive: true, force: true });
  }
});
