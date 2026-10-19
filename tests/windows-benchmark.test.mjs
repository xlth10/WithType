import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const powershell = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const windowsOnly = { skip: process.platform === "win32" ? false : "Requires Windows PowerShell" };
const run = (args) => spawnSync(powershell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(root, "scripts/verify-windows-processing.ps1"), ...args], { cwd: root, encoding: "utf8" });

test("Windows comparison forwards identical whitelisted settings and vocabulary to both source roots", windowsOnly, async () => {
  const directory = await mkdtemp(join(tmpdir(), "withtype-windows-contract-"));
  try {
    const before = join(directory, "before");
    const after = join(directory, "after");
    const scripts = join(after, "scripts/benchmark");
    const settings = join(directory, "settings.json");
    const vocabulary = join(directory, "vocabulary.json");
    const manifest = join(directory, "manifest.json");
    const native = join(directory, "pipeline-benchmark.exe");
    const output = join(directory, "output");
    await mkdir(before);
    await mkdir(scripts, { recursive: true });
    await writeFile(settings, JSON.stringify({
      asrProvider: "apple", asrEndpoint: "https://speech.example.test/v1", asrModel: "private-asr",
      textEndpoint: "https://text.example.test", textModel: "existing-text", vocabulary: "徐翔=徐向",
      asrApiKey: "FAKE_SECRET_MUST_NOT_COPY", privateHistory: "MUST_NOT_COPY",
    }));
    const entries = [{ variant: "玉米", target: "域名", kind: "hotword", source: "auto" }];
    await writeFile(vocabulary, JSON.stringify({ version: 1, entries, candidates: [], dismissed: [] }));
    await writeFile(manifest, "{}");
    // The fixture runner records entry-point arguments only. It never executes
    // the placeholder adapter, reads a real credential, or accesses a service.
    await writeFile(native, "contract fixture only");
    await writeFile(join(scripts, "run.mjs"), `
      import {readFile,mkdir,writeFile} from "node:fs/promises";
      import {join} from "node:path";
      const a=process.argv.slice(2), option=(n)=>a[a.indexOf(n)+1];
      const out=option("--output"); await mkdir(out,{recursive:true});
      const settings=JSON.parse(await readFile(option("--settings"),"utf8"));
      await writeFile(join(out,"contract.json"),JSON.stringify({settings,root:option("--source-root"),adapter:JSON.parse(option("--adapter-command")),platform:option("--platform")}));
    `);
    const result = run([
      "-BaselineRoot", before, "-OptimizedRoot", after, "-Manifest", manifest,
      "-AudioDir", directory, "-SettingsPath", settings, "-VocabularyPath", vocabulary,
      "-NativeBenchmarkExe", native, "-OutputDir", output,
    ]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const baseline = JSON.parse(await readFile(join(output, "baseline/contract.json"), "utf8"));
    const optimized = JSON.parse(await readFile(join(output, "optimized/contract.json"), "utf8"));
    assert.deepEqual(baseline.settings, optimized.settings);
    assert.equal(baseline.settings.asrProvider, "openai");
    assert.equal(baseline.settings.asrModel, "private-asr");
    assert.equal(baseline.settings.textModel, "existing-text");
    assert.deepEqual(baseline.settings.learnedEntries, entries);
    assert.equal("asrApiKey" in baseline.settings, false);
    assert.equal("privateHistory" in baseline.settings, false);
    assert.notEqual(baseline.root, optimized.root);
    assert.deepEqual(baseline.adapter, [native]);
    const status = JSON.parse(await readFile(join(output, "windows-validation.json"), "utf8"));
    assert.equal(status.windowsClientRuntime, "pending-manual-acceptance");
    assert.equal(status.adapterTransport, "native-rust-service-client");
    assert.ok(!`${result.stdout}${result.stderr}`.includes("FAKE_SECRET_MUST_NOT_COPY"));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Windows comparison stops before creating results when the private ASR endpoint is missing", windowsOnly, async () => {
  const directory = await mkdtemp(join(tmpdir(), "withtype-bench-missing-service-"));
  try {
    const settings = join(directory, "settings.json");
    const manifest = join(directory, "manifest.json");
    const output = join(directory, "output");
    await writeFile(settings, JSON.stringify({ asrEndpoint: "", asrModel: "private-asr", textEndpoint: "https://text.example.test", textModel: "existing-text" }));
    await writeFile(manifest, "[]");
    const result = run([
      "-BaselineRoot", directory, "-OptimizedRoot", root, "-Manifest", manifest,
      "-AudioDir", directory, "-SettingsPath", settings, "-OutputDir", output,
    ]);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /asrEndpoint/);
    await assert.rejects(readFile(join(output, "windows-validation.json")), { code: "ENOENT" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
