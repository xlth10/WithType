import { cloneSkill } from "../text/skillContract.js";
// 任务流水线：任务快照、ASR、文字路由、Skill、上屏与耗时统计。
//
// 三条硬规则，改这个文件时必须保持：
// 1. requestId 是唯一的有效性凭据。任何 await 返回后先比对 requestId，
//    过期任务不许改状态、不许写历史、不许上屏。
// 2. 这里是**唯一**允许调用 paste_text 的地方。其它模块一律通过 pipeline 上屏。
// 3. 语音命令（intent === "command"）失败时，绝不把原始命令句粘贴出去。
//    宁可什么都不输入，也不能把「帮我写封邮件」这种指令当正文打进别人的文档。

import { ASK_INSTRUCTION, BUILTIN_SKILLS, COMMAND_INSTRUCTION, SMART_INSTRUCTION, buildMessages, findBuiltinSkill } from "../text/builtinSkills.js";
import { applyLearnedVocabulary } from "../vocabulary/learning.js";
import { applyVocabulary, effectiveTextLength, lightlyCleanText, stripShortTrailingFullStop } from "../text/localText.js";
import { parseOutputLanguage, translationInstruction } from "../text/outputLanguage.js";
import { splitText, stablePrefix, referenceTail, TEXT_CHUNK_LIMIT } from "../text/segments.js";
import { copyResult, normalizeDelivery } from "./delivery.js";

export const INTENTS = ["dictation", "command", "ask", "translate", "skill"];
export const SMART_DIRECT_OUTPUT_MAX_LENGTH = 15;

/** 命令识别的最低置信度：低于它一律按普通口述处理，避免误拦用户的正常输入。 */
export const AUTO_COMMAND_CONFIDENCE = 0.85;

export function classifyAsrError(error) {
  const message = String(error?.message || error || "");
  if (/HTTP (401|403)\b|API Key|API 密钥|凭据库|认证|权限/i.test(message)) return "auth";
  if (/HTTP 429\b|限流|额度/i.test(message)) return "rate-limit";
  if (/HTTP (400|415|422)\b|格式/i.test(message)) return "format";
  if (/超时|请求失败|无法连接|网络|HTTP 5\d\d\b/i.test(message)) return "transient";
  // 本地静音门（audio.rs）与最短长度门发出的提示。必须排在 device 之前：
  // 这两条消息里都含「录音」，否则会被底下那条设备正则吃掉。
  if (/没有采集到有效声音|录音太短/.test(message)) return "silence";
  if (/麦克风|设备|录音/i.test(message)) return "device";
  return "unknown";
}

/** 送去整理的单条文本上限，避免超长文本拖垮私有文字服务。 */
const MAX_TEXT_CHARS = TEXT_CHUNK_LIMIT;

function now() {
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

function elapsedSince(start) {
  return Math.max(0, Math.round(now() - start));
}

function mergeSkill(skillId, customSkills) {
  if (!skillId) return null;
  return findBuiltinSkill(skillId) || customSkills.find((skill) => skill.id === skillId) || null;
}

export function createPipeline({ invoke, onEvent = () => {}, clock = now, onTaskStart = () => {}, onTaskEnd = () => {} }) {
  const elapsedSince = (start) => Math.max(0, Math.round(clock() - start));
  let counter = 0;
  let currentId = null;
  /** 预览不占当前任务序号，用自己的一个 id：否则预览会把飞行中的录音任务判成过期。 */
  let previewId = null;
  let previewSnapshot = null;
  let cancelled = new Set();
  const quotaCooldown = new Map();
  let activeSnapshot = null;
  let callSequence = 0;
  const streamCalls = new Map();
  const live = (snapshot) => guard(snapshot) || snapshot.requestId === previewId;
  const newBudget = (snapshot) => ({ deadline: clock() + Math.max(3000, Math.min(300000, Number(snapshot.settings.textTimeoutMs) || 60000)) });
  const stageBudget = (snapshot) => snapshot.textBudget ||= newBudget(snapshot);
  const remaining = (budget) => Math.max(0, Math.floor(budget.deadline - clock()));

  const nextRequestId = () => {
    counter += 1;
    return `task-${Date.now().toString(36)}-${counter}`;
  };

  const isCurrent = (requestId) => Boolean(requestId) && requestId === currentId && !cancelled.has(requestId);

  /** 事务性检查点：不通过就直接停手，什么副作用都不要产生。 */
  const guard = (snapshot) => isCurrent(snapshot.requestId);

  /**
   * 一条任务走完后释放 currentId。
   * 不释放的话，下一次 begin 之前的预览会被「有任务在飞」误判而拒绝；
   * 只释放自己那一条，避免把后来者的序号清掉。
   */
  const release = (requestId) => {
    if (currentId === requestId) { endTask(activeSnapshot); currentId = null; activeSnapshot = null; }
  };

  function endTask(snapshot) {
    if (!snapshot || snapshot.ended) return;
    snapshot.ended = true;
    // End can precede registration completion; remove the lease only after it has been installed.
    Promise.resolve(snapshot.lease).then(() => onTaskEnd(snapshot.requestId)).catch(() => {});
  }
  function startLease(snapshot) {
    snapshot.lease = Promise.resolve().then(() => onTaskStart(snapshot.requestId));
    snapshot.lease.catch(() => {}); // prepare() still observes the rejection.
  }
  function cancelPreview() {
    if (!previewSnapshot) return;
    for (const id of previewSnapshot.activeTextIds) void invoke("cancel_text_request", { requestId: id }, () => Promise.resolve()).catch(() => {});
    void invoke("cancel_text_request", { requestId: previewSnapshot.requestId }, () => Promise.resolve()).catch(() => {});
    endTask(previewSnapshot);
    previewSnapshot = null;
    previewId = null;
  }
  async function prepare(snapshot) {
    await snapshot.lease;
    return live(snapshot) && !snapshot.ended;
  }

  function captureTarget(snapshot) {
    if (snapshot.capturePending) return snapshot.capturePending;
    snapshot.capturePending = (async () => {
      if (!await prepare(snapshot)) return false;
      const started = clock();
      let capture;
      try {
        const value = await invoke("capture_input_target", {
          sessionId: snapshot.requestId,
          ...(snapshot.inputToken ? { inputToken: snapshot.inputToken } : {}),
        }, () => Promise.resolve());
        capture = value?.reason ? value : { reason: "ready", message: "", elapsedMs: elapsedSince(started) };
      } catch (error) {
        capture = { reason: "capture_failed", message: "输入位置检查失败", elapsedMs: elapsedSince(started), error: String(error?.message || error).slice(0, 256) };
      }
      if (!guard(snapshot)) return false;
      snapshot.inputCapture = capture;
      onEvent({ type: "input-target", requestId: snapshot.requestId, capture });
      return true;
    })();
    snapshot.capturePending.catch(() => {}); // prepare() still reports lease failures.
    return snapshot.capturePending;
  }

  /** 把当前配置固化成快照。录音期间用户改模式、改词典、改 Skill 都不影响这一条任务。 */
  const makeSnapshot = (requestId, { intent, settings, customSkills = [], windowContext = null, skillId = "", inputToken = null }) => {
    const selectedSkill = mergeSkill(skillId || (intent === "skill" ? settings.actionSkillId : settings.selectedSkillId), customSkills);
    return {
      requestId,
      intent: INTENTS.includes(intent) ? intent : "dictation",
      processingMode: settings.processingMode,
      selectedSkillId: selectedSkill ? selectedSkill.id : "",
      translationLanguage: settings.defaultTranslationLanguage || "英文",
      skill: cloneSkill(selectedSkill),
      windowContext,
      inputToken,
      vocabulary: settings.vocabulary || "",
      learnedEntries: (settings.learnedEntries || []).map((entry) => ({ ...entry })),
      settings: {
        asrEndpoint: settings.asrEndpoint,
        asrModel: settings.asrModel,
        textEndpoint: settings.textEndpoint,
        textModel: settings.textModel,
        textFastModel: settings.textFastModel,
        textFallbackModels: settings.textFallbackModels,
        textTimeoutMs: settings.textTimeoutMs,
        textAuthMode: settings.textAuthMode,
        textStreaming: settings.textStreaming !== false,
        textIncremental: settings.textIncremental === true,
        autoPaste: settings.autoPaste,
        autoLearn: settings.autoLearn,
        autoIntent: settings.autoIntent,
        keepHistoryAudio: settings.keepHistoryAudio,
        skillDelivery: settings.skillDelivery || "paste",
      },
      startedAt: clock(),
      activeTextIds: new Set(),
      textStats: { requestCount: 0, models: [], firstTokenMs: null },
    };
  };

  /** 开始一条新任务：占用 requestId，随后所有异步步骤都比对它。 */
  const begin = (options) => {
    const requestId = nextRequestId();
    currentId = requestId;
    activeSnapshot = makeSnapshot(requestId, options);
    startLease(activeSnapshot);
    return activeSnapshot;
  };

  /** 使当前任务失效：之后任何迟到的结果都不会落地。 */
  const cancel = ({ preserveAudio = false } = {}) => {
    if (preserveAudio) cancelPreview();
    const requestId = currentId;
    if (requestId) {
      for (const id of activeSnapshot?.activeTextIds || []) void invoke("cancel_text_request", { requestId: id }, () => Promise.resolve()).catch(() => {});
      cancelled.add(requestId);
      // 原生投递有独立线程；必须把取消送到 Rust，在 Ctrl+V 前再次检查。
      void invoke("cancel_paste", { sessionId: requestId }, () => Promise.resolve()).catch(() => {});
      if (!preserveAudio) void invoke("cancel_audio_session", { sessionId: requestId }, () => Promise.resolve()).catch(() => {});
      void invoke("cancel_text_request", { requestId }, () => Promise.resolve()).catch(() => {});
    }
    endTask(activeSnapshot);
    currentId = null;
    activeSnapshot = null;
    // 只保留最近一批 id，避免长时间运行后集合无限增长。
    if (cancelled.size > 64) cancelled = new Set(Array.from(cancelled).slice(-32));
  };

  const current = () => currentId;

  /** 是否具备调用文字服务的条件。缺地址或模型时直接判为不可用，走本地路径。 */
  const textReady = (settings) => Boolean(settings.textEndpoint && settings.textModel);

  function markStopped(snapshot) {
    if (guard(snapshot)) snapshot.stoppedAt ??= clock();
  }

  function acceptTextStream(payload) {
    const call = streamCalls.get(payload.callId);
    if (!call || !guard(call.snapshot) || payload.requestId !== call.snapshot.requestId) return false;
    call.snapshot.textStats.firstTokenMs ??= elapsedSince(call.started);
    if (call.task === "ask") return true;
    const text = [call.prefix, payload.text].filter(Boolean).join("\n\n");
    onEvent({ type: "text-preview", requestId: payload.requestId, text });
    return true;
  }

  function acceptTranscript({ sessionId, text }) {
    const snapshot = activeSnapshot;
    if (!snapshot || sessionId !== snapshot.requestId || !guard(snapshot)
      || snapshot.intent !== "dictation" || snapshot.processingMode !== "smart"
      || snapshot.settings.autoIntent || !snapshot.settings.textIncremental || !textReady(snapshot.settings)) return false;
    text = String(text || "").trim();
    const state = snapshot.incremental ||= { rawPrefix: "", correctedPrefix: "", segments: [], queue: Promise.resolve(), closed: false };
    if (state.closed || state.invalid || state.failed || parseOutputLanguage(text)) return false;
    if (!text.startsWith(state.rawPrefix)) {
      state.invalid = true;
      for (const id of snapshot.activeTextIds) void invoke("cancel_text_request", { requestId: id }, () => Promise.resolve()).catch(() => {});
      return false;
    }
    const prefix = stablePrefix(text);
    const addition = prefix.slice(state.rawPrefix.length);
    if (effectiveTextLength(addition) < 300) return false;
    for (const raw of splitText(addition, 6000)) {
      const corrected = applyVocabulary(applyLearnedVocabulary(raw, snapshot.learnedEntries, snapshot.vocabulary), snapshot.vocabulary);
      const segment = { raw: corrected, text: "" };
      const context = state.correctedPrefix;
      state.rawPrefix += raw;
      state.correctedPrefix += corrected;
      state.segments.push(segment);
      state.queue = state.queue.then(async () => {
        if (!guard(snapshot) || state.invalid || state.failed) return;
        try {
          const response = await callProcessText(snapshot, { task: "smart", rawText: corrected,
            instruction: SMART_INSTRUCTION + "\n只整理当前段，不复述参考前文，不增加总结或过渡句。",
            outputFormat: "plain", context, prefix: state.segments.filter((s) => s.text).map((s) => s.text).join("\n\n"),
            budget: state.finishBudget || newBudget(snapshot) });
          if (!guard(snapshot) || state.invalid) return;
          segment.text = String(response.text).trim();
          onEvent({ type: "text-preview", requestId: snapshot.requestId, text: state.segments.filter((s) => s.text).map((s) => s.text).join("\n\n") });
        } catch { state.failed = true; }
      });
    }
    return true;
  }

  async function callTranscribe(snapshot, audio) {
    if (audio.nativeSessionId) {
      if (audio.deviceError) throw new Error(audio.deviceError);
      if (audio.transcriptionError) throw new Error(audio.transcriptionError);
      if (audio.transcript !== null && audio.transcript !== undefined) {
        return { text: audio.transcript, durationMs: audio.asrMs || 0 };
      }
      return invoke("transcribe_native_audio", {
        request: {
          sessionId: audio.nativeSessionId,
          requestId: snapshot.requestId,
          endpoint: snapshot.settings.asrEndpoint,
          model: snapshot.settings.asrModel,
        },
      });
    }
    return invoke(
      "transcribe_audio",
      {
        request: {
          audioBase64: audio.audioBase64,
          filename: audio.filename,
          endpoint: snapshot.settings.asrEndpoint,
          model: snapshot.settings.asrModel,
        },
      },
      // 浏览器预览没有桌面后端，给一段固定文本以便走通界面流程。
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ text: "这是一段用于前端预览的语音识别结果。", durationMs: 438 }), 850),
        ),
    );
  }

  async function callProcessText(snapshot, { task, rawText, instruction, outputFormat, skillId, template, context = "", prefix = "", budget = stageBudget(snapshot) }) {
    const messages = buildMessages({ ...template, instruction, outputFormat, rawText, task });
    if (context) messages[1].content = `前文仅作衔接参考，不得复述或增加当前段没有的事实：\n<<<CONTEXT>>>\n${referenceTail(context)}\n<<<END CONTEXT>>>\n\n${messages[1].content}`;
    const fast = ["intent", "translate", "smart"].includes(task) ? snapshot.settings.textFastModel : "";
    const fallback = String(snapshot.settings.textFallbackModels || "").split(/[\n,，]/).map((name) => name.trim()).filter(Boolean).slice(0, 5);
    const configured = [...new Set([fast, snapshot.settings.textModel, ...fallback].filter(Boolean))];
    const available = configured.filter((model) => (quotaCooldown.get(model) || 0) <= Date.now());
    const models = available.length ? available : configured.slice(0, 1);
    let lastError;
    for (const [index, model] of models.entries()) {
      if (remaining(budget) <= 0) throw new Error("文字处理总预算已耗尽");
      if (!live(snapshot)) throw new Error("文字请求已取消");
      const timeoutMs = Math.max(1, Math.floor(remaining(budget) / (models.length - index)));
      const callId = `${snapshot.requestId}:text-${++callSequence}`;
      let timer;
      try {
        snapshot.textStats.requestCount += 1;
        snapshot.textStats.models.push(model);
        snapshot.activeTextIds.add(callId);
        const desktop = typeof window !== "undefined" && window.__TAURI_INTERNALS__;
        const streaming = desktop && snapshot.settings.textStreaming && ["smart", "skill", "translate", "command"].includes(task);
        const command = desktop && task === "ask" ? "stream_answer" : streaming ? "stream_text" : "process_text";
        streamCalls.set(callId, { snapshot, prefix, task, started: clock() });
        const result = await Promise.race([invoke(command, {
          request: {
            requestId: callId, sessionId: snapshot.requestId, task, rawText, skillId: skillId || null,
            endpoint: snapshot.settings.textEndpoint, model,
            timeoutMs, authMode: snapshot.settings.textAuthMode,
            messages,
          },
        }, () => new Promise((resolve) => setTimeout(() => resolve({ text: rawText, durationMs: 10 }), 600))),
        new Promise((_, reject) => { timer = setTimeout(() => {
          void invoke("cancel_text_request", { requestId: callId }, () => Promise.resolve()).catch(() => {});
          reject(new Error("文字模型响应超时"));
        }, timeoutMs); })]);
        if (remaining(budget) <= 0) throw new Error("文字处理总预算已耗尽");
        if (!String(result.text || "").trim()) throw new Error("文字模型没有返回内容");
        return result;
      } catch (error) {
        lastError = error;
        const message = String(error?.message || error);
        if (/额度用尽/.test(message)) quotaCooldown.set(model, Date.now() + 20 * 60 * 60 * 1000);
        const transient = /超时|无法连接|请求失败|额度用尽|HTTP (429|500|502|503|504)/i.test(message);
        if (!transient || index === models.length - 1 || !guard(snapshot)) throw error;
      } finally {
        clearTimeout(timer);
        snapshot.activeTextIds.delete(callId);
        streamCalls.delete(callId);
      }
    }
    throw lastError || new Error("尚未配置文字服务");
  }

  /** 调用文字模型，并把「原文」作为失败时的兜底一起返回，绝不让调用方丢掉原文。 */
  async function runTextStage(snapshot, request) {
    const started = clock();
    try {
      const budget = stageBudget(snapshot);
      if (request.rawText.length > MAX_TEXT_CHARS && !["smart", "translate"].includes(request.task)) throw new Error("这项任务需要完整上下文，文本超过单次处理上限；原文已保留，请分段运行");
      const state = snapshot.incremental;
      let reused = [];
      if (state) state.closed = true;
      if (request.task === "smart" && state && !state.invalid && request.rawText.startsWith(state.correctedPrefix)) {
        state.closed = true;
        state.finishBudget = budget;
        await Promise.race([state.queue, new Promise((resolve) => { const timer = setTimeout(resolve, remaining(budget)); state.waitTimer = timer; })]);
        clearTimeout(state.waitTimer);
        if (remaining(budget) <= 0) {
          state.invalid = true;
          for (const id of snapshot.activeTextIds) void invoke("cancel_text_request", { requestId: id }, () => Promise.resolve()).catch(() => {});
          throw new Error("文字处理总预算已耗尽");
        }
        if (state.segments.every((s) => s.text)) reused = state.segments;
      } else if (state) {
        state.invalid = true;
        for (const id of snapshot.activeTextIds) void invoke("cancel_text_request", { requestId: id }, () => Promise.resolve()).catch(() => {});
      }
      snapshot.textStats.reusedSegments = reused.length;
      const rest = request.rawText.slice(reused.map((s) => s.raw).join("").length);
      const chunks = splitText(rest);
      const texts = reused.map((s) => s.text);
      let context = reused.map((s) => s.raw).join("");
      for (const chunk of chunks) {
        const segmented = chunks.length > 1 || reused.length > 0;
        const response = await callProcessText(snapshot, { ...request, rawText: chunk, budget,
          instruction: request.instruction + (segmented ? "\n本次是全文的一段，只输出当前段的整理结果，不复述参考前文，不增加总结或过渡句。" : ""),
          context: segmented ? context : "", prefix: texts.join("\n\n") });
        texts.push(String(response.text || "").trim());
        context += chunk;
      }
      return { ok: true, text: texts.join("\n\n"), textMs: elapsedSince(started) };
    } catch (error) {
      return {
        ok: false,
        text: "",
        textMs: elapsedSince(started),
        error: String(error && error.message ? error.message : error),
      };
    }
  }

  /**
   * 可选的分流：让文字模型判断这次口述是普通输入还是命令。
   * 任何不确定（超时、解析失败、置信度不足）都退回普通口述——
   * 误把普通输入当命令会让用户丢字，误把命令当普通输入只是没生成，代价小得多。
   */
  async function classifyIntent(snapshot, rawText) {
    if (!textReady(snapshot.settings)) return "dictation";
    const started = clock();
    try {
      const response = await callProcessText(snapshot, {
        task: "intent",
        rawText: splitText(rawText)[0],
        instruction:
          '判断下面这段口述的意图。只输出一行 JSON，不要任何解释或代码块标记，格式为 {"intent":"dictation"或"command","confidence":0到1的小数}。' +
          "dictation 表示用户想直接把这段话输入到光标处；command 表示用户在要求你生成内容（例如让它写一封邮件、列一个提纲、改写一段话）。",
        outputFormat: "plain",
      });
      if (!guard(snapshot)) return null;
      const match = String(response.text || "").match(/\{[\s\S]*\}/);
      if (!match) return "dictation";
      const parsed = JSON.parse(match[0]);
      const confidence = Number(parsed.confidence);
      if (parsed.intent === "command" && Number.isFinite(confidence) && confidence >= AUTO_COMMAND_CONFIDENCE) {
        return "command";
      }
      return "dictation";
    } catch (error) {
      // 分流失败不打扰用户，静默按普通口述继续。
      void error;
      return "dictation";
    } finally {
      snapshot.classifyMs = elapsedSince(started);
    }
  }

  /**
   * 走完一条完整任务：ASR → 本地处理 → 可选文字整理 → 上屏。
   *
   * audio 为 null 表示录音阶段就失败了；此时只上报错误，不产生任何副作用。
   * 无论成功、失败还是取消，结束后都释放 requestId（见 release 的说明）。
   */
  async function complete(args) {
    args.snapshot.stoppedAt ??= clock();
    try {
      if (!await prepare(args.snapshot)) return { ok: false, stage: "cancelled", stale: true };
      const result = await runTask(args);
      if ((result.ok || ["paste", "copy"].includes(result.stage)) && args.audio?.nativeSessionId) {
        if (args.snapshot.settings.keepHistoryAudio || args.snapshot.preserveAudio) {
          await invoke("retain_native_audio", { sessionId: args.audio.nativeSessionId }, () => Promise.resolve()).catch((error) => {
            onEvent({ type: "retention-warning", requestId: args.snapshot.requestId, message: String(error?.message || error) });
          });
        } else if (result.ok) {
          await invoke("release_native_audio", { sessionId: args.audio.nativeSessionId, taskId: args.snapshot.requestId }, () => Promise.resolve()).catch(() => {});
        }
      }
      return result;
    } finally {
      endTask(args.snapshot);
      for (const id of args.snapshot.activeTextIds) void invoke("cancel_text_request", { requestId: id }, () => Promise.resolve()).catch(() => {});
      release(args.snapshot.requestId);
    }
  }

  async function runTask({ snapshot, audio, audioError }) {
    const result = { requestId: snapshot.requestId, intent: snapshot.intent };
    if (audioError || !audio) {
      if (guard(snapshot)) {
        onEvent({ type: "error", requestId: snapshot.requestId, stage: "record", message: audioError || "没有采集到音频" });
      }
      return { ok: false, stage: "record" };
    }
    snapshot.nativeAudioSessionId = audio.nativeSessionId || null;

    const asrStarted = clock();
    let asr;
    try {
      asr = await callTranscribe(snapshot, audio);
    } catch (error) {
      if (guard(snapshot)) {
        onEvent({
          type: "error",
          requestId: snapshot.requestId,
          stage: "asr",
          message: String(error && error.message ? error.message : error),
          errorKind: classifyAsrError(error),
          audioSessionId: audio.nativeSessionId || null,
          audioMs: audio.audioMs || 0,
          intent: snapshot.intent,
          skillId: snapshot.skill?.id,
          skillDelivery: snapshot.settings.skillDelivery,
          windowContext: snapshot.windowContext,
        });
      }
      return { ok: false, stage: "asr" };
    }
    // ASR 返回时任务可能已经被取消或已被新任务取代。
    if (!guard(snapshot)) return { ok: false, stage: "cancelled", stale: true };

    const asrMs = Number(asr.durationMs) || elapsedSince(asrStarted);
    const rawText = String(asr.text || "").trim();
    const timings = { encodeMs: audio.encodeMs || 0, asrMs, stopToAsrMs: elapsedSince(snapshot.stoppedAt), classifyMs: 0, textMs: 0, pasteMs: 0, audioMs: audio.audioMs, inputChars: rawText.length };
    if (!rawText) {
      onEvent({ type: "error", requestId: snapshot.requestId, stage: "asr", message: "识别结果为空，请再说一次" });
      return { ok: false, stage: "asr" };
    }

    let intent = snapshot.intent;
    let sourceText = rawText;
    if (intent === "dictation") {
      const languageCommand = parseOutputLanguage(rawText);
      if (languageCommand) {
        intent = "translate";
        sourceText = languageCommand.body;
        snapshot.translationLanguage = languageCommand.language;
      }
    }
    if (intent === "dictation" && snapshot.settings.autoIntent && textReady(snapshot.settings)) {
      onEvent({ type: "state", requestId: snapshot.requestId, state: "processing", phase: "classify" });
      const classified = await classifyIntent(snapshot, rawText);
      if (classified === null) return { ok: false, stage: "cancelled", stale: true };
      intent = classified;
      timings.classifyMs = snapshot.classifyMs || 0;
    }

    // 命令模式下不做词典替换，避免把用户的指令词改掉。
    const corrected = intent === "command" ? sourceText : applyVocabulary(applyLearnedVocabulary(sourceText, snapshot.learnedEntries, snapshot.vocabulary), snapshot.vocabulary);

    return finishTask(snapshot, { intent, corrected, timings });
  }

  /**
   * 文字整理与上屏。首次任务与「重试」共用这一段，
   * 保证两条路径对失败、取消、上屏的判定完全一致。
   */
  async function finishTask(snapshot, { intent, corrected, timings }) {
    if (intent !== "dictation" || snapshot.processingMode !== "smart") {
      if (snapshot.incremental) { snapshot.incremental.closed = true; snapshot.incremental.invalid = true; }
      for (const id of snapshot.activeTextIds) void invoke("cancel_text_request", { requestId: id }, () => Promise.resolve()).catch(() => {});
    }
    let finalText = corrected;
    let textFailure = null;
    let usedTextService = false;

    if (intent === "ask" || intent === "translate" || intent === "command") {
      usedTextService = true;
      if (!textReady(snapshot.settings)) {
        textFailure = "尚未配置文字服务，请先填写地址和模型名称";
      } else {
        onEvent({ type: "state", requestId: snapshot.requestId, state: "processing", phase: "text" });
        const stage = await runTextStage(snapshot, {
          task: intent,
          rawText: corrected,
          instruction: intent === "ask" ? ASK_INSTRUCTION : intent === "translate" ? translationInstruction(snapshot.translationLanguage) : COMMAND_INSTRUCTION,
          outputFormat: "plain",
        });
        if (!guard(snapshot)) return { ok: false, stage: "cancelled", stale: true };
        timings.textMs = stage.textMs;
        if (stage.ok && stage.text) finalText = stage.text;
        else textFailure = stage.error || "文字模型没有返回内容";
      }
    } else if (intent === "skill" || snapshot.processingMode === "skill" || (snapshot.processingMode === "smart" && effectiveTextLength(corrected) > SMART_DIRECT_OUTPUT_MAX_LENGTH)) {
      const skill = intent === "skill" || snapshot.processingMode === "skill" ? snapshot.skill : null;
      const modeReady = textReady(snapshot.settings);
      const skillReady = (intent !== "skill" && snapshot.processingMode !== "skill") || Boolean(skill);
      if (modeReady && skillReady) {
        usedTextService = true;
        onEvent({ type: "state", requestId: snapshot.requestId, state: "processing", phase: "text" });
        const stage = await runTextStage(snapshot, {
          task: skill ? "skill" : "smart",
          rawText: corrected,
          instruction: skill ? skill.instruction : SMART_INSTRUCTION,
          outputFormat: skill ? skill.outputFormat : "plain",
          skillId: skill ? skill.id : undefined,
          template: skill,
        });
        if (!guard(snapshot)) return { ok: false, stage: "cancelled", stale: true };
        timings.textMs = stage.textMs;
        if (stage.ok && stage.text) finalText = stage.text;
        else textFailure = stage.error || "文字模型没有返回内容";
      } else {
        // 没配文字服务或 Skill 已失效：退回原文，并明确告知，不静默改变用户预期。
        textFailure = modeReady ? "所选模板已不可用，请重新选择" : "尚未配置文字服务，已按原文处理";
        finalText = corrected;
      }
    } else if (snapshot.processingMode === "smart" && effectiveTextLength(corrected) <= SMART_DIRECT_OUTPUT_MAX_LENGTH) {
      // Typefree 短句路径：无需文字请求；去掉 ASR 附加的末尾句号。
      finalText = stripShortTrailingFullStop(corrected);
    } else if (snapshot.processingMode === "clean") {
      finalText = lightlyCleanText(corrected);
    }

    // 普通口述整理失败时自动回退识别原文，同时把原因写入完成事件和历史。
    // 提问、翻译、命令及明确运行的技能仍交给用户重试，避免输入指令句。
    if (textFailure && intent === "dictation") finalText = corrected;
    else if (textFailure) {
      onEvent({
        type: "text-failed",
        requestId: snapshot.requestId,
        message: textFailure,
        intent,
        skillId: snapshot.skill?.id,
        skillDelivery: snapshot.settings.skillDelivery,
        translationLanguage: snapshot.translationLanguage,
        rawText: corrected,
        finalText: intent === "command" || intent === "ask" ? "" : finalText,
        timings,
        usedTextService,
        windowContext: snapshot.windowContext,
        audioSessionId: snapshot.settings.keepHistoryAudio || snapshot.preserveAudio ? snapshot.nativeAudioSessionId : null,
      });
      return { ok: false, stage: "text", intent, rawText: corrected, timings };
    }

    if (intent === "ask") {
      if (!guard(snapshot)) return { ok: false, stage: "cancelled", stale: true };
      timings.stopToReadyMs = elapsedSince(snapshot.stoppedAt ?? snapshot.startedAt);
      timings.textRequests = snapshot.textStats.requestCount;
      timings.textModels = [...snapshot.textStats.models];
      timings.textFirstTokenMs = snapshot.textStats.firstTokenMs;
      timings.outputChars = finalText.length;
      onEvent({
        type: "answer",
        requestId: snapshot.requestId,
        intent,
        question: corrected,
        text: finalText,
        timings,
        windowContext: snapshot.windowContext,
        audioSessionId: snapshot.settings.keepHistoryAudio || snapshot.preserveAudio ? snapshot.nativeAudioSessionId : null,
      });
      return { ok: true, text: finalText, intent, timings, pasted: false };
    }

    // 用户词库需作用于口述类最终成稿，防止模型再次改回错误术语。
    // 语音命令生成的内容不是用户口述，不应用个人词库。
    if (intent !== "command") {
      finalText = applyVocabulary(applyLearnedVocabulary(finalText, snapshot.learnedEntries, snapshot.vocabulary), snapshot.vocabulary);
    }
    if (intent === "skill" && snapshot.settings.skillDelivery === "card") {
      if (!guard(snapshot)) return { ok: false, stage: "cancelled", stale: true };
      onEvent({ type: "answer", requestId: snapshot.requestId, intent, skillId: snapshot.skill?.id, title: snapshot.skill?.name || "整理结果",
        question: corrected, text: finalText, timings, windowContext: snapshot.windowContext,
        audioSessionId: snapshot.settings.keepHistoryAudio || snapshot.preserveAudio ? snapshot.nativeAudioSessionId : null });
      return { ok: true, text: finalText, intent, timings, pasted: false };
    }
    return deliver(snapshot, { intent, finalText, rawText: corrected, timings, usedTextService, warning: textFailure });
  }

  /**
   * 上屏并上报完成。**整个应用只有这里调用 paste_text**，
   * 原文、整理结果、命令结果与显式输入共用投递/取消判定；
   * 重试和保留原文使用 copyOnly，不自动写入设置窗口。
   */
  async function deliver(snapshot, { intent, finalText, rawText, timings, usedTextService, insertedRaw = false, warning = null }) {
    if (!guard(snapshot)) return { ok: false, stage: "cancelled", stale: true };
    if (snapshot.capturePending && !await snapshot.capturePending) return { ok: false, stage: "cancelled", stale: true };
    if (!guard(snapshot)) return { ok: false, stage: "cancelled", stale: true };

    timings.stopToReadyMs = elapsedSince(snapshot.stoppedAt ?? snapshot.startedAt);
    timings.textRequests = snapshot.textStats.requestCount;
    timings.textModels = [...snapshot.textStats.models];
    timings.textFirstTokenMs = snapshot.textStats.firstTokenMs;
    timings.reusedSegments = snapshot.textStats.reusedSegments || 0;
    timings.outputChars = finalText.length;
    const pasteStarted = clock();
    let delivery;
    let pasteError = null;
    if (snapshot.settings.autoPaste && !snapshot.copyOnly && finalText) {
      try {
        delivery = normalizeDelivery(await invoke("paste_text", { text: finalText, learn: intent === "dictation" && snapshot.settings.autoLearn !== false, sessionId: snapshot.requestId }, async () => {
          await navigator.clipboard.writeText(finalText);
          return { status: "copied", copied: true, message: "浏览器预览已复制，可以粘贴" };
        }));
      } catch (error) {
        if (!guard(snapshot)) return { ok: false, stage: "cancelled", stale: true };
        delivery = await copyResult(invoke, finalText, snapshot.requestId);
        pasteError = `自动输入失败；${delivery.message}：${String(error?.message || error)}`;
      }
    } else {
      delivery = await copyResult(invoke, finalText, snapshot.requestId);
    }
    if (snapshot.inputCapture) {
      delivery.capture = snapshot.inputCapture;
      if (delivery.status === "copied" && !delivery.reason && !["ready", "compatibility"].includes(snapshot.inputCapture.reason)) {
        delivery.reason = snapshot.inputCapture.reason;
        delivery.message = `${snapshot.inputCapture.message || "输入位置检查失败"}，正文已复制，可以粘贴`;
      }
      timings.captureMs = snapshot.inputCapture.elapsedMs;
    }
    const pasted = delivery.pasted;
    timings.pasteMs = elapsedSince(pasteStarted);
    // 上屏是最后一步，之后再检查一次：取消发生在粘贴途中时不再上报完成状态。
    if (!guard(snapshot)) {
      // Once the OS has accepted a clipboard/input effect it cannot be undone.
      // Keep that result recoverable without changing a newer task's UI state.
      if (delivery.copied || delivery.pasted) {
        onEvent({ type: "archived-result", requestId: snapshot.requestId, intent, text: finalText,
          rawText, delivery, timings, windowContext: snapshot.windowContext });
      }
      return { ok: false, stage: "cancelled", stale: true };
    }

    timings.stopToDeliveredMs = elapsedSince(snapshot.stoppedAt ?? snapshot.startedAt);
    onEvent({
      type: pasteError ? "paste-failed" : "done",
      requestId: snapshot.requestId,
      intent,
      text: finalText,
      rawText,
      pasted,
      delivery,
      timings,
      usedTextService,
      audioSessionId: snapshot.settings.keepHistoryAudio || snapshot.preserveAudio ? snapshot.nativeAudioSessionId : null,
      insertedRaw,
      warning,
      message: pasteError,
      windowContext: snapshot.windowContext,
    });
    if (pasteError) return { ok: false, stage: "paste", text: finalText, intent, timings, pasted, delivery, message: pasteError };
    return { ok: delivery.status !== "retained", stage: delivery.status === "retained" ? "copy" : undefined, text: finalText, intent, timings, pasted, delivery };
  }

  /**
   * 重试：沿用上一条失败任务的原文与意图，重新走一遍文字整理与上屏。
   *
   * 刻意不重跑 ASR：用户点「重试」通常是因为文字服务抖了一下或刚补上配置，
   * 让他再说一遍明显更糟。原文已经是词典替换之后的结果，这里不再重复替换。
   * 配置用当下的（而不是当时那份快照），这样「刚填好地址就点重试」能直接生效。
   * 意图沿用原值：失败时若判定是命令，重试仍然是命令，绝不会转成普通上屏。
   */
  async function retry({ intent, rawText, settings, customSkills = [], audioMs = 0, windowContext = null, translationLanguage = "英文", skillId = "", skillDelivery }) {
    const snapshot = begin({ intent, skillId, settings: { ...settings, skillDelivery: skillDelivery || settings.skillDelivery }, customSkills, windowContext });
    snapshot.copyOnly = true;
    snapshot.translationLanguage = translationLanguage;
    try {
      if (!await prepare(snapshot)) return { ok: false, stale: true };
      if (snapshot.intent !== "ask") await captureTarget(snapshot);
      return await finishTask(snapshot, {
        intent: snapshot.intent,
        corrected: String(rawText || ""),
        timings: { encodeMs: 0, asrMs: 0, textMs: 0, pasteMs: 0, audioMs },
      });
    } finally {
      release(snapshot.requestId);
    }
  }

  async function retryAudio({ audioSessionId, intent, settings, customSkills = [], audioMs = 0, windowContext = null, preserveAudio = false, skillId = "", skillDelivery }) {
    const snapshot = begin({ intent, skillId, settings: { ...settings, skillDelivery: skillDelivery || settings.skillDelivery }, customSkills, windowContext });
    snapshot.copyOnly = true;
    snapshot.preserveAudio = preserveAudio;
    try {
      if (!await prepare(snapshot)) return { ok: false, stale: true };
      if (snapshot.intent !== "ask") await captureTarget(snapshot);
      return await complete({ snapshot, audio: { nativeSessionId: audioSessionId, audioMs, encodeMs: 0 } });
    } finally { release(snapshot.requestId); }
  }

  /**
   * 「保留原文」：文字整理失败后保留并复制 ASR 原文。
   *
   * 使用 copyOnly，不会向设置窗口发送粘贴。
   *
   * 命令模式一律拒绝：这里的「原文」是「帮我写封邮件」这样的指令，
   * 而当初失败的原因正是没能把它变成正文，直接回退上屏等于把指令打进别人的文档。
   */
  async function insertRaw({ intent, rawText, settings, customSkills = [], audioMs = 0, windowContext = null }) {
    if (intent === "command" || intent === "ask") {
      return { ok: false, stage: intent, message: "提问或语音指令未完成，原文不会自动输入" };
    }
    const text = String(rawText || "");
    const snapshot = begin({ intent: "dictation", settings, customSkills, windowContext });
    snapshot.copyOnly = true;
    try {
      if (!await prepare(snapshot)) return { ok: false, stale: true };
      await captureTarget(snapshot);
      return await deliver(snapshot, {
        intent: "dictation",
        finalText: text,
        rawText: text,
        timings: { encodeMs: 0, asrMs: 0, textMs: 0, pasteMs: 0, audioMs },
        usedTextService: false,
        insertedRaw: true,
      });
    } finally {
      release(snapshot.requestId);
    }
  }

  /**
   * 预览：只把文本整理结果返回给调用方，绝不写历史、绝不粘贴。
   *
   * 预览刻意不占用 currentId：它是界面上的旁路操作，如果占号，用户在录音处理中
   * 点一下预览就会把那条正在飞的任务判成过期——用户看到的现象是「转写无缘无故丢了」。
   * 连点预览时用 previewId 让上一次预览作废，效果与 requestId 一致。
   */
  async function preview({ settings, skill, rawText, sample = false }) {
    cancelPreview();
    previewId = `preview-${nextRequestId()}`;
    const snapshot = makeSnapshot(previewId, { intent: "dictation", settings });
    skill = cloneSkill(skill);
    const stillWanted = () => previewId === snapshot.requestId;

    const corrected = applyVocabulary(rawText.trim(), snapshot.vocabulary);
    const trimmed = corrected;
    if (!textReady(settings)) {
      return { ok: false, error: "尚未配置文字服务（地址与模型名称都要填）" };
    }
    if (!skill) return { ok: false, error: "请先选择要试用的模板" };
    if (sample) {
      // 样例预览不发请求：只确认 Skill 能被装配成合法请求，供编辑时快速自检。
      const messages = buildMessages({ ...skill, rawText: trimmed || "（示例文本）", task: "preview" });
      return { ok: true, sample: true, messages };
    }
    previewSnapshot = snapshot;
    startLease(snapshot);
    try {
      if (!await prepare(snapshot)) return { ok: false, stale: true };
      const stage = await runTextStage(snapshot, {
        task: "preview",
        rawText: trimmed,
        instruction: skill.instruction,
        outputFormat: skill.outputFormat,
        skillId: skill.id,
        template: skill,
      });
      if (!stillWanted()) return { ok: false, stale: true };
      if (!stage.ok) return { ok: false, error: stage.error };
      return { ok: true, text: stage.text, textMs: stage.textMs };
    } catch (error) { return { ok: false, error: String(error?.message || error) }; }
    finally {
      endTask(snapshot);
      if (previewSnapshot === snapshot) { previewSnapshot = null; previewId = null; }
    }
  }

  async function insertResult({ text, settings }) {
    const snapshot = begin({ intent: "dictation", settings: { ...settings, autoPaste: true, autoLearn: false } });
    try {
      if (!await prepare(snapshot)) return { ok: false, stale: true };
      await captureTarget(snapshot);
      return await deliver(snapshot, { intent: "dictation", finalText: text, rawText: text,
        timings: { encodeMs: 0, asrMs: 0, textMs: 0, audioMs: 0 }, usedTextService: false });
    } finally { release(snapshot.requestId); }
  }

  return { begin, cancel, current, isCurrent, prepare, captureTarget, markStopped, acceptTranscript, acceptTextStream, complete, retry, retryAudio, insertRaw, insertResult, preview, textReady, builtinSkills: BUILTIN_SKILLS };
}
