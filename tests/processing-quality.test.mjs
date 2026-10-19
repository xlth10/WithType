import assert from "node:assert/strict";
import { test } from "node:test";
import { createPipeline } from "../src/dictation/pipeline.js";
import { DEFAULT_SETTINGS, normalizeSettings } from "../src/text/settingsMigration.js";
import { hasExplicitCorrection, needsSmartEditing } from "../src/text/dictationRouting.js";

const settings = { ...DEFAULT_SETTINGS, processingMode: "smart", vocabulary: "", textEndpoint: "https://text.example/v1", textModel: "unchanged-model", textFastModel: "unchanged-fast" };
const audio = { audioBase64: "UklGRg==", filename: "fixture.wav", audioMs: 2000 };
function fixture(overrides = {}) {
  const calls = [], events = [];
  const pipeline = createPipeline({ onEvent: (event) => events.push(event), invoke: async (command, payload) => {
    calls.push({ command, payload });
    if (overrides[command]) return overrides[command](payload);
    if (command === "transcribe_audio") return { text: "明天三点，不对，四点开会。", durationMs: 80 };
    if (command === "process_text") return { text: "明天四点开会。" };
    if (command === "paste_text") return { status: "inserted", copied: true, pasted: true };
    if (command === "copy_text") return { status: "copied", copied: true, pasted: false };
    return null;
  } });
  return { pipeline, calls, events };
}

test("短句改口进入原有一次文字整理，普通短句保留直出", async () => {
  for (const [text, edits] of [["明天三点，不对，四点开会。", 1], ["不是周三，是周四。", 1], ["明天开会。", 0], ["不要发送。", 0], ["这个不对称。", 0]]) {
    const { pipeline, calls } = fixture({ transcribe_audio: async () => ({ text }) });
    const result = await pipeline.complete({ snapshot: pipeline.begin({ intent: "dictation", settings }), audio });
    assert.equal(result.ok, true);
    assert.equal(calls.filter((c) => c.command === "process_text").length, edits, text);
    assert.equal(calls.filter((c) => c.command === "process_text")[0]?.payload.request.model, edits ? "unchanged-fast" : undefined);
  }
});

test("改口检测只选择编辑路径，不删除原句或普通否定", () => {
  assert.equal(hasExplicitCorrection("不是500，是50"), true);
  assert.equal(hasExplicitCorrection("不对四点开会"), true);
  assert.equal(hasExplicitCorrection("We meet Friday, sorry, I meant Thursday."), true);
  assert.equal(hasExplicitCorrection("不对外开放"), false);
  for (const text of ["前面的内容不要了，只保留最后一句。", "刚才那段不用了。", "以上全部撤回。", "上午十点改到下午两点。"])
    assert.equal(hasExplicitCorrection(text), true, text);
  assert.equal(needsSmartEditing("不要付款"), false);
  assert.equal(needsSmartEditing("他说不对，改成四点"), true, "引用交给编辑器理解，规则不直接删词");
});

test("HTTP部分结果不整理、不自动输入、不释放录音，保留全部恢复信息", async () => {
  const { pipeline, calls, events } = fixture();
  const snapshot = pipeline.begin({ intent: "dictation", settings: { ...settings, keepHistoryAudio: false } });
  const result = await pipeline.complete({ snapshot, audio: { nativeSessionId: "partial-recording", audioMs: 15000,
    transcript: "已识别的前半段", transcriptionStatus: "partial", transcriptionError: "尾段识别超时" } });
  assert.equal(result.ok, false);
  assert.equal(result.recognitionStatus, "partial");
  assert.ok(!calls.some((c) => ["process_text", "paste_text", "copy_text", "retain_native_audio", "release_native_audio"].includes(c.command)), "部分失败留在恢复spool，不标为成功历史录音");
  const failure = events.find((event) => event.errorKind === "partial");
  assert.equal(failure.partialText, "已识别的前半段");
  assert.equal(failure.audioSessionId, "partial-recording");
  assert.match(failure.message, /尾段识别超时/);
});

test("完整成功结果维持原有释放策略", async () => {
  const { pipeline, calls } = fixture();
  const result = await pipeline.complete({ snapshot: pipeline.begin({ intent: "dictation", settings }),
    audio: { nativeSessionId: "complete-recording", transcript: "明天开会。", transcriptionStatus: "complete" } });
  assert.equal(result.ok, true);
  assert.ok(calls.some((c) => c.command === "release_native_audio"));
});

test("设备中断与部分结果同时发生时显示部分文字，仍禁止成功投递", async () => {
  const { pipeline, calls, events } = fixture();
  const result = await pipeline.complete({ snapshot: pipeline.begin({ intent: "dictation", settings }), audio: {
    nativeSessionId: "interrupted", transcript: "设备中断前的文字", deviceError: "麦克风已断开", transcriptionStatus: "complete" } });
  assert.equal(result.recognitionStatus, "partial");
  assert.equal(events.find((event) => event.errorKind === "partial").partialText, "设备中断前的文字");
  assert.ok(!calls.some((call) => ["paste_text", "copy_text", "retain_native_audio", "release_native_audio"].includes(call.command)));
});

test("空识别结果携带录音会话供重新识别", async () => {
  const { pipeline, events } = fixture();
  const result = await pipeline.complete({ snapshot: pipeline.begin({ intent: "dictation", settings }),
    audio: { nativeSessionId: "empty-recording", transcript: "", transcriptionStatus: "complete" } });
  assert.equal(result.ok, false);
  assert.equal(events.find((event) => event.errorKind === "empty").audioSessionId, "empty-recording");
});

test("保留真正ASR返回、词库后文本和模型后文本以区分错误来源", async () => {
  const { pipeline, events } = fixture({ transcribe_audio: async () => ({ text: "  明天联系徐向，确认新的交付时间和最终预算。  " }),
    process_text: async () => ({ text: "明天联系徐翔，确认新的交付时间和最终预算。" }) });
  await pipeline.complete({ snapshot: pipeline.begin({ intent: "dictation", settings: { ...settings, vocabulary: "徐翔=徐向" } }), audio });
  const done = events.find((event) => event.type === "done");
  assert.equal(done.asrText, "  明天联系徐向，确认新的交付时间和最终预算。  ");
  assert.equal(done.correctedText, "明天联系徐翔，确认新的交付时间和最终预算。");
  assert.equal(done.polishedText, "明天联系徐翔，确认新的交付时间和最终预算。");
});

test("ASR热词冻结并传给请求，后端选择与模型保持用户配置", async () => {
  const { pipeline, calls } = fixture();
  const source = { ...settings, asrProvider: "apple", vocabulary: "WithType=with type", learnedEntries: [{ variant: "徐向", target: "徐翔", source: "auto", kind: "hotword" }] };
  const snapshot = pipeline.begin({ intent: "dictation", settings: source });
  source.learnedEntries[0].target = "不应影响快照";
  await pipeline.complete({ snapshot, audio });
  const request = calls.find((c) => c.command === "transcribe_audio").payload.request;
  assert.equal(request.provider, "apple");
  assert.deepEqual(request.hotWords, ["WithType", "徐翔"]);
});

test("Mac默认Apple；已配置的云服务与文字模型保留，Windows沿用专有ASR", () => {
  assert.equal(normalizeSettings({}, "macos").settings.asrProvider, "apple");
  assert.equal(normalizeSettings({ asrProvider: "openai", asrEndpoint: "" }, "macos").settings.asrProvider, "apple");
  const configured = { asrProvider: "openai", asrEndpoint: "https://asr.example/v1", asrModel: "private-asr", textModel: "current-main", textFastModel: "current-fast" };
  const mac = normalizeSettings(configured, "macos").settings;
  const windows = normalizeSettings(configured, "windows").settings;
  assert.equal(mac.asrProvider, "openai");
  for (const value of [mac, windows]) {
    assert.equal(value.asrModel, "private-asr");
    assert.equal(value.textModel, "current-main");
    assert.equal(value.textFastModel, "current-fast");
  }
  assert.equal(normalizeSettings({}, "windows").settings.asrProvider, "openai");
  assert.equal(normalizeSettings({ asrProvider: "apple" }, "windows").settings.asrProvider, "openai");
});

test("后文撤回旧段时丢弃提前整理缓存，重新整理完整语义", async () => {
  const requests = [];
  const prefix = "项目计划在周三交付。" + "其他信息需要确认，当前安排先按原计划推进。".repeat(20) + "。";
  const transcript = prefix + "刚才的周三作废，改为周四，其他安排保持不变。";
  const { pipeline, events } = fixture({ process_text: async ({ request }) => { requests.push(request); return { text: request.rawText.includes("作废") ? "项目计划周四交付，其他安排保持不变。" : "旧段草稿" }; } });
  const snapshot = pipeline.begin({ intent: "dictation", settings: { ...settings, textIncremental: true } });
  assert.equal(pipeline.acceptTranscript({ sessionId: snapshot.requestId, text: prefix + "未定尾段" }), true);
  await new Promise((resolve) => setImmediate(resolve));
  const result = await pipeline.complete({ snapshot, audio: { nativeSessionId: "whole", transcript, transcriptionStatus: "complete" } });
  assert.equal(result.ok, true);
  assert.equal(requests.at(-1).rawText, transcript);
  assert.equal(events.find((event) => event.type === "done").timings.reusedSegments, 0);
  assert.equal(result.text, "项目计划周四交付，其他安排保持不变。");
});

test("不要了或只保留最后一句也使旧段缓存失效", async () => {
  for (const withdrawal of ["前面的内容不要了，只保留最后一句。", "刚才那段不用了。", "以上全部撤回。"]) {
    const prefix = "前面的安排仅供讨论，请等待最终确定。".repeat(25) + "。";
    const transcript = prefix + withdrawal + "明天暂停发版。";
    const requests = [];
    const { pipeline } = fixture({ process_text: async ({ request }) => { requests.push(request.rawText); return { text: "明天暂停发版。" }; } });
    const snapshot = pipeline.begin({ intent: "dictation", settings: { ...settings, textIncremental: true } });
    pipeline.acceptTranscript({ sessionId: snapshot.requestId, text: prefix + "未定尾段" });
    await new Promise((resolve) => setImmediate(resolve));
    await pipeline.complete({ snapshot, audio: { nativeSessionId: "withdrawal", transcript, transcriptionStatus: "complete" } });
    assert.equal(requests.at(-1), transcript, withdrawal);
  }
});
