import { test } from "node:test";
import assert from "node:assert/strict";
import { createPipeline } from "../src/dictation/pipeline.js";
import { DEFAULT_SETTINGS } from "../src/text/settingsMigration.js";
import { splitText, referenceTail } from "../src/text/segments.js";

const settings = { ...DEFAULT_SETTINGS, processingMode: "smart", textEndpoint: "http://fixture/v1", textModel: "main", vocabulary: "" };
const audio = { audioBase64: "fixture", filename: "fixture.wav", encodeMs: 2 };
function setup(raw, process, extra = {}) {
  const requests = [], pastes = [], events = [];
  const pipeline = createPipeline({ ...extra, onEvent: (event) => events.push(event), invoke: async (command, payload) => {
    if (command === "transcribe_audio") return { text: raw, durationMs: 1 };
    if (command === "process_text" || command === "stream_text") { requests.push(payload.request); return process(payload.request); }
    if (command === "paste_text") { pastes.push(payload.text); return { status: "inserted", copied: true, pasted: true }; }
    if (command.startsWith("cancel_")) return;
    throw new Error(command);
  } });
  return { pipeline, requests, pastes, events };
}

test("超长普通整理覆盖尾部，所有原文按顺序参与模型请求", async () => {
  const raw = "第一段不能丢失。".repeat(1700) + "最后金额为12345，不能批准。";
  const h = setup(raw, async (r) => ({ text: r.rawText }));
  const result = await h.pipeline.complete({ snapshot: h.pipeline.begin({ intent: "dictation", settings }), audio });
  assert.equal(result.ok, true);
  assert.ok(h.requests.map((r) => r.rawText).join("") === raw, "完整原文必须按顺序参与请求");
  assert.ok(h.pastes[0].endsWith("最后金额为12345，不能批准。"));
  assert.ok(h.requests.every((r) => r.rawText.length <= 12000));
});

test("普通整理优先快速模型，复杂技能仍使用主模型", async () => {
  const h = setup("这是一段超过直出边界且足够长的普通整理文本。", async () => ({ text: "成稿" }));
  await h.pipeline.complete({ snapshot: h.pipeline.begin({ intent: "dictation", settings: { ...settings, textFastModel: "fast" } }), audio });
  assert.equal(h.requests[0].model, "fast");
});

test("备用模型共享剩余预算，预算耗尽不再请求且保留全文", async () => {
  let time = 0;
  const raw = "需要保留全部识别文字，不能因超时丢失。";
  const h = setup(raw, async () => { time += 3100; throw new Error("文字模型响应超时"); }, { clock: () => time });
  await h.pipeline.complete({ snapshot: h.pipeline.begin({ intent: "dictation", settings: { ...settings, textTimeoutMs: 3000, textFallbackModels: "backup" } }), audio });
  assert.equal(h.requests.length, 1);
  assert.deepEqual(h.pastes, [raw]);
});

test("分段保留 Unicode、空白与顺序，不拆 surrogate pair", () => {
  const raw = "甲😀乙。\n".repeat(1000);
  const chunks = splitText(raw, 31);
  assert.ok(chunks.join("") === raw);
  assert.ok(chunks.every((s) => s.length <= 31 && !/[\uD800-\uDBFF]$/u.test(s) && !/^[\uDC00-\uDFFF]/u.test(s)));
  const tail = referenceTail("😀".repeat(250) + "甲");
  assert.ok(tail.length <= 500 && !/^[\uDC00-\uDFFF]/u.test(tail));
});

test("后段失败时整体回退完整原文，不能只粘贴成功前段", async () => {
  const raw = "长文数字123，不能删尾。".repeat(1500);
  let count = 0;
  const h = setup(raw, async (r) => { if (++count === 2) throw new Error("HTTP 400"); return { text: r.rawText }; });
  await h.pipeline.complete({ snapshot: h.pipeline.begin({ intent: "dictation", settings }), audio });
  assert.ok(h.pastes[0] === raw);
  assert.match(h.events.find((e) => e.type === "done").warning, /400/);
});

test("需要全文规划的超长技能明确失败且不请求被裁掉的前缀", async () => {
  const h = setup("文字".repeat(6500), async () => { throw new Error("不应调用"); });
  const result = await h.pipeline.complete({ snapshot: h.pipeline.begin({ intent: "command", settings }), audio });
  assert.equal(result.stage, "text");
  assert.equal(h.requests.length, 0);
  assert.equal(h.pastes.length, 0);
});

const turn = () => new Promise((resolve) => setTimeout(resolve, 0));
test("录音中已整理稳定段，结束复用缓存且只处理尾部", async () => {
  const raw = "这一段包含明确的数字123以及不能批准的要求。".repeat(24) + "这是最后的未定尾段。";
  const h = setup(raw, async (r) => ({ text: r.rawText }));
  const snapshot = h.pipeline.begin({ intent: "dictation", settings: { ...settings, textIncremental: true } });
  assert.equal(h.pipeline.acceptTranscript({ sessionId: snapshot.requestId, text: raw }), true);
  await turn();
  const beforeStop = h.requests.length;
  assert.equal(beforeStop, 1);
  h.pipeline.markStopped(snapshot);
  const result = await h.pipeline.complete({ snapshot, audio });
  assert.equal(result.ok, true);
  assert.equal(h.requests.length, 2);
  assert.ok(h.requests.map((r) => r.rawText).join("") === raw);
  assert.ok(h.pastes[0].endsWith("这是最后的未定尾段。"));
});

test("最终 ASR 修改了缓存前缀，整条任务重新整理而不复用旧结果", async () => {
  const partial = "这个稳定段说不能批准数字123。".repeat(30) + "最后一句。";
  const raw = partial.replaceAll("不能批准", "已经批准");
  const h = setup(raw, async (r) => ({ text: r.rawText }));
  const snapshot = h.pipeline.begin({ intent: "dictation", settings: { ...settings, textIncremental: true } });
  h.pipeline.acceptTranscript({ sessionId: snapshot.requestId, text: partial });
  await turn();
  await h.pipeline.complete({ snapshot, audio });
  assert.equal(h.requests.at(-1).rawText, raw);
  assert.ok(!h.pastes[0].includes("不能批准"));
});

test("提前整理默认关闭，自动意图与非普通整理不启动后台请求", async () => {
  const raw = "一段足够长的口述。".repeat(50);
  const h = setup(raw, async (r) => ({ text: r.rawText }));
  for (const extra of [{}, { textIncremental: true, autoIntent: true }, { textIncremental: true, processingMode: "skill" }]) {
    const snapshot = h.pipeline.begin({ intent: "dictation", settings: { ...settings, ...extra } });
    assert.equal(h.pipeline.acceptTranscript({ sessionId: snapshot.requestId, text: raw }), false);
  }
  assert.equal(h.requests.length, 0);
});

test("流式预览取消后拒绝旧调用，也不将半篇粘贴到目标", async () => {
  const saved = globalThis.window;
  globalThis.window = { __TAURI_INTERNALS__: {} };
  try {
    let resolve;
    const h = setup("这是超过直出边界的完整正文，不能只输入半篇内容。", () => new Promise((r) => { resolve = r; }));
    const snapshot = h.pipeline.begin({ intent: "dictation", settings });
    const task = h.pipeline.complete({ snapshot, audio });
    await turn();
    const frame = { callId: h.requests[0].requestId, requestId: snapshot.requestId, text: "部分结果" };
    assert.equal(h.pipeline.acceptTextStream(frame), true);
    h.pipeline.cancel();
    assert.equal(h.pipeline.acceptTextStream(frame), false);
    resolve({ text: "成稿" });
    assert.equal((await task).stage, "cancelled");
    assert.equal(h.pastes.length, 0);
  } finally { globalThis.window = saved; }
});

test("录音后出现翻译口令，丢弃普通整理缓存并翻译完整正文", async () => {
  const body = "这是正文中的数字123和不能批准的要求。".repeat(25) + "尾段也要保留。";
  const h = setup(body + "用英文", async (r) => ({ text: r.task === "translate" ? "完整译文" : "缓存草稿" }));
  const snapshot = h.pipeline.begin({ intent: "dictation", settings: { ...settings, textIncremental: true } });
  h.pipeline.acceptTranscript({ sessionId: snapshot.requestId, text: body });
  await turn();
  await h.pipeline.complete({ snapshot, audio });
  assert.equal(h.requests.at(-1).task, "translate");
  assert.ok(h.requests.at(-1).rawText === body.slice(0, -1), "保留全文正文；沿用语言口令移除相邻句号的现有规则");
  assert.deepEqual(h.pastes, ["完整译文"]);
});

test("取消后台提前整理后，迟到结果不产生预览或投递", async () => {
  const raw = "这段足够长，不能在取消后继续输入。".repeat(30) + "最后一段。";
  let resolve;
  const h = setup(raw, () => new Promise((r) => { resolve = r; }));
  const snapshot = h.pipeline.begin({ intent: "dictation", settings: { ...settings, textIncremental: true } });
  h.pipeline.acceptTranscript({ sessionId: snapshot.requestId, text: raw });
  await turn();
  h.pipeline.cancel();
  resolve({ text: "迟到草稿" });
  await turn();
  assert.equal(h.events.filter((e) => e.type === "text-preview").length, 0);
  assert.equal(h.pastes.length, 0);
});

test("停止后的墙钟指标不累加录音中已完成的 ASR", async () => {
  let time = 10000;
  const pipeline = createPipeline({ clock: () => time, invoke: async (command) => {
    if (command === "process_text") { time += 300; return { text: "完整成稿" }; }
    if (command === "paste_text") { time += 20; return; }
    if (command === "release_native_audio") return;
    throw new Error(command);
  } });
  const snapshot = pipeline.begin({ intent: "dictation", settings });
  time += 2000;
  pipeline.markStopped(snapshot);
  time += 150;
  const result = await pipeline.complete({ snapshot, audio: { nativeSessionId: "fixture", transcript: "这是一段超过直出边界的完整识别文字，必须保留原意。", asrMs: 9000 } });
  assert.equal(result.timings.asrMs, 9000);
  assert.equal(result.timings.stopToAsrMs, 150);
  assert.equal(result.timings.stopToReadyMs, 450);
  assert.equal(result.timings.stopToDeliveredMs, 470);
});
