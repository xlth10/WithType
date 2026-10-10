// 流水线测试：取消竞态、意图路由、失败分流、预览。
//
// 这里最重要的三条断言不是「功能对不对」，而是「错误情况下会不会破坏用户的东西」：
// - 取消后迟到的 ASR / 文字结果不许改状态、不许上屏；
// - 语音命令失败时，原始指令句一个字都不能上屏；
// - 预览不许占用当前任务号，也不许发请求（sample 模式）。
// createPipeline 的 invoke 是注入式的，所以整条链路无需 Tauri 环境即可测试。

import assert from "node:assert/strict";
import { test } from "node:test";

import { AUTO_COMMAND_CONFIDENCE, classifyAsrError, createPipeline } from "../src/dictation/pipeline.js";

test("ASR 错误分类区分认证、限流、格式与临时故障", () => {
  assert.equal(classifyAsrError("ASR 服务返回 HTTP 401 Unauthorized"), "auth");
  assert.equal(classifyAsrError("ASR 服务返回 HTTP 429 Too Many Requests"), "rate-limit");
  assert.equal(classifyAsrError("ASR 服务返回 HTTP 415 Unsupported Media Type"), "format");
  assert.equal(classifyAsrError("语音识别请求失败：connection reset"), "transient");
});

test("错误消息里带上服务端摘要后，分类结果不变", () => {
  // 2026-09 起 5xx 会回显服务端 body 的 200 字符摘要。上游 vLLM 的
  // RuntimeError 原文里可能带 400/415 之类的词，不能因此被误判成 format。
  assert.equal(
    classifyAsrError('ASR 服务返回 HTTP 500 Internal Server Error：{"error":{"message":"RuntimeError(\\"Qwen response missing text: {\\"text\\": \\"\\"}\\")","type":"bad_response_status_code"}}'),
    "transient",
  );
  assert.equal(
    classifyAsrError('ASR 服务返回 HTTP 400 Bad Request：{"error":{"message":"invalid file format"}}'),
    "format",
  );
  // 网关回显请求头时，摘要里的令牌必须已被打码，且不影响分类。
  assert.equal(classifyAsrError("ASR 服务返回 HTTP 401 Unauthorized：Invalid token: Bearer sk-***"), "auth");
});

test("本地拦下的静音录音归到 silence，而不是设备故障", () => {
  // 这两条消息都含「录音」，必须排在 device 正则之前，否则会被吃掉。
  assert.equal(classifyAsrError("录音里没有采集到有效声音"), "silence");
  assert.equal(classifyAsrError("录音太短，请多说几个字后再结束"), "silence");
  assert.equal(classifyAsrError("麦克风返回了无效声道数"), "device");
});
import { BUILTIN_SKILLS } from "../src/text/builtinSkills.js";
import { DEFAULT_SETTINGS } from "../src/text/settingsMigration.js";

test("自动词库在开始录音时冻结，只影响后续任务", async () => {
  const learnedEntries = [{ variant: "徐向", target: "徐翔", source: "auto" }];
  const { pipeline, pasted } = makePipeline({ transcribe_audio: async () => ({ text: "联系徐向" }) });
  const settings = { ...LOCAL_SETTINGS, learnedEntries };
  const snapshot = pipeline.begin({ intent: "dictation", settings });
  learnedEntries[0].target = "徐相";
  learnedEntries.push({ variant: "联系", target: "联席" });
  await pipeline.complete({ snapshot, audio: AUDIO });
  assert.deepEqual(pasted, ["联系徐翔"]);
});

test("手动词典覆盖冲突自动规则，自动规则不会拆改英文标识符", async () => {
  const { pipeline, pasted } = makePipeline({ transcribe_audio: async () => ({ text: "徐向 OpenWrt MyOpenWrt" }) });
  const settings = { ...LOCAL_SETTINGS, vocabulary: "徐相=徐向", learnedEntries: [
    { variant: "徐向", target: "徐翔" }, { variant: "OpenWrt", target: "OpenWiki" },
  ] };
  await pipeline.complete({ snapshot: pipeline.begin({ intent: "dictation", settings }), audio: AUDIO });
  assert.deepEqual(pasted, ["徐相 OpenWiki MyOpenWrt"]);
});

test("只为允许自动学习的普通口述启动纠正观察，附带本次任务标识", async () => {
  for (const [intent, autoLearn, expected] of [["dictation", true, true], ["dictation", false, false], ["translate", true, false], ["command", true, false], ["skill", true, false]]) {
    const pastes = [];
    const pipeline = createPipeline({ invoke: async (command, payload) => {
      if (command === "transcribe_audio") return { text: "明天开会" };
      if (command === "process_text") return { text: "已处理" };
      if (command === "paste_text") { pastes.push(payload); return; }
      throw new Error(command);
    } });
    const settings = { ...TEXT_SETTINGS, autoLearn, actionSkillId: BUILTIN_SKILLS[1].id };
    const snapshot = pipeline.begin({ intent, settings });
    const result = await pipeline.complete({ snapshot, audio: AUDIO });
    assert.equal(result.ok, true, intent);
    assert.equal(pastes.length, 1, intent);
    assert.equal(pastes[0].learn, expected, `${intent}, autoLearn=${autoLearn}`);
    assert.equal(pastes[0].sessionId, snapshot.requestId);
  }
});

test("关闭自动学习仍使用已保存词库；关闭自动粘贴不会启动观察", async () => {
  const { pipeline, calls } = makePipeline({ transcribe_audio: async () => ({ text: "联系徐向" }) });
  const settings = { ...LOCAL_SETTINGS, autoLearn: false, autoPaste: false, learnedEntries: [{ variant: "徐向", target: "徐翔" }] };
  const result = await pipeline.complete({ snapshot: pipeline.begin({ intent: "dictation", settings }), audio: AUDIO });
  assert.equal(result.text, "联系徐翔");
  assert.equal(result.pasted, false);
  assert.deepEqual(calls, ["transcribe_audio"]);
});

test("语音命令保持原始命令语义，不应用自动词库", async () => {
  let input;
  const { pipeline } = makePipeline({
    transcribe_audio: async () => ({ text: "联系徐向" }),
    process_text: async (payload) => { input = payload.request.rawText; return { text: "已写好" }; },
  });
  const settings = { ...TEXT_SETTINGS, learnedEntries: [{ variant: "徐向", target: "徐翔" }] };
  await pipeline.complete({ snapshot: pipeline.begin({ intent: "command", settings }), audio: AUDIO });
  assert.equal(input, "联系徐向");
});

const AUDIO = { audioBase64: "UklGRg==", filename: "dictation.wav", encodeMs: 5, audioMs: 1000 };

const LOCAL_SETTINGS = {
  ...DEFAULT_SETTINGS,
  processingMode: "original",
  vocabulary: "",
};

const TEXT_SETTINGS = {
  ...LOCAL_SETTINGS,
  textEndpoint: "http://text.internal/v1",
  textModel: "internal-text-model",
};

function makeBackend(handlers = {}) {
  const calls = [];
  const pasted = [];
  const invoke = async (command, payload) => {
    calls.push(command);
    if (command === "paste_text") {
      pasted.push(payload.text);
      return null;
    }
    const handler = handlers[command];
    if (!handler) throw new Error(`测试里未预期的调用：${command}`);
    return handler(payload);
  };
  return { invoke, calls, pasted };
}

function makePipeline(handlers) {
  const events = [];
  const backend = makeBackend(handlers);
  const pipeline = createPipeline({ invoke: backend.invoke, onEvent: (event) => events.push(event) });
  return { pipeline, events, ...backend };
}

/** 让已经排队的微任务跑完（用于「等到某一步真的发出去了」）。 */
function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function findEvent(events, type) {
  return events.find((event) => event.type === type) || null;
}

test("粘贴失败保留最终结果并退出处理中，命令原句不会被当成正文", async () => {
  const events = [];
  const pipeline = createPipeline({
    invoke: async (command) => {
      if (command === "transcribe_audio") return { text: "帮我写封邮件" };
      if (command === "process_text") return { text: "尊敬的客户：请查收附件。" };
      if (command === "paste_text") throw new Error("Windows 未接受粘贴按键");
      throw new Error(command);
    },
    onEvent: (event) => events.push(event),
  });
  const snapshot = pipeline.begin({ intent: "command", settings: TEXT_SETTINGS });
  const result = await pipeline.complete({ snapshot, audio: AUDIO });
  assert.equal(result.ok, false);
  assert.equal(result.stage, "paste");
  assert.equal(result.text, "尊敬的客户：请查收附件。");
  assert.equal(result.pasted, false);
  assert.equal(pipeline.current(), null);
  const failure = findEvent(events, "paste-failed");
  assert.equal(failure.text, result.text);
  assert.equal(failure.rawText, "帮我写封邮件");
  assert.match(failure.message, /历史记录中复制/);
  assert.equal(findEvent(events, "done"), null);
});

test("粘贴拒绝迟到时，取消或开始新任务不会写入旧结果", async () => {
  for (const supersede of [false, true]) {
    const events = [];
    let rejectPaste;
    const pipeline = createPipeline({
      invoke: async (command) => {
        if (command === "transcribe_audio") return { text: "旧任务" };
        if (command === "paste_text") return new Promise((_, reject) => { rejectPaste = reject; });
        throw new Error(command);
      },
      onEvent: (event) => events.push(event),
    });
    const snapshot = pipeline.begin({ intent: "dictation", settings: LOCAL_SETTINGS });
    const task = pipeline.complete({ snapshot, audio: AUDIO });
    await tick();
    const next = supersede ? pipeline.begin({ intent: "dictation", settings: LOCAL_SETTINGS }) : null;
    if (!supersede) pipeline.cancel();
    rejectPaste(new Error("剪贴板被占用"));
    assert.deepEqual(await task, { ok: false, stage: "cancelled", stale: true });
    assert.equal(findEvent(events, "paste-failed"), null);
    assert.equal(findEvent(events, "done"), null);
    assert.equal(pipeline.current(), next?.requestId ?? null);
  }
});

test("文字重试和主动插入原文也处理粘贴失败", async () => {
  const events = [];
  const pipeline = createPipeline({
    invoke: async (command) => {
      if (command === "paste_text") throw new Error("无法打开剪贴板");
      throw new Error(command);
    },
    onEvent: (event) => events.push(event),
  });
  for (const method of ["retry", "insertRaw"]) {
    const result = await pipeline[method]({ intent: "dictation", rawText: "应保留的文字", settings: LOCAL_SETTINGS });
    assert.equal(result.stage, "paste");
    assert.equal(result.text, "应保留的文字");
    assert.equal(pipeline.current(), null);
  }
  assert.equal(events.filter((e) => e.type === "paste-failed").length, 2);
});

test("取消后迟到的 ASR 结果不改状态、不上屏", async () => {
  let resolveAsr;
  const { pipeline, events, calls, pasted } = makePipeline({
    transcribe_audio: () => new Promise((resolve) => { resolveAsr = resolve; }),
  });

  const snapshot = pipeline.begin({ intent: "dictation", settings: LOCAL_SETTINGS });
  const task = pipeline.complete({ snapshot, audio: AUDIO });
  pipeline.cancel();
  resolveAsr({ text: "这段文字不该出现", durationMs: 100 });

  assert.deepEqual(await task, { ok: false, stage: "cancelled", stale: true });
  assert.deepEqual(events, [], "过期任务不许发出任何事件");
  assert.deepEqual(calls, ["transcribe_audio", "cancel_paste", "cancel_audio_session", "cancel_text_request"]);
  assert.deepEqual(pasted, [], "取消后的任务绝不能上屏");
  assert.equal(pipeline.current(), null);
});

test("取消后迟到的文字结果同样不上屏", async () => {
  let resolveText;
  const { pipeline, calls, pasted } = makePipeline({
    transcribe_audio: async () => ({ text: "帮我写封邮件", durationMs: 100 }),
    process_text: () => new Promise((resolve) => { resolveText = resolve; }),
  });

  const snapshot = pipeline.begin({ intent: "command", settings: TEXT_SETTINGS });
  const task = pipeline.complete({ snapshot, audio: AUDIO });
  await tick();
  assert.equal(typeof resolveText, "function", "文字阶段应当已经发出去");

  pipeline.cancel();
  resolveText({ text: "生成好的邮件正文", durationMs: 10 });

  assert.deepEqual(await task, { ok: false, stage: "cancelled", stale: true });
  assert.deepEqual(calls, ["transcribe_audio", "process_text", "cancel_paste", "cancel_audio_session", "cancel_text_request"]);
  assert.deepEqual(pasted, []);
});

test("auto 模式下高置信度命令走命令路径", async () => {
  const { pipeline, calls, pasted } = makePipeline({
    transcribe_audio: async () => ({ text: "帮我写封邮件给客户", durationMs: 120 }),
    process_text: async (payload) =>
      payload.request.task === "intent"
        ? { text: '{"intent":"command","confidence":0.9}', durationMs: 50 }
        : { text: "尊敬的客户：附件是本周进展。", durationMs: 200 },
  });

  const snapshot = pipeline.begin({ intent: "dictation", settings: { ...TEXT_SETTINGS, autoIntent: true } });
  const result = await pipeline.complete({ snapshot, audio: AUDIO });

  assert.deepEqual(calls, ["transcribe_audio", "process_text", "process_text", "paste_text"]);
  assert.equal(result.ok, true);
  assert.equal(result.intent, "command");
  assert.equal(result.text, "尊敬的客户：附件是本周进展。");
  assert.deepEqual(pasted, ["尊敬的客户：附件是本周进展。"]);
});

test("auto 模式下置信度不足按普通口述处理", async () => {
  const { pipeline, calls, pasted } = makePipeline({
    transcribe_audio: async () => ({ text: "快问三这个模型怎么样", durationMs: 120 }),
    process_text: async () => ({ text: '{"intent":"command","confidence":0.5}', durationMs: 50 }),
  });

  const settings = { ...TEXT_SETTINGS, autoIntent: true, vocabulary: "Qwen3=快问三" };
  const snapshot = pipeline.begin({ intent: "dictation", settings });
  const result = await pipeline.complete({ snapshot, audio: AUDIO });

  assert.ok(0.5 < AUTO_COMMAND_CONFIDENCE);
  assert.equal(result.intent, "dictation");
  assert.equal(result.text, "Qwen3这个模型怎么样", "普通口述要经过词典替换");
  assert.deepEqual(calls, ["transcribe_audio", "process_text", "paste_text"]);
  assert.deepEqual(pasted, ["Qwen3这个模型怎么样"]);
});

test("auto 模式解析失败时静默退回普通口述", async () => {
  const { pipeline } = makePipeline({
    transcribe_audio: async () => ({ text: "明天上午十点开会", durationMs: 120 }),
    process_text: async () => ({ text: "我判断不了", durationMs: 50 }),
  });

  const snapshot = pipeline.begin({ intent: "dictation", settings: { ...TEXT_SETTINGS, autoIntent: true } });
  const result = await pipeline.complete({ snapshot, audio: AUDIO });

  assert.equal(result.ok, true);
  assert.equal(result.intent, "dictation");
  assert.equal(result.text, "明天上午十点开会");
});

test("没配文字服务时 auto 模式不发起分流请求", async () => {
  const { pipeline, calls } = makePipeline({
    transcribe_audio: async () => ({ text: "明天上午十点开会", durationMs: 120 }),
  });

  const snapshot = pipeline.begin({ intent: "dictation", settings: { ...LOCAL_SETTINGS, autoIntent: true } });
  const result = await pipeline.complete({ snapshot, audio: AUDIO });

  assert.equal(result.text, "明天上午十点开会");
  assert.deepEqual(calls, ["transcribe_audio", "paste_text"], "原文口述不访问文字 API");
});

test("语音命令失败时不上屏原文，且事件里的 finalText 为空", async () => {
  const { pipeline, events, calls, pasted } = makePipeline({
    transcribe_audio: async () => ({ text: "帮我写封邮件", durationMs: 120 }),
    process_text: async () => { throw new Error("文字模型连接失败"); },
  });

  const snapshot = pipeline.begin({ intent: "command", settings: TEXT_SETTINGS });
  const result = await pipeline.complete({ snapshot, audio: AUDIO });

  assert.deepEqual(calls, ["transcribe_audio", "process_text"], "命令失败后没有任何上屏调用");
  assert.deepEqual(pasted, []);
  assert.equal(result.ok, false);
  assert.equal(result.stage, "text");
  assert.equal(result.intent, "command");
  assert.equal(result.rawText, "帮我写封邮件");

  const failed = findEvent(events, "text-failed");
  assert.ok(failed, "必须上报 text-failed");
  assert.equal(failed.message, "文字模型连接失败");
  assert.equal(failed.finalText, "", "命令失败时界面拿到的可上屏文本必须为空");
  assert.equal(failed.rawText, "帮我写封邮件");
  assert.equal(failed.usedTextService, true);
});

test("insertRaw 拒绝把语音命令的原始指令上屏", async () => {
  const { pipeline, calls, pasted } = makePipeline({});

  const result = await pipeline.insertRaw({
    intent: "command",
    rawText: "帮我写封邮件",
    settings: LOCAL_SETTINGS,
  });

  assert.deepEqual(result, {
    ok: false,
    stage: "command",
    message: "提问或语音命令失败时不会把原文插入当前窗口",
  });
  assert.deepEqual(calls, [], "拒绝时不该调用任何后端命令");
  assert.deepEqual(pasted, []);
});

test("随便问只发回答事件，不向原窗口上屏", async () => {
  let sent;
  const { pipeline, events, pasted } = makePipeline({
    transcribe_audio: async () => ({ text: "今天怎么安排？", durationMs: 120 }),
    process_text: async (payload) => { sent = payload.request; return { text: "先处理最紧急的事。" }; },
  });
  const windowContext = { app: "Code", title: "计划" };
  const snapshot = pipeline.begin({ intent: "ask", settings: TEXT_SETTINGS, windowContext });
  const result = await pipeline.complete({ snapshot, audio: AUDIO });
  assert.equal(result.ok, true);
  assert.equal(sent.task, "ask");
  assert.equal(Object.hasOwn(sent, "windowContext"), false, "窗口来源不得进入文字模型请求");
  assert.deepEqual(pasted, []);
  assert.equal(findEvent(events, "answer").question, "今天怎么安排？");
  assert.equal(findEvent(events, "answer").text, "先处理最紧急的事。");
  assert.deepEqual(findEvent(events, "answer").windowContext, windowContext);
  assert.equal(findEvent(events, "done"), null);
});

test("随便问缺文字模型时不插入原问题", async () => {
  const { pipeline, events, pasted } = makePipeline({
    transcribe_audio: async () => ({ text: "你好吗？", durationMs: 120 }),
  });
  const snapshot = pipeline.begin({ intent: "ask", settings: LOCAL_SETTINGS });
  const result = await pipeline.complete({ snapshot, audio: AUDIO });
  assert.equal(result.stage, "text");
  assert.equal(findEvent(events, "text-failed").finalText, "");
  assert.deepEqual(pasted, []);
});

test("第三个入口翻译并输入译文", async () => {
  let sent;
  const { pipeline, pasted } = makePipeline({
    transcribe_audio: async () => ({ text: "明天开会", durationMs: 120 }),
    process_text: async (payload) => { sent = payload.request; return { text: "We have a meeting tomorrow." }; },
  });
  const snapshot = pipeline.begin({ intent: "translate", settings: TEXT_SETTINGS });
  const result = await pipeline.complete({ snapshot, audio: AUDIO });
  assert.equal(result.ok, true);
  assert.equal(sent.task, "translate");
  assert.deepEqual(pasted, ["We have a meeting tomorrow."]);
});

test("普通口述末尾的语言口令只翻译正文", async () => {
  let sent;
  const { pipeline, pasted } = makePipeline({
    transcribe_audio: async () => ({ text: "明天开会，用日文。", durationMs: 120 }),
    process_text: async (payload) => { sent = payload.request; return { text: "明日会議があります。" }; },
  });
  const snapshot = pipeline.begin({ intent: "dictation", settings: TEXT_SETTINGS });
  const result = await pipeline.complete({ snapshot, audio: AUDIO });
  assert.equal(result.intent, "translate");
  assert.equal(sent.rawText, "明天开会");
  assert.match(sent.messages[0].content, /日文/);
  assert.deepEqual(pasted, ["明日会議があります。"]);
});

test("第三个入口技能只影响本次任务", async () => {
  const sent = [];
  const { pipeline, pasted } = makePipeline({
    transcribe_audio: async () => ({ text: "项目已经交付", durationMs: 120 }),
    process_text: async (payload) => { sent.push(payload.request); return { text: "已完成：项目交付" }; },
  });
  const settings = { ...TEXT_SETTINGS, processingMode: "original", actionSkillId: BUILTIN_SKILLS[1].id };
  const special = pipeline.begin({ intent: "skill", settings });
  await pipeline.complete({ snapshot: special, audio: AUDIO });
  const normal = pipeline.begin({ intent: "dictation", settings });
  await pipeline.complete({ snapshot: normal, audio: AUDIO });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].task, "skill");
  assert.equal(sent[0].skillId, BUILTIN_SKILLS[1].id);
  assert.deepEqual(pasted, ["已完成：项目交付", "项目已经交付"]);
});

test("insertRaw 对普通口述会走完上屏流程", async () => {
  const { pipeline, calls, pasted } = makePipeline({});

  const result = await pipeline.insertRaw({
    intent: "dictation",
    rawText: "识别出来的原文",
    settings: LOCAL_SETTINGS,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["paste_text"]);
  assert.deepEqual(pasted, ["识别出来的原文"]);
});

test("smart 模式缺少文字服务时保留原文并说明原因", async () => {
  const { pipeline, events, calls, pasted } = makePipeline({
    transcribe_audio: async () => ({ text: "嗯那个明天上午我们在会议室开会", durationMs: 120 }),
  });

  const snapshot = pipeline.begin({ intent: "dictation", settings: { ...LOCAL_SETTINGS, processingMode: "smart" } });
  const result = await pipeline.complete({ snapshot, audio: AUDIO });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["transcribe_audio", "paste_text"]);
  assert.deepEqual(pasted, ["嗯那个明天上午我们在会议室开会"]);
  assert.equal(findEvent(events, "done").warning, "尚未配置文字模型，已按原文处理");
});

test("固定版 Typefree 短句不调用文字服务，并去掉末尾句号", async () => {
  const { pipeline, calls, pasted } = makePipeline({ transcribe_audio: async () => ({ text: "明天见。。" }) });
  const settings = { ...TEXT_SETTINGS, processingMode: "smart" };
  const result = await pipeline.complete({ snapshot: pipeline.begin({ intent: "dictation", settings }), audio: AUDIO });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["transcribe_audio", "paste_text"]);
  assert.deepEqual(pasted, ["明天见"]);
});

test("smart 模式发送专用的自然文字整理规则", async () => {
  let sent = null;
  const { pipeline, calls } = makePipeline({
    transcribe_audio: async () => ({ text: "嗯，我说明天，不对，后天发报告。", durationMs: 120 }),
    process_text: async (payload) => {
      sent = payload.request;
      return { text: "我后天发报告。", durationMs: 200 };
    },
  });

  const snapshot = pipeline.begin({ intent: "dictation", settings: { ...TEXT_SETTINGS, processingMode: "smart" } });
  const result = await pipeline.complete({ snapshot, audio: AUDIO });

  assert.equal(result.text, "我后天发报告。");
  assert.deepEqual(calls, ["transcribe_audio", "process_text", "paste_text"]);
  assert.equal(sent.task, "smart");
  assert.ok(sent.messages[0].content.includes("不添加用户没说过的内容"));
  assert.ok(!sent.messages[0].content.includes("待确认"));
  assert.ok(!sent.messages[0].content.includes("用短标题或「栏目：内容」"));
});

test("文字模型按速度路由，临时错误才进入用户配置的备用队列", async () => {
  const models = [];
  const { pipeline } = makePipeline({
    transcribe_audio: async () => ({ text: "把这句话翻译成英文：明天开会", durationMs: 80 }),
    process_text: async ({ request }) => {
      models.push(request.model);
      if (request.model === "fast-model") throw new Error("文字模型响应超时");
      return { text: "Meeting tomorrow.", durationMs: 20 };
    },
  });
  const settings = { ...TEXT_SETTINGS, textFastModel: "fast-model", textFallbackModels: "backup-model" };
  const result = await pipeline.complete({ snapshot: pipeline.begin({ intent: "translate", settings }), audio: AUDIO });
  assert.equal(result.ok, true);
  assert.deepEqual(models, ["fast-model", "internal-text-model"]);
});

test("认证失败不切换备用文字模型", async () => {
  const models = [];
  const { pipeline } = makePipeline({
    transcribe_audio: async () => ({ text: "帮我写封邮件", durationMs: 80 }),
    process_text: async ({ request }) => { models.push(request.model); throw new Error("文字模型认证失败（401）"); },
  });
  const settings = { ...TEXT_SETTINGS, textFallbackModels: "backup-model" };
  const result = await pipeline.complete({ snapshot: pipeline.begin({ intent: "command", settings }), audio: AUDIO });
  assert.equal(result.ok, false);
  assert.deepEqual(models, ["internal-text-model"]);
});

test("明确额度用尽后本次运行跳过该文字模型", async () => {
  const models = [];
  const { pipeline } = makePipeline({
    transcribe_audio: async () => ({ text: "帮我写封邮件", durationMs: 80 }),
    process_text: async ({ request }) => {
      models.push(request.model);
      if (request.model === "internal-text-model") throw new Error("文字模型额度用尽（403）");
      return { text: "邮件正文" };
    },
  });
  const settings = { ...TEXT_SETTINGS, textFallbackModels: "backup-model" };
  for (let index = 0; index < 2; index++) {
    const result = await pipeline.complete({ snapshot: pipeline.begin({ intent: "command", settings }), audio: AUDIO });
    assert.equal(result.ok, true);
  }
  assert.deepEqual(models, ["internal-text-model", "backup-model", "backup-model"]);
});

test("skill 模式的选中项已丢失时提示重新选择", async () => {
  const { pipeline, events, calls, pasted } = makePipeline({
    transcribe_audio: async () => ({ text: "整理一下这段", durationMs: 120 }),
  });

  const snapshot = pipeline.begin({
    intent: "dictation",
    settings: { ...TEXT_SETTINGS, processingMode: "skill", selectedSkillId: "custom.gone" },
  });
  const result = await pipeline.complete({ snapshot, audio: AUDIO });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["transcribe_audio", "paste_text"], "Skill 失效时退回原文并提示");
  assert.deepEqual(pasted, ["整理一下这段"]);
  assert.equal(findEvent(events, "done").warning, "所选 Skill 已不可用，请重新选择");
});

test("skill 模式选中内置 Skill 时把它的说明发给文字模型", async () => {
  let sent = null;
  const { pipeline, calls, pasted } = makePipeline({
    transcribe_audio: async () => ({ text: "嗯那个月底要交付", durationMs: 120 }),
    process_text: async (payload) => {
      sent = payload.request;
      return { text: "已完成：月底交付准备", durationMs: 200 };
    },
  });

  const snapshot = pipeline.begin({
    intent: "dictation",
    settings: { ...TEXT_SETTINGS, processingMode: "skill", selectedSkillId: "builtin.report" },
  });
  const result = await pipeline.complete({ snapshot, audio: AUDIO });

  assert.deepEqual(calls, ["transcribe_audio", "process_text", "paste_text"]);
  assert.equal(result.text, "已完成：月底交付准备");
  assert.deepEqual(pasted, ["已完成：月底交付准备"]);
  assert.equal(sent.task, "skill");
  assert.equal(sent.skillId, "builtin.report");
  assert.equal(sent.messages.length, 2);
  assert.ok(sent.messages[0].content.includes(BUILTIN_SKILLS[1].instruction));
  assert.ok(!sent.messages[0].content.includes("嗯那个月底要交付"), "原文不能进 system 消息");
});

test("clean 模式在本地清理，不访问文字服务", async () => {
  const { pipeline, calls, pasted } = makePipeline({
    transcribe_audio: async () => ({ text: "嗯，那个，明天开会。", durationMs: 120 }),
  });

  const snapshot = pipeline.begin({ intent: "dictation", settings: { ...LOCAL_SETTINGS, processingMode: "clean" } });
  const result = await pipeline.complete({ snapshot, audio: AUDIO });

  assert.equal(result.text, "，明天开会。");
  assert.deepEqual(calls, ["transcribe_audio", "paste_text"]);
  assert.deepEqual(pasted, ["，明天开会。"]);
});

test("关掉自动粘贴时仍然汇报文本，但不调用上屏", async () => {
  const { pipeline, calls, pasted } = makePipeline({
    transcribe_audio: async () => ({ text: "不要粘贴这段", durationMs: 120 }),
  });

  const snapshot = pipeline.begin({ intent: "dictation", settings: { ...LOCAL_SETTINGS, autoPaste: false } });
  const result = await pipeline.complete({ snapshot, audio: AUDIO });

  assert.equal(result.ok, true);
  assert.equal(result.text, "不要粘贴这段");
  assert.equal(result.pasted, false);
  assert.deepEqual(calls, ["transcribe_audio"]);
  assert.deepEqual(pasted, []);
});

test("录音阶段失败时只上报错误", async () => {
  const { pipeline, events, calls } = makePipeline({});

  const snapshot = pipeline.begin({ intent: "dictation", settings: LOCAL_SETTINGS });
  const result = await pipeline.complete({ snapshot, audio: null, audioError: "麦克风不可用" });

  assert.deepEqual(result, { ok: false, stage: "record" });
  assert.deepEqual(calls, []);
  assert.deepEqual(events, [{ type: "error", requestId: snapshot.requestId, stage: "record", message: "麦克风不可用" }]);
});

test("ASR 返回空文本时不继续走文字整理", async () => {
  const { pipeline, events, calls } = makePipeline({
    transcribe_audio: async () => ({ text: "   ", durationMs: 120 }),
  });

  const snapshot = pipeline.begin({ intent: "dictation", settings: TEXT_SETTINGS });
  const result = await pipeline.complete({ snapshot, audio: AUDIO });

  assert.equal(result.ok, false);
  assert.equal(result.stage, "asr");
  assert.deepEqual(calls, ["transcribe_audio"]);
  assert.equal(findEvent(events, "error").message, "识别结果为空，请再说一次");
});

test("ASR 抛错时上报错误且不上屏", async () => {
  const { pipeline, events, calls, pasted } = makePipeline({
    transcribe_audio: async () => { throw new Error("ASR 连接失败"); },
  });

  const snapshot = pipeline.begin({ intent: "dictation", settings: LOCAL_SETTINGS });
  const result = await pipeline.complete({ snapshot, audio: AUDIO });

  assert.equal(result.ok, false);
  assert.equal(result.stage, "asr");
  assert.deepEqual(calls, ["transcribe_audio"]);
  assert.deepEqual(pasted, []);
  assert.equal(findEvent(events, "error").message, "ASR 连接失败");
});

test("retry 沿用原文与意图，不重跑 ASR", async () => {
  const { pipeline, calls, pasted } = makePipeline({
    process_text: async () => ({ text: "生成好的邮件", durationMs: 200 }),
  });

  const result = await pipeline.retry({
    intent: "command",
    rawText: "帮我写封邮件",
    settings: TEXT_SETTINGS,
  });

  assert.equal(result.ok, true);
  assert.equal(result.intent, "command");
  assert.deepEqual(calls, ["process_text", "paste_text"]);
  assert.deepEqual(pasted, ["生成好的邮件"]);
});

test("retry 的意图沿用原值，命令不会退化成普通上屏", async () => {
  const { pipeline, calls, pasted } = makePipeline({
    process_text: async () => { throw new Error("还是连不上"); },
  });

  const result = await pipeline.retry({
    intent: "command",
    rawText: "帮我写封邮件",
    settings: TEXT_SETTINGS,
  });

  assert.equal(result.ok, false);
  assert.equal(result.stage, "text");
  assert.deepEqual(calls, ["process_text"]);
  assert.deepEqual(pasted, []);
});

test("预览不占用当前任务号", async () => {
  const { pipeline, calls } = makePipeline({
    transcribe_audio: () => new Promise(() => {}),
    process_text: async () => ({ text: "预览整理结果", durationMs: 100 }),
  });

  const snapshot = pipeline.begin({ intent: "dictation", settings: TEXT_SETTINGS });
  const result = await pipeline.preview({
    settings: TEXT_SETTINGS,
    skill: BUILTIN_SKILLS[0],
    rawText: "把这段整理成邮件",
  });

  assert.equal(result.ok, true);
  assert.equal(result.text, "预览整理结果");
  assert.equal(pipeline.current(), snapshot.requestId, "预览不能把飞行中的任务判成过期");
  assert.ok(pipeline.isCurrent(snapshot.requestId));
  assert.deepEqual(calls, ["process_text"], "预览只发文字请求，不上屏");
  assert.ok(!calls.includes("paste_text"));
});

test("sample 预览只装配消息，完全不发请求", async () => {
  const { pipeline, calls } = makePipeline({});

  const result = await pipeline.preview({
    settings: TEXT_SETTINGS,
    skill: BUILTIN_SKILLS[0],
    rawText: "把这段整理成邮件",
    sample: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.sample, true);
  assert.equal(result.messages.length, 2);
  assert.deepEqual(result.messages.map((message) => message.role), ["system", "user"]);
  assert.deepEqual(calls, [], "样例预览不产生任何后端调用");
});

test("未配文字模型时预览直接给出配置提示", async () => {
  const { pipeline, calls } = makePipeline({});

  const result = await pipeline.preview({
    settings: LOCAL_SETTINGS,
    skill: BUILTIN_SKILLS[0],
    rawText: "文本",
  });

  assert.deepEqual(result, { ok: false, error: "尚未配置文字模型（地址与模型名称都要填）" });
  assert.deepEqual(calls, []);
});

test("没选 Skill 时预览提示先选 Skill", async () => {
  const { pipeline, calls } = makePipeline({});

  const result = await pipeline.preview({ settings: TEXT_SETTINGS, skill: null, rawText: "文本" });

  assert.deepEqual(result, { ok: false, error: "请先选择要预览的 Skill" });
  assert.deepEqual(calls, []);
});

test("预览失败时把原因原样带回界面", async () => {
  const { pipeline, calls, pasted } = makePipeline({
    process_text: async () => { throw new Error("文字模型响应超时"); },
  });

  const result = await pipeline.preview({
    settings: TEXT_SETTINGS,
    skill: BUILTIN_SKILLS[0],
    rawText: "文本",
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "文字模型响应超时");
  assert.deepEqual(calls, ["process_text"]);
  assert.deepEqual(pasted, [], "预览绝不自动粘贴");
});

test("连续两次预览时，先返回的那一次被标为过期", async () => {
  const resolvers = [];
  const { pipeline } = makePipeline({
    process_text: () => new Promise((resolve) => { resolvers.push(resolve); }),
  });

  const first = pipeline.preview({ settings: TEXT_SETTINGS, skill: BUILTIN_SKILLS[0], rawText: "第一次" });
  const second = pipeline.preview({ settings: TEXT_SETTINGS, skill: BUILTIN_SKILLS[0], rawText: "第二次" });
  resolvers[0]({ text: "第一次的结果", durationMs: 10 });
  resolvers[1]({ text: "第二次的结果", durationMs: 10 });

  assert.deepEqual(await first, { ok: false, stale: true });
  assert.equal((await second).text, "第二次的结果");
});

test("textReady 要求地址与模型名都填齐", () => {
  const { pipeline } = makePipeline({});
  assert.equal(pipeline.textReady(TEXT_SETTINGS), true);
  assert.equal(pipeline.textReady({ ...TEXT_SETTINGS, textModel: "  " }), true, "空白的模型名由后端再拦一次");
  assert.equal(pipeline.textReady({ ...TEXT_SETTINGS, textEndpoint: "" }), false);
  assert.equal(pipeline.textReady({ ...TEXT_SETTINGS, textModel: "" }), false);
});

test("流水线暴露的内置 Skill 就是应用内置的那四个", () => {
  const { pipeline } = makePipeline({});
  assert.equal(pipeline.builtinSkills, BUILTIN_SKILLS);
});
