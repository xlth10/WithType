import { test } from "node:test";
import assert from "node:assert/strict";
import { createPipeline } from "../src/dictation/pipeline.js";
import { copyResult, normalizeDelivery, recentResult, needsResultCard } from "../src/dictation/delivery.js";

const settings = { autoPaste: true, processingMode: "original", vocabulary: "", autoLearn: false };
const audio = { bytes: [0], filename: "test.wav", mime: "audio/wav", audioMs: 1000 };
const copied = { status: "copied", copied: true, pasted: false, message: "已复制" };
function setup(handlers) {
  const events = [], calls = [];
  const pipeline = createPipeline({ invoke: async (name, args) => {
    calls.push(name);
    if (handlers[name]) return handlers[name](args);
    if (name === "transcribe_audio") return { text: "完整正文" };
    throw new Error(name);
  }, onEvent: event => events.push(event) });
  return { pipeline, events, calls };
}

test("missing native result and key submission never claim confirmed insertion", () => {
  assert.equal(normalizeDelivery(undefined).status, "retained");
  const sent = normalizeDelivery({ status: "sent", pasted: true, copied: true });
  assert.equal(sent.pasted, false);
  assert.equal(needsResultCard(sent), true);
});

test("unconfirmed paste keeps complete body and provides recovery outcome", async () => {
  const { pipeline, events } = setup({ paste_text: () => ({ status: "sent", copied: true, pasted: false }) });
  const result = await pipeline.complete({ snapshot: pipeline.begin({ intent: "dictation", settings }), audio });
  assert.equal(result.ok, true);
  assert.equal(result.pasted, false);
  assert.equal(events.at(-1).delivery.status, "sent");
  assert.equal(events.at(-1).text, "完整正文");
});

test("paste exception actually attempts copy fallback before reporting failure", async () => {
  const { pipeline, calls, events } = setup({ paste_text: () => { throw new Error("input blocked"); }, copy_text: () => copied });
  const result = await pipeline.complete({ snapshot: pipeline.begin({ intent: "dictation", settings }), audio });
  assert.deepEqual(calls, ["transcribe_audio", "paste_text", "copy_text"]);
  assert.equal(result.delivery.copied, true);
  assert.equal(events.at(-1).type, "paste-failed");
  assert.equal(events.at(-1).text, "完整正文");
});

test("copy failure is retained, not successful completion or insertion", async () => {
  const { pipeline, events } = setup({ copy_text: () => { throw new Error("clipboard unavailable"); } });
  const result = await pipeline.complete({ snapshot: pipeline.begin({ intent: "dictation", settings: { ...settings, autoPaste: false } }), audio });
  assert.equal(result.ok, false);
  assert.equal(result.stage, "copy");
  assert.equal(events.at(-1).delivery.status, "retained");
  assert.equal(events.at(-1).delivery.copied, false);
  assert.equal(events.at(-1).text, "完整正文");
  assert.match(events.at(-1).delivery.message, /clipboard unavailable/);
});

test("retry and original recovery do not inject text into settings window", async () => {
  for (const method of ["retry", "insertRaw"]) {
    const { pipeline, calls } = setup({ copy_text: () => copied });
    const result = await pipeline[method]({ intent: "dictation", rawText: "恢复正文", settings });
    assert.equal(result.delivery.status, "copied");
    assert.deepEqual(calls, ["capture_input_target", "copy_text"]);
    assert.equal(result.pasted, false);
  }
});

test("explicit insertion captures the chosen target before pasting", async () => {
  let learn;
  const { pipeline, calls } = setup({ capture_input_target: () => {}, paste_text: args => { learn = args.learn; return { status: "inserted", pasted: true, copied: true }; } });
  const result = await pipeline.insertResult({ text: "选择目标后的正文", settings: { ...settings, autoLearn: true } });
  assert.deepEqual(calls, ["capture_input_target", "paste_text"]);
  assert.equal(result.pasted, true);
  assert.equal(learn, false, "历史或生成内容的显式输入不学习纠正词汇");
});

test("target capture failure still delivers a recoverable result", async () => {
  const { pipeline, events } = setup({ capture_input_target: () => { throw new Error("provider timeout"); }, paste_text: () => copied });
  const result = await pipeline.insertResult({ text: "保留完整正文", settings });
  assert.equal(result.delivery.status, "copied");
  assert.equal(events.at(-1).text, "保留完整正文");
});

test("already committed result is archived after cancellation without done UI event", async () => {
  let resolve;
  const { pipeline, events } = setup({ paste_text: () => new Promise(r => { resolve = r; }), cancel_paste: () => {}, cancel_audio_session: () => {}, cancel_text_request: () => {} });
  const running = pipeline.complete({ snapshot: pipeline.begin({ intent: "dictation", settings }), audio });
  await new Promise(r => setTimeout(r, 0));
  pipeline.cancel();
  resolve({ status: "retained", copied: true, pasted: false, message: "输入尚未确认" });
  const result = await running;
  assert.equal(result.stale, true);
  assert.equal(events.at(-1).type, "archived-result");
  assert.equal(events.some(e => e.type === "done"), false);
});

test("copy fallback committed during cancellation is also recoverable", async () => {
  let resolve;
  const { pipeline, events } = setup({ paste_text: () => { throw new Error("blocked"); }, copy_text: () => new Promise(r => { resolve = r; }), cancel_paste: () => {}, cancel_audio_session: () => {}, cancel_text_request: () => {} });
  const running = pipeline.complete({ snapshot: pipeline.begin({ intent: "dictation", settings }), audio });
  await new Promise(r => setTimeout(r, 0));
  pipeline.cancel();
  resolve(copied);
  assert.equal((await running).stale, true);
  assert.equal(events.at(-1).type, "archived-result");
  assert.equal(events.some(e => ["done", "paste-failed"].includes(e.type)), false);
});

test("latest recoverable result is restored from persisted history, not clipboard", async () => {
  assert.equal(recentResult([{ text: "取消后已提交的正文", archived: true, savedAt: 4 }, { text: "", savedAt: 3 }, { text: "上次完成", savedAt: 2 }]).text, "上次完成");
  assert.equal(recentResult([]), null);
  const result = await copyResult(async () => { throw new Error("denied"); }, "保留正文");
  assert.equal(result.copied, false);
  assert.equal(result.status, "retained");
});
