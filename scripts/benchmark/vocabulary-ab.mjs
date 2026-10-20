// Run the product Apple bridge against fixed synthetic WAVs, with no hints,
// directly added correct words, then deletion. No text service or credentials.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { emptyVocabulary, collectAsrHotWords } from "../../src/vocabulary/rules.js";
import { upsertVocabularyWord } from "../../src/vocabulary/management.js";
import { dismissCorrection } from "../../src/vocabulary/learning.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const output = path.resolve(process.argv[2] || path.join(root, "docs/verification/vocabulary-2026-10-20/asr"));
const audioDirectory = path.join(root, "docs/verification/pipeline-benchmark-2026-10-19/audio");
const fixtures = ["proper-names", "mixed-identifiers", "short-simple", "number-correction"];
const targets = ["岑溪", "翟昀", "声笺", "WithType", "Qwen", "ASR", "Apple Speech"];
let added = emptyVocabulary();
for (const target of targets) added = upsertVocabularyWord(added, target);
let deleted = structuredClone(added);
for (const entry of added.entries) deleted = dismissCorrection(deleted, entry);
const states = [
  { name: "no-vocabulary", words: collectAsrHotWords("", []) },
  { name: "direct-correct-words", words: collectAsrHotWords("", added.entries) },
  { name: "after-delete", words: collectAsrHotWords("", deleted.entries) },
];
if (states[1].words.length !== targets.length || states[2].words.length) throw new Error("Vocabulary lifecycle did not produce the expected hint list");
await mkdir(output, { recursive: true });
const child = spawn("/bin/sh", [path.join(root, "scripts/benchmark/apple-speech-probe.sh")], { cwd: root, detached: true, stdio: ["pipe", "pipe", "pipe"] });
const pending = new Map();
let diagnostic = "";
child.stderr.on("data", (data) => { diagnostic = (diagnostic + data).slice(-4000); });
const lines = createInterface({ input: child.stdout });
lines.on("line", (line) => {
  let response;
  try { response = JSON.parse(line); } catch { return; }
  pending.get(response.id)?.(response);
});
const send = (command) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { pending.delete(command.id); reject(new Error(`Probe timeout: ${command.id}. ${diagnostic}`)); }, command.command === "health" ? 20000 : 145000);
  pending.set(command.id, (response) => { clearTimeout(timer); pending.delete(command.id); resolve(response); });
  child.stdin.write(`${JSON.stringify(command)}\n`);
});
const results = [];
try {
  const health = await send({ id: "health", command: "health", args: { locale: "zh-CN" } });
  await writeFile(path.join(output, "environment.json"), JSON.stringify({ measuredAt: new Date().toISOString(), material: "macOS say synthetic speech from 2026-10-19; no live microphone", provider: "Apple on-device Speech", textServiceCalled: false, health, states }, null, 2) + "\n");
  if (!health.ok || health.result?.authorization !== "authorized" || !health.result?.supportsOnDeviceRecognition || !health.result?.available) throw new Error("Apple probe is not authorized or on-device recognition is unavailable; no ASR calls attempted");
  const hashes = Object.fromEntries(await Promise.all(fixtures.map(async (id) => [id, createHash("sha256").update(await readFile(path.join(audioDirectory, `${id}.wav`))).digest("hex")])));
  await writeFile(path.join(output, "fixtures.json"), JSON.stringify(hashes, null, 2) + "\n");
  // Alternate conditions within each fixture so every condition has two runs.
  for (let round = 1; round <= 2; round++) {
    for (const fixture of fixtures) {
      for (const state of round === 1 ? states : [...states].reverse()) {
        const id = `${fixture}-${state.name}-r${round}`;
        const response = await send({ id, command: "transcribe_audio", args: { audioPath: path.join(audioDirectory, `${fixture}.wav`), locale: "zh-CN", hotWords: state.words } });
        results.push({ fixture, condition: state.name, round, hotWords: state.words, ...response });
        await writeFile(path.join(output, "results.jsonl"), results.map((row) => JSON.stringify(row)).join("\n") + "\n");
        console.log(`${id}: ${response.ok ? response.result.text : response.error}`);
      }
    }
  }
} finally {
  child.stdin.end();
  lines.close();
  try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill(); }
}
if (results.some((row) => !row.ok)) throw new Error(`Some ASR calls failed. See results.jsonl. ${diagnostic}`);
console.log(`Saved ${results.length} real Apple ASR outputs to ${output}`);
