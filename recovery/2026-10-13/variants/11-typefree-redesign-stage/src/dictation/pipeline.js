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

export const INTENTS = ["dictation", "command", "ask", "translate", "skill"];

/** 命令识别的最低置信度：低于它一律按普通口述处理，避免误拦用户的正常输入。 */
export const AUTO_COMMAND_CONFIDENCE = 0.85;

export function classifyAsrError(error) {
  const message = String(error?.message || error || "");
  if (/HTTP (401|403)\b|API Key|凭据库|认证|权限/i.test(message)) return "auth";
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
const MAX_TEXT_CHARS = 12000;

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

export function createPipeline({ invoke, onEvent = () => {} }) {
  let counter = 0;
  let currentId = null;
  /** 预览不占当前任务序号，用自己的一个 id：否则预览会把飞行中的录音任务判成过期。 */
  let previewId = null;
  let cancelled = new Set();
  const quotaCooldown = new Map();

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
    if (currentId === requestId) currentId = null;
  };

  /** 把当前配置固化成快照。录音期间用户改模式、改词典、改 Skill 都不影响这一条任务。 */
  const makeSnapshot = (requestId, { intent, settings, customSkills = [], windowContext = null, skillId = "" }) => {
    const selectedSkill = mergeSkill(skillId || (intent === "skill" ? settings.actionSkillId : settings.selectedSkillId), customSkills);
    return {
      requestId,
      intent: INTENTS.includes(intent) ? intent : "dictation",
      processingMode: settings.processingMode,
      selectedSkillId: selectedSkill ? selectedSkill.id : "",
      translationLanguage: settings.defaultTranslationLanguage || "英文",
      skill: selectedSkill,
      windowContext,
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
        autoPaste: settings.autoPaste,
        autoLearn: settings.autoLearn,
        autoIntent: settings.autoIntent,
        keepHistoryAudio: settings.keepHistoryAudio,
        skillDelivery: settings.skillDelivery || "paste",
      },
      startedAt: now(),
    };
  };

  /** 开始一条新任务：占用 requestId，随后所有异步步骤都比对它。 */
  const begin = (options) => {
    const requestId = nextRequestId();
    currentId = requestId;
    return makeSnapshot(requestId, options);
  };

  /** 使当前任务失效：之后任何迟到的结果都不会落地。 */
  const cancel = () => {
    const requestId = currentId;
    if (requestId) {
      cancelled.add(requestId);
      // 原生投递有独立线程；必须把取消送到 Rust，在 Ctrl+V 前再次检查。
      void invoke("cancel_paste", { sessionId: requestId }, () => Promise.resolve()).catch(() => {});
      void invoke("cancel_audio_session", { sessionId: requestId }, () => Promise.resolve()).catch(() => {});
      void invoke("cancel_text_request", { requestId }, () => Promise.resolve()).catch(() => {});
    }
    currentId = null;
    // 只保留最近一批 id，避免长时间运行后集合无限增长。
    if (cancelled.size > 64) cancelled = new Set(Array.from(cancelled).slice(-32));
  };

  const current = () => currentId;

  /** 是否具备调用文字服务的条件。缺地址或模型时直接判为不可用，走本地路径。 */
  const textReady = (settings) => Boolean(settings.textEndpoint && settings.textModel);

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

  async function callProcessText(snapshot, { task, rawText, instruction, outputFormat, skillId }) {
    const messages = buildMessages({ instruction, outputFormat, rawText, task });
    const fast = ["intent", "translate"].includes(task) ? snapshot.settings.textFastModel : "";
    const fallback = String(snapshot.settings.textFallbackModels || "").split(/[\n,，]/).map((name) => name.trim()).filter(Boolean).slice(0, 5);
    const configured = [...new Set([fast, snapshot.settings.textModel, ...fallback].filter(Boolean))];
    const available = configured.filter((model) => (quotaCooldown.get(model) || 0) <= Date.now());
    const models = available.length ? available : configured.slice(0, 1);
    let lastError;
    for (const [index, model] of models.entries()) {
      try {
        return await invoke(task === "ask" && typeof window !== "undefined" && window.__TAURI_INTERNALS__ ? "stream_answer" : "process_text", {
          request: {
            requestId: snapshot.requestId, task, rawText, skillId: skillId || null,
            endpoint: snapshot.settings.textEndpoint, model,
            timeoutMs: snapshot.settings.textTimeoutMs, authMode: snapshot.settings.textAuthMode,
            messages,
          },
        }, () => new Promise((resolve) => setTimeout(() => resolve({ text: rawText, durationMs: 10 }), 600)));
      } catch (error) {
        lastError = error;
        const message = String(error?.message || error);
        if (/额度用尽/.test(message)) quotaCooldown.set(model, Date.now() + 20 * 60 * 60 * 1000);
        const transient = /超时|无法连接|请求失败|额度用尽|HTTP (429|500|502|503|504)/i.test(message);
        if (!transient || index === models.length - 1 || !guard(snapshot)) throw error;
      }
    }
    throw lastError || new Error("尚未配置文字模型");
  }

  /** 调用文字模型，并把「原文」作为失败时的兜底一起返回，绝不让调用方丢掉原文。 */
  async function runTextStage(snapshot, request) {
    const started = now();
    const trimmed = request.rawText.slice(0, MAX_TEXT_CHARS);
    try {
      const response = await callProcessText(snapshot, { ...request, rawText: trimmed });
      return { ok: true, text: String(response.text || "").trim(), textMs: elapsedSince(started) };
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
    const started = now();
    try {
      const response = await callProcessText(snapshot, {
        task: "intent",
        rawText: rawText.slice(0, MAX_TEXT_CHARS),
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
      void started;
      return "dictation";
    }
  }

  /**
   * 走完一条完整任务：ASR → 本地处理 → 可选文字整理 → 上屏。
   *
   * audio 为 null 表示录音阶段就失败了；此时只上报错误，不产生任何副作用。
   * 无论成功、失败还是取消，结束后都释放 requestId（见 release 的说明）。
   */
  async function complete(args) {
    try {
      const result = await runTask(args);
      if ((result.ok || result.stage === "paste") && args.audio?.nativeSessionId) {
        if (args.snapshot.settings.keepHistoryAudio || args.snapshot.preserveAudio) {
          await invoke("retain_native_audio", { sessionId: args.audio.nativeSessionId }, () => Promise.resolve()).catch((error) => {
            onEvent({ type: "retention-warning", requestId: args.snapshot.requestId, message: String(error?.message || error) });
          });
        } else if (result.ok) {
          await invoke("release_native_audio", { sessionId: args.audio.nativeSessionId }, () => Promise.resolve()).catch(() => {});
        }
      }
      return result;
    } finally {
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

    const asrStarted = now();
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
    const timings = { encodeMs: audio.encodeMs || 0, asrMs, textMs: 0, pasteMs: 0, audioMs: audio.audioMs };
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
    let finalText = corrected;
    let textFailure = null;
    let usedTextService = false;

    if (intent === "ask" || intent === "translate" || intent === "command") {
      usedTextService = true;
      if (!textReady(snapshot.settings)) {
        textFailure = "尚未配置文字模型，请先填写地址和模型名称";
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
    } else if (intent === "skill" || snapshot.processingMode === "skill" || (snapshot.processingMode === "smart" && effectiveTextLength(corrected) > 10)) {
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
        });
        if (!guard(snapshot)) return { ok: false, stage: "cancelled", stale: true };
        timings.textMs = stage.textMs;
        if (stage.ok && stage.text) finalText = stage.text;
        else textFailure = stage.error || "文字模型没有返回内容";
      } else {
        // 没配文字服务或 Skill 已失效：退回原文，并明确告知，不静默改变用户预期。
        textFailure = modeReady ? "所选 Skill 已不可用，请重新选择" : "尚未配置文字模型，已按原文处理";
        finalText = corrected;
      }
    } else if (snapshot.processingMode === "smart" && effectiveTextLength(corrected) <= 10) {
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
   * 所以「原文 / 整理结果 / 命令生成结果 / 用户点插入原文」四条路径
   * 对取消、自动粘贴开关、耗时统计的判定完全一致。
   */
  async function deliver(snapshot, { intent, finalText, rawText, timings, usedTextService, insertedRaw = false, warning = null }) {
    if (!guard(snapshot)) return { ok: false, stage: "cancelled", stale: true };

    const pasteStarted = now();
    let pasted = false;
    if (snapshot.settings.autoPaste && finalText) {
      try {
        await invoke("paste_text", { text: finalText, learn: intent === "dictation" && snapshot.settings.autoLearn !== false, sessionId: snapshot.requestId }, () => navigator.clipboard.writeText(finalText));
      } catch (error) {
        if (!guard(snapshot)) return { ok: false, stage: "cancelled", stale: true };
        timings.pasteMs = elapsedSince(pasteStarted);
        const message = `自动输入失败，结果已保留，可在历史记录中复制：${String(error?.message || error)}`;
        onEvent({
          type: "paste-failed", requestId: snapshot.requestId, intent,
          text: finalText, rawText, message, pasted: false, timings,
          usedTextService, windowContext: snapshot.windowContext,
          audioSessionId: snapshot.settings.keepHistoryAudio || snapshot.preserveAudio ? snapshot.nativeAudioSessionId : null,
        });
        return { ok: false, stage: "paste", text: finalText, intent, timings, pasted: false, message };
      }
      pasted = true;
      timings.pasteMs = elapsedSince(pasteStarted);
    }
    // 上屏是最后一步，之后再检查一次：取消发生在粘贴途中时不再上报完成状态。
    if (!guard(snapshot)) return { ok: false, stage: "cancelled", stale: true };

    onEvent({
      type: "done",
      requestId: snapshot.requestId,
      intent,
      text: finalText,
      rawText,
      pasted,
      timings,
      usedTextService,
      audioSessionId: snapshot.settings.keepHistoryAudio || snapshot.preserveAudio ? snapshot.nativeAudioSessionId : null,
      insertedRaw,
      warning,
      windowContext: snapshot.windowContext,
    });
    return { ok: true, text: finalText, intent, timings, pasted };
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
    snapshot.translationLanguage = translationLanguage;
    try {
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
    snapshot.preserveAudio = preserveAudio;
    return complete({ snapshot, audio: { nativeSessionId: audioSessionId, audioMs, encodeMs: 0 } });
  }

  /**
   * 「插入原文」：文字整理失败后，由用户主动把 ASR 原文上屏。
   *
   * 仍然走 deliver，所以取消判定、自动粘贴开关和耗时统计与其它路径完全一致；
   * 界面因此不需要自己拿 paste_text，也不会出现「分类失败后才插入」这种漏判。
   *
   * 命令模式一律拒绝：这里的「原文」是「帮我写封邮件」这样的指令，
   * 而当初失败的原因正是没能把它变成正文，直接回退上屏等于把指令打进别人的文档。
   */
  async function insertRaw({ intent, rawText, settings, customSkills = [], audioMs = 0, windowContext = null }) {
    if (intent === "command" || intent === "ask") {
      return { ok: false, stage: intent, message: "提问或语音命令失败时不会把原文插入当前窗口" };
    }
    const text = String(rawText || "");
    const snapshot = begin({ intent: "dictation", settings, customSkills, windowContext });
    try {
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
    previewId = `preview-${nextRequestId()}`;
    const snapshot = makeSnapshot(previewId, { intent: "dictation", settings });
    const stillWanted = () => previewId === snapshot.requestId;

    const corrected = applyVocabulary(rawText.trim(), snapshot.vocabulary);
    const trimmed = corrected.slice(0, MAX_TEXT_CHARS);
    if (!textReady(settings)) {
      return { ok: false, error: "尚未配置文字模型（地址与模型名称都要填）" };
    }
    if (!skill) return { ok: false, error: "请先选择要预览的 Skill" };
    if (sample) {
      // 样例预览不发请求：只确认 Skill 能被装配成合法请求，供编辑时快速自检。
      const messages = buildMessages({ instruction: skill.instruction, outputFormat: skill.outputFormat, rawText: trimmed || "（示例文本）" });
      return { ok: true, sample: true, messages };
    }
    const stage = await runTextStage(snapshot, {
      task: "preview",
      rawText: trimmed,
      instruction: skill.instruction,
      outputFormat: skill.outputFormat,
      skillId: skill.id,
    });
    if (!stillWanted()) return { ok: false, stale: true };
    if (!stage.ok) return { ok: false, error: stage.error };
    return { ok: true, text: stage.text, textMs: stage.textMs };
  }

  return { begin, cancel, current, isCurrent, complete, retry, retryAudio, insertRaw, preview, textReady, builtinSkills: BUILTIN_SKILLS };
}
