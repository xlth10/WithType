#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const manifestPath = resolve(option("--manifest", new URL("./manifest.json", import.meta.url).pathname));
const out = resolve(option("--output", "/private/tmp/withtype-benchmark-audio-2026-10-19"));
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (process.platform !== "darwin") throw new Error("合成步骤使用macOS say；Windows复用hash相同的WAV。");
await mkdir(out, { recursive: true });
const selected = option("--case", "").split(",").filter(Boolean);
const audio = [];
for (const item of manifest.cases.filter((x) => !selected.length || selected.includes(x.id))) {
  const path = join(out, item.id + ".wav");
  const result = spawnSync("/usr/bin/say", ["-v", manifest.voice, "-r", String(manifest.rate), "--channels=1", "--data-format=LEI16@16000", "-o", path, item.spoken], { encoding: "utf8", timeout: 30000 });
  if (result.status !== 0) throw new Error("say生成失败：" + item.id);
  const wav = await readFile(path);
  let dataBytes = 0;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const size = wav.readUInt32LE(offset + 4);
    if (wav.toString("ascii", offset, offset + 4) === "data") { dataBytes = size; break; }
    offset += 8 + size + size % 2;
  }
  if (!dataBytes) throw new Error("say returned empty audio; rerun outside sandbox");
  audio.push({ id: item.id, filename: item.id + ".wav", sha256: createHash("sha256").update(wav).digest("hex"), audioMs: Math.round(dataBytes / 32), bytes: wav.length });
  process.stdout.write(item.id + " generated\n");
}
await writeFile(join(out, "audio-manifest.json"), JSON.stringify({ corpusId: manifest.corpusId, material: "synthetic-speech", generator: "macOS say", voice: manifest.voice, rate: manifest.rate, sampleRate: 16000, channels: 1, sampleBits: 16, generatedAt: new Date().toISOString(), audio }, null, 2) + "\n");
