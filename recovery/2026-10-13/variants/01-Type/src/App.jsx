// 页面、HUD、入口与状态装配。
//
// 这个文件只做「接线」：录音在 dictation/useWavRecorder，任务与上屏在 dictation/pipeline，
// 本地文字处理在 text/。App.jsx 自己不做 WAV 编码、不调 paste_text、不改写文本——
// 一旦这里出现第二个上屏入口，取消竞态和「命令失败不落原文」这两条约定就会被绕过。

import { useEffect, useRef, useState } from "react";
import {
  ArrowClockwise,
  ArrowRight,
  BookOpenText,
  Check,
  CheckCircle,
  ClipboardText,
  ClockCounterClockwise,
  Command,
  Copy,
  GearSix,
  House,
  Key,
  Keyboard,
  LockKey,
  MagicWand,
  Microphone,
  PaperPlaneTilt,
  PaintBrush,
  PuzzlePiece,
  Repeat,
  ShieldCheck,
  Sparkle,
  Stop,
  TextT,
  WarningCircle,
  Waveform,
  X,
} from "@phosphor-icons/react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit, listen } from "@tauri-apps/api/event";

import { VocabularySettings } from "./components/VocabularySettings.jsx";
import { HistoryCorrection } from "./components/HistoryCorrection.jsx";
import { createVocabularyStore } from "./vocabulary/store.js";
import { emptyVocabulary, learnCorrections, dismissCorrection } from "./vocabulary/learning.js";
import { VoiceMotion } from "./voice/VoiceMotion.jsx";
import { scenarioFor } from "./text/skillScenarios.js";
import { SkillEditor } from "./components/SkillEditor.jsx";
import { AnswerCard } from "./components/AnswerCard.jsx";
import { AppIcon } from "./components/AppIcon.jsx";
import { BRAND } from "./ui/brand.js";
import { AppearanceSettings } from "./components/AppearanceSettings.jsx";
import { normalizeWelcomeText } from "./ui/welcome.js";
import { TextSettings } from "./components/TextSettings.jsx";
import { createPipeline } from "./dictation/pipeline.js";
import { useWavRecorder } from "./dictation/useWavRecorder.js";
import { useNativeRecorder } from "./dictation/useNativeRecorder.js";
import { displayShortcut, shortcutFromKeydown } from "./shortcuts/capture.js";
import { ASK_INSTRUCTION, BUILTIN_SKILLS, buildMessages, findBuiltinSkill } from "./text/builtinSkills.js";
import { createSkillStore } from "./text/skillStore.js";
import {
  DEFAULT_SETTINGS,
  QUICK_PHRASE_LIMITS,
  SHORTCUT_FIELDS,
  shortcutConflict,
  PROCESSING_MODES,
  hasStoredSettings,
  normalizeSettings,
  toPersistedSettings,
} from "./text/settingsMigration.js";

const MODE_META = {
  original: { label: "保留原文", detail: "保留句子与用词，仍按词库纠正", icon: Waveform },
  corrected: { label: "保留原文", detail: "保留句子与用词，仍按词库纠正", icon: BookOpenText },
  clean: { label: "轻度整理", detail: "去掉明显赘词，规范标点", icon: Sparkle },
  smart: { label: "自动整理", detail: "短句直接输出，长句整理成文", icon: MagicWand },
  skill: { label: "按写法整理", detail: "按所选场景组织内容", icon: PuzzlePiece },
};

const INTENT_META = {
  dictation: { label: "语音输入", icon: Microphone },
  command: { label: "语音指令", icon: Command },
  ask: { label: "提问", icon: Command },
  translate: { label: "翻译", icon: TextT },
  skill: { label: "写法", icon: PuzzlePiece },
};

/** 只在浏览器预览里作为初始历史；安装版首次运行必须是空历史。 */
const SAMPLE_HISTORY = [
  { id: 1, text: "我们优先把语音识别服务部署到内网服务器。", time: "示例", intent: "dictation", ms: 486, breakdown: "识别 486 ms", windowContext: { app: "Code", title: "项目说明" } },
  { id: 2, text: "Windows 客户端完成后，再复用协议支持 macOS。", time: "示例", intent: "dictation", ms: 612, breakdown: "识别 612 ms", windowContext: { app: "Chrome", title: "工作笔记" } },
];

function isTauri() {
  return Boolean(window.__TAURI_INTERNALS__);
}

async function desktopInvoke(command, payload, fallback) {
  if (!isTauri()) return typeof fallback === "function" ? fallback() : fallback;
  return invoke(command, payload);
}

function nowMs() {
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

function historyTime() {
  return new Date().toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

function describeError(error) {
  if (!error) return "未知错误";
  if (typeof error === "string") return error;
  return String(error.message || error);
}

/** 失败面板里那一句补充说明。没有对应类别就返回空串，不硬凑。 */
const FAILURE_HINTS = {
  auth: " · 请检查语音服务的密钥与权限",
  "rate-limit": " · 可稍后重新识别",
  format: " · 当前服务可能不接受 WAV 文件",
  transient: " · 多为服务端或网络临时问题，可直接重新识别",
  silence: " · 录音里几乎没有声音，重试前请确认麦克风未被静音",
  device: " · 请确认麦克风仍然可用",
};

/** 把耗时拆成一句可读的说明，方便对着「慢在哪一步」排查。 */
function breakdownOf(timings = {}) {
  const parts = [];
  if (timings.encodeMs) parts.push(`编码 ${timings.encodeMs} ms`);
  parts.push(`识别 ${timings.asrMs || 0} ms`);
  if (timings.textMs) parts.push(`整理 ${timings.textMs} ms`);
  if (timings.pasteMs) parts.push(`输入 ${timings.pasteMs} ms`);
  return parts.join(" · ");
}

/** 悬浮窗与概览共用的状态文案：录音、识别、整理文字、生成内容必须是四件能说清的事。 */
function statusLabel(state, intent, phase) {
  if (state === "recording") return "正在录音";
  if (state === "processing") {
    if (phase === "classify") return "正在判断处理方式";
    if (phase === "text") return intent === "ask" ? "正在回答" : intent === "translate" ? "正在翻译" : "正在处理文字";
    return "正在识别";
  }
  if (state === "done") return "已完成";
  if (state === "error") return "处理失败";
  return "准备就绪";
}

function skillOptions(customSkills) {
  return [...BUILTIN_SKILLS, ...customSkills];
}

function findSkill(id, customSkills) {
  if (!id) return null;
  return findBuiltinSkill(id) || customSkills.find((skill) => skill.id === id) || null;
}

function actionName(settings, customSkills) {
  if (settings.actionType === "skill") return findSkill(settings.actionSkillId, customSkills)?.name || "选择写法";
  return settings.actionType === "command" ? "语音指令" : "翻译";
}

function windowName(context) {
  if (!context || typeof context !== "object") return "";
  const app = String(context.app || "").trim();
  const title = String(context.title || "").trim();
  return [app, title].filter(Boolean).join(" · ");
}

function Logo({ size = 34 }) {
  return <AppIcon size={size} className="brand-icon" />;
}

function StatusDot({ online }) {
  return <span className={`status-dot ${online ? "online" : "offline"}`} aria-hidden="true" />;
}

function Overlay({ state, level, intent, phase, onStop, onCancel }) {
  const label = statusLabel(state, intent, phase);
  const cancelLabel = state === "recording" ? "取消录音" : state === "processing" ? "取消处理" : "关闭提示";
  return (
    <main className="overlay-shell">
      <section className={`voice-hud ${state} ${intent || "dictation"}`} aria-label="语音输入">
        <VoiceMotion state={state} level={level} width={76} height={26} feedback />
        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{label}</span>
        <div className="hud-controls" role="group" aria-label="录音控制">
          {state === "recording" && <button type="button" onClick={onStop} aria-label="结束录音" title="结束录音"><Stop size={15} weight="fill" /></button>}
          <button type="button" onClick={onCancel} aria-label={cancelLabel} title={cancelLabel}><X size={16} /></button>
        </div>
      </section>
    </main>
  );
}

function Sidebar({ page, setPage, online }) {
  const items = [
    ["home", House, "开始"],
    ["model", GearSix, "服务设置"],
    ["writing", Sparkle, "文字整理"],
    ["vocabulary", BookOpenText, "个人词库"],
    ["skills", PuzzlePiece, "写法"],
    ["shortcut", Keyboard, "快捷键"],
    ["history", ClockCounterClockwise, "历史记录"],
    ["appearance", PaintBrush, "外观"],
  ];
  return (
    <aside className="sidebar">
      <div className="brand-row"><Logo /><div><strong>{BRAND.name}</strong><span>{BRAND.description}</span></div></div>
      <nav aria-label="主导航">
        {items.map(([id, Icon, label]) => (
          <button className={page === id ? "active" : ""} key={id} onClick={() => setPage(id)} aria-current={page === id ? "page" : undefined} aria-label={label} title={label}>
            <Icon size={19} weight={page === id ? "fill" : "regular"} />{label}
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="privacy-line"><ShieldCheck size={17} weight="fill" /><span>录音发往所选语音服务</span></div>
        <div className="server-line"><StatusDot online={online} /><span>{online ? "语音服务已通过测试" : "语音服务尚未测试"}</span></div>
      </div>
    </aside>
  );
}

function Field({ label, hint, children }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

function Toggle({ label, checked, onChange, disabled = false }) {
  return <button type="button" className={`toggle ${checked ? "on" : ""}`} onClick={() => onChange(!checked)} role="switch" aria-label={label} aria-checked={checked} disabled={disabled}><i /></button>;
}

function SpeechSettings({ settings, setSettings, online, testing, testConnection, onNotice, onKeySaved }) {
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [devices, setDevices] = useState([]);
  useEffect(() => {
    if (!isTauri()) return undefined;
    let disposed = false;
    desktopInvoke("list_audio_devices", {}).then((items) => {
      if (!disposed) setDevices(items || []);
    }).catch((error) => onNotice(`无法读取麦克风列表：${describeError(error)}`, false));
    return () => { disposed = true; };
  }, []);
  const saveKey = async () => {
    if (!key.trim()) {
      onNotice({ text: "请先填写语音 API 密钥", ok: false });
      return;
    }
    setSaving(true);
    try {
      await desktopInvoke("save_api_key", { key });
      setKey("");
      onKeySaved();
      onNotice({ text: "语音密钥已保存到 Windows 凭据库", ok: true });
    } catch (error) {
      onNotice({ text: describeError(error), ok: false });
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="model-section" id="speech-model" aria-labelledby="speech-model-heading">
      <header className="model-section-heading"><div><span className="eyebrow">01 · 识别录音</span><h2 id="speech-model-heading">语音识别</h2><p>将你的录音转换为文字，所有语音入口都会使用。</p></div><div className={`connection-badge ${online ? "success" : ""}`}><StatusDot online={online} />{online ? "测试通过" : "尚未测试"}</div></header>
      <div className="panel form-panel">
        <div className="panel-title"><div className="icon-tile"><Waveform size={22} weight="bold" /></div><div><h3>兼容 OpenAI 的语音服务</h3><p>需要支持 WAV 录音识别。</p></div></div>
        <div className="form-grid">
          <Field label="服务地址" hint="通常填写到 /v1，具体以服务说明为准。"><input value={settings.asrEndpoint} onChange={(e) => setSettings((current) => ({ ...current, asrEndpoint: e.target.value }))} /></Field>
          <Field label="模型名称"><input value={settings.asrModel} onChange={(e) => setSettings((current) => ({ ...current, asrModel: e.target.value }))} /></Field>
          <Field label="麦克风" hint="默认设备跟随 Windows 设置。设备断开时保留已录内容。"><select value={settings.audioDeviceId || ""} disabled={!isTauri()} onChange={(e) => setSettings((current) => ({ ...current, audioDeviceId: e.target.value }))}><option value="">Windows 默认麦克风</option>{devices.map((device) => <option key={device.id} value={device.id}>{device.name}{device.isDefault ? "（当前默认）" : ""}</option>)}</select></Field>
          <Field label="API 密钥" hint="已有密钥时留空即可；替换密钥后点击保存。"><div className="input-with-icon"><Key size={18} /><input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="已有密钥可留空" /></div></Field>
        </div>
        <div className="form-actions"><button className="button secondary" onClick={testConnection} disabled={testing || saving || !settings.asrEndpoint.trim() || !settings.asrModel.trim()}>{testing ? <ArrowClockwise className="spin" size={18} /> : <PaperPlaneTilt size={18} />}{testing ? "正在测试…" : "测试语音服务"}</button><button className="button primary" onClick={saveKey} disabled={saving || testing || !key.trim() || !isTauri()}><LockKey size={18} weight="fill" />{saving ? "正在保存…" : "保存语音密钥"}</button></div>
        <p className="test-result">测试会发送 1 秒测试音频，确认服务能接收并返回识别结果。</p>
      </div>
      <div className="note-card"><ShieldCheck size={22} weight="fill" /><div><strong>音频去向</strong><p>录音会发送到你填写的语音服务。请使用 HTTPS 或可信的内网连接。</p></div></div>
    </section>
  );
}

function ModelSettings({ settings, setSettings, online, testing, testConnection, onNotice, onSpeechKeySaved }) {
  return <section className="page-content models-page">
    <header className="page-heading"><div><span className="eyebrow">连接服务</span><h1>服务设置</h1><p>语音服务负责识别，文字服务负责整理、提问和翻译。地址与密钥分别设置。</p></div></header>
    <nav className="model-jump-links" aria-label="模型分工">
      <a href="#speech-model"><Waveform size={22} /><span><strong>语音识别</strong><small>{settings.asrModel || "尚未设置模型"}</small></span><ArrowRight size={17} /></a>
      <a href="#text-model"><TextT size={22} /><span><strong>文字处理</strong><small>{settings.textModel || "自动整理 · 提问 · 翻译 · 写法"}</small></span><ArrowRight size={17} /></a>
    </nav>
    {!isTauri() && <p className="model-preview-note">当前为浏览器预览。连接测试和密钥保存请在桌面应用中完成。</p>}
    <SpeechSettings settings={settings} setSettings={setSettings} online={online} testing={testing} testConnection={testConnection} onNotice={onNotice} onKeySaved={onSpeechKeySaved} />
    <TextSettings settings={settings} setSettings={setSettings} invoke={desktopInvoke} onNotice={onNotice} previewMode={!isTauri()} />
  </section>;
}

function WritingSettings({ settings, setSettings, customSkills, onSelectSkill, textReady }) {
  const needsText = settings.processingMode === "smart" || settings.processingMode === "skill";
  const skills = skillOptions(customSkills);
  const selectedMode = settings.processingMode === "corrected" ? "original" : settings.processingMode;
  return (
    <section className="page-content">
      <header className="page-heading"><div><span className="eyebrow">日常语音输入</span><h1>文字整理</h1><p>选择适合你的处理方式。提问和动作快捷键在“快捷键”页单独设置。</p></div></header>
      <div className="mode-grid" role="group" aria-label="文字整理模式">
        {PROCESSING_MODES.filter((id) => id !== "corrected").map((id) => {
          const item = MODE_META[id];
          const Icon = item.icon;
          return <button key={id} className={`mode-card ${selectedMode === id ? "selected" : ""}`} aria-pressed={selectedMode === id} onClick={() => setSettings({ ...settings, processingMode: id })}><span className="mode-icon"><Icon size={21} /></span><span className="mode-copy"><strong>{item.label}</strong><small>{item.detail}</small></span>{selectedMode === id && <span className="check-mark"><Check size={13} weight="bold" /></span>}</button>;
        })}
      </div>

      {(settings.processingMode === "skill" || settings.processingMode === "smart") && (
        <div className="panel form-panel compact">
          <div className="panel-title"><div className="icon-tile"><PuzzlePiece size={22} /></div><div><h2>默认写法</h2><p>自动整理长句、按写法整理需要文字服务；尚未设置时保留原文。</p></div></div>
          <div className="form-grid">
            <Field label="所用写法" hint="选择“按写法整理”后，后续语音输入持续使用。">
              <select value={settings.processingMode === "skill" ? settings.selectedSkillId : ""} onChange={(event) => onSelectSkill(event.target.value)} disabled={settings.processingMode !== "skill"}>
                <option value="">未选择（自动整理）</option>
                {skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}{skill.source === "builtin" ? "（内置）" : ""}</option>)}
              </select>
            </Field>
          </div>
          {needsText && !textReady && <p className="test-result">在“服务设置 → 文字处理”填写地址与模型名称后，即可使用。</p>}
        </div>
      )}


    </section>
  );
}

function ShortcutSettings({ settings, setSettings, customSkills, onNotice, busy }) {
  const [captureKind, setCaptureKind] = useState(null);
  const [captureReady, setCaptureReady] = useState(false);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [captureMessage, setCaptureMessage] = useState("");
  const captureBusyRef = useRef(false);
  const fields = SHORTCUT_FIELDS;

  useEffect(() => {
    if (!captureKind) return undefined;
    let disposed = false;
    setCaptureReady(false);
    desktopInvoke("set_shortcut_capture_active", { active: true }, true)
      .then(() => {
        if (disposed) desktopInvoke("set_shortcut_capture_active", { active: false }, true).catch(() => {});
        else setCaptureReady(true);
      })
      .catch((error) => {
        if (!disposed) {
          setCaptureMessage(describeError(error));
          setCaptureKind(null);
        }
      });
    // 只有真正离开窗口才取消录制。之前的版本对任何一次 blur 都静默取消，
    // 于是点一下别处再回来按组合键就「什么都没发生」——用户完全看不出原因。
    //
    // 注意：捕获期间三个全局快捷键仍被系统注册着，所以在窗口内按下组合键时，
    // 到不了 keydown、而是先触发全局热键——后端会 emit shortcut-capture-pressed，
    // 底下那个 listener 负责提示。Esc 是唯一没被注册为全局键的按键，能正常到达。
    const onBlur = () => {
      if (captureBusyRef.current) return;
      setCaptureMessage("设置窗口失去焦点，已暂停。返回窗口继续，或按 Esc 取消。");
    };
    window.addEventListener("blur", onBlur);
    const unlisten = isTauri()
      ? listen("shortcut-capture-pressed", (event) => setCaptureMessage(event.payload === captureKind ? "这就是当前快捷键；按 Esc 保留" : "这个组合键已经被其他入口使用"))
      : null;
    return () => {
      disposed = true;
      window.removeEventListener("blur", onBlur);
      if (unlisten) unlisten.then((off) => off());
      desktopInvoke("set_shortcut_capture_active", { active: false }, true).catch(() => {});
    };
  }, [captureKind]);

  useEffect(() => {
    if (!captureKind) return undefined;
    const onKeyDown = async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat || captureBusyRef.current) return;
      const result = shortcutFromKeydown(event);
      if (result.kind === "cancel") {
        setCaptureKind(null);
        setCaptureMessage("");
        return;
      }
      if (result.kind === "waiting") return;
      if (!captureReady) {
        setCaptureMessage("快捷键正在准备，请稍后再按一次。");
        return;
      }
      if (result.kind === "invalid") {
        setCaptureMessage(result.message);
        return;
      }
      if (shortcutConflict(settings, captureKind, result.value)) {
        setCaptureMessage("这个组合键已经被其他入口使用，请换一个组合键。");
        return;
      }
      captureBusyRef.current = true;
      setCaptureBusy(true);
      setCaptureMessage("正在设置快捷键…");
      try {
        await desktopInvoke("set_shortcut", { key: captureKind, value: result.value }, true);
        setSettings((before) => ({ ...before, [fields[captureKind]]: result.value }));
        setCaptureKind(null);
        setCaptureMessage("");
        onNotice({ text: isTauri() ? "快捷键已更新" : "预览已更新，桌面应用中的全局快捷键需另行验证", ok: true });
      } catch (error) {
        setCaptureMessage(`未能设置：${describeError(error)}。请换一个组合键。`);
      } finally {
        captureBusyRef.current = false;
        setCaptureBusy(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [captureKind, captureReady, captureBusy, settings.shortcut, settings.askShortcut, settings.actionShortcut, settings.phraseShortcut]);

  const beginCapture = (kind) => {
    if (busy || captureKind) return;
    captureBusyRef.current = false;
    setCaptureMessage("");
    setCaptureKind(kind);
  };

  const clearPhraseShortcut = async () => {
    captureBusyRef.current = true;
    setCaptureBusy(true);
    try {
      await desktopInvoke("set_shortcut", { key: "phrase", value: "" }, true);
      setSettings((current) => ({ ...current, phraseShortcut: "" }));
      onNotice({ text: "短语快捷键已解除，内容仍然保留", ok: true });
    } catch (error) { setCaptureMessage(describeError(error)); }
    finally { captureBusyRef.current = false; setCaptureBusy(false); }
  };

  const shortcutButton = (kind, title) => (
    <button
      className={`shortcut-record ${captureKind === kind ? "capturing" : ""}`}
      type="button"
      aria-label={`${title}快捷键，当前 ${settings[fields[kind]] ? displayShortcut(settings[fields[kind]]) : "未设置"}，点击后按新组合键`}
      onClick={() => captureKind === kind ? setCaptureKind(null) : beginCapture(kind)}
      disabled={busy || captureBusy || (captureKind !== null && captureKind !== kind)}
    >
      <span>{captureKind === kind ? captureReady ? captureBusy ? "正在设置…" : "请按组合键…" : "准备中…" : settings[fields[kind]] ? displayShortcut(settings[fields[kind]]) : "设置快捷键"}</span>
      <small>{captureKind === kind ? "Esc 取消" : settings[fields[kind]] ? "点击更改" : "点击后按组合键"}</small>
    </button>
  );

  const actionLabel = settings.actionType === "skill"
    ? findSkill(settings.actionSkillId, customSkills)?.name || "写法未选择"
    : settings.actionType === "command" ? "语音指令" : `翻译成${settings.defaultTranslationLanguage}`;
  const rows = [
    ["dictation", "语音输入", "说完后按设置输入或复制文字。"],
    ["ask", "提问", "说出你的问题，回答只显示在卡片中。"],
    ["action", actionLabel, "按这里选择的动作处理录音，语音输入的设置保持原样。"],
  ];

  return (
    <section className="page-content">
      <header className="page-heading"><div><span className="eyebrow">录音与输入</span><h1>快捷键</h1><p>录音快捷键按一次开始，再按一次结束。快捷短语按一次即可填入。点击组合键可更改，按 Esc 取消设置。</p></div></header>
      <div className="panel settings-list">
        {rows.map(([kind, title, detail]) => (
          <div key={kind} className={captureKind === kind ? "shortcut-row capturing" : "shortcut-row"}>
            <div><strong>{title}</strong><span>{detail}</span></div>
            <div className="shortcut-edit">
              {shortcutButton(kind, title)}
            </div>
          </div>
        ))}
      </div>
      <p className={`shortcut-capture-message ${captureMessage ? "error" : ""}`} role="status" aria-live="polite">
        {captureMessage || (captureKind ? "同时按住 Ctrl、Alt 或 Win，再按字母、数字、空格、方向键、标点或 F1–F24。" : "新组合键设置成功后才会替换原有快捷键，各入口需使用不同的组合键。")}
      </p>
      <div className="panel form-panel quick-phrase-panel">
        <div className="panel-title"><div className="icon-tile"><ClipboardText size={20} /></div><div><h2>快捷短语</h2><p>把常用内容保存下来，在输入框按快捷键直接填入。</p></div></div>
        <div className="form-grid">
          <Field label="短语名称" hint="例如：手机号、邮箱或固定回复"><input value={settings.phraseName} maxLength={QUICK_PHRASE_LIMITS.name} placeholder="例如：手机号" onChange={(event) => setSettings((current) => ({ ...current, phraseName: event.target.value }))} /></Field>
          <Field label="快捷键"><div className="phrase-shortcut-controls">{shortcutButton("phrase", "快捷短语")}{settings.phraseShortcut && <button className="button quiet" type="button" onClick={clearPhraseShortcut} disabled={busy || captureBusy || Boolean(captureKind)}>解除绑定</button>}</div></Field>
          <Field label="短语内容" hint="按原样填入，支持换行。内容自动保存在本机。"><textarea rows={3} value={settings.phraseText} maxLength={QUICK_PHRASE_LIMITS.text} placeholder="填写你要输入的号码或文字" spellCheck={false} onChange={(event) => setSettings((current) => ({ ...current, phraseText: event.target.value }))} /></Field>
        </div>
        <p className="phrase-status">{settings.phraseShortcut ? settings.phraseText.trim() ? `在输入框按 ${displayShortcut(settings.phraseShortcut)}，即可填入${settings.phraseName.trim() || "这段内容"}。` : "填写短语内容后，即可使用已绑定的快捷键。" : "填写内容并设置快捷键后即可使用。"}</p>
      </div>
      <div className="panel form-panel compact">
        <div className="panel-title"><div className="icon-tile"><PuzzlePiece size={20} /></div><div><h2>动作快捷键</h2><p>可用于翻译、按写法整理，或按口述要求生成文字。</p></div></div>
        <div className="form-grid">
          <Field label="动作">
            <select value={settings.actionType} onChange={(event) => setSettings({ ...settings, actionType: event.target.value })}>
              <option value="translate">翻译</option>
              <option value="skill">按写法整理</option>
              <option value="command">语音指令</option>
            </select>
          </Field>
          {settings.actionType === "translate" && <Field label="默认输出语言"><select value={settings.defaultTranslationLanguage} onChange={(event) => setSettings({ ...settings, defaultTranslationLanguage: event.target.value })}>{["英文", "日文", "韩文", "中文", "法文", "德文", "西班牙文"].map((language) => <option key={language} value={language}>{language}</option>)}</select></Field>}
          {settings.actionType === "skill" && <Field label="写法" hint="只处理这次录音，不改变普通口述的设置">
            <select value={settings.actionSkillId} onChange={(event) => setSettings({ ...settings, actionSkillId: event.target.value })}>
              <option value="">请选择写法</option>
              {skillOptions(customSkills).map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}
            </select>
          </Field>}
        </div>
      </div>
      <div className="panel settings-list">
        <div><div><strong>自动输入结果</strong><span>语音结果开启后输入到光标处，关闭后复制到剪贴板。提问显示为卡片，快捷短语始终直接填入。</span></div><Toggle label="自动输入结果" checked={settings.autoPaste} onChange={(value) => setSettings({ ...settings, autoPaste: value })} /></div>
        <div><div><strong>自动判断语音指令</strong><span>实验功能：自动区分直接输入与生成要求，会额外调用文字服务。</span></div><Toggle label="自动判断语音指令" checked={settings.autoIntent} onChange={(value) => setSettings({ ...settings, autoIntent: value })} disabled={!settings.textEndpoint || !settings.textModel} /></div>
        <div><div><strong>登录后启动</strong><span>登录 Windows 后自动启动 {BRAND.name}。</span></div><Toggle label="登录后启动" checked={settings.launchAtLogin} disabled={!isTauri()} onChange={async (value) => {
          try {
            await desktopInvoke("set_launch_at_login", { enabled: value });
            setSettings((current) => ({ ...current, launchAtLogin: value }));
          } catch (error) { onNotice(`设置登录启动失败：${describeError(error)}`, false); }
        }} /></div>
      </div>
    </section>
  );
}

function History({ history, onClear, onTeach, onExport, onRetranscribe, retentionDays, onRetentionChange, keepAudio, onKeepAudioChange, busy }) {
  return (
    <section className="page-content">
      <header className="page-heading"><div><span className="eyebrow">本机记录</span><h1>历史记录</h1><p>最多保留最近 50 条记录。Windows 版在本机加密保存，应用与窗口名称不发送给模型。</p></div><div className="form-actions"><button className="button secondary" onClick={onExport}>导出历史</button>{history.length > 0 && <button className="button secondary" onClick={onClear}>清空历史</button>}</div></header>
      <div className="panel form-panel compact"><Field label="保留期限"><select value={retentionDays} onChange={(event) => onRetentionChange(Number(event.target.value))}><option value={7}>7 天</option><option value={30}>30 天</option><option value={90}>90 天</option><option value={365}>1 年</option><option value={0}>一直保留</option></select></Field><div className="history-recording-setting"><div><strong>保存录音</strong><span>开启后保存新的录音，可从历史重新识别。录音与记录一同到期。</span></div><Toggle label="保存录音" checked={keepAudio} onChange={onKeepAudioChange} disabled={!isTauri()} /></div></div>
      <div className="history-list">
        {history.length === 0 && <div className="panel form-panel"><p className="empty-text">完成语音输入后，你的记录会保存在这里。</p></div>}
        {history.map((item) => (
          <article key={item.id}>
            <div className="history-main">
              <p>{item.text}</p>
              {item.intent === "dictation" && <HistoryCorrection item={item} onTeach={onTeach} />}
              {item.intent === "ask" && item.rawText && <span>问题：{item.rawText}</span>}
              <span className="history-meta">{item.time} · {(INTENT_META[item.intent] || INTENT_META.dictation).label}{windowName(item.windowContext) ? ` · ${windowName(item.windowContext)}` : ""} · {item.ms} ms{item.breakdown ? ` · ${item.breakdown}` : ""}</span>
            </div>
            {item.audioSessionId && <button aria-label="用当前模型重新识别" title="用当前模型重新识别" onClick={() => onRetranscribe(item)} disabled={busy}><Repeat size={18} /></button>}
            <button aria-label="复制记录" title="复制" onClick={() => navigator.clipboard.writeText(item.text)}><Copy size={18} /></button>
          </article>
        ))}
      </div>
    </section>
  );
}

function Overview({ settings, customSkills, online, setPage, state, intent, phase, activeTrigger, toggleTask, lastResult, textReady, level }) {
  const recording = state === "recording";
  const busy = state === "processing";
  const mode = MODE_META[settings.processingMode === "corrected" ? "original" : settings.processingMode] || MODE_META.original;
  const locked = (trigger) => recording && activeTrigger !== trigger;
  const speechReady = Boolean(settings.asrEndpoint.trim() && settings.asrModel.trim());
  const needsText = settings.processingMode === "smart" || settings.processingMode === "skill";
  const startOrConfigure = (trigger) => {
    if (!recording && (!speechReady || (trigger !== "dictation" && !textReady))) {
      setPage("model");
      return;
    }
    toggleTask(trigger);
  };
  const readyLabel = !speechReady ? "待设置语音服务" : online ? "准备就绪" : "语音服务尚未测试";
  return (
    <section className="page-content overview">
      <header className="page-heading"><div><span className="eyebrow">{BRAND.description}</span><h1>{BRAND.name}</h1><p>{BRAND.introduction}</p></div></header>
      <div className="hero-card">
        <div className="hero-copy">
          <span className={`hero-status ${state}`}>{state === "idle" ? readyLabel : statusLabel(state, intent, phase)}</span>
          <h2>{recording ? "正在录音" : busy ? statusLabel(state, intent, phase) : !speechReady ? "连接语音服务" : "语音输入"}</h2>
          <p>{recording ? "说完后，再按同一个快捷键或点击“结束录音”。" : !speechReady ? "填写服务地址、模型名称和 API 密钥后，即可开始语音输入。" : textReady ? "按一次快捷键录音，再按一次结束。文字会按你的设置输入到光标处，或复制到剪贴板。" : "按一次快捷键录音，再按一次结束。文字会按设置输入或复制；提问、翻译和按写法整理还需设置文字服务。"}</p>
          <div className="hero-actions">
            <button className="button dark" onClick={() => startOrConfigure("dictation")} disabled={busy || locked("dictation")}>
              {recording && intent === "dictation" ? <Stop size={17} weight="fill" /> : <Microphone size={17} weight="fill" />}
              {recording && activeTrigger === "dictation" ? "结束录音" : !speechReady ? "设置语音服务" : "语音输入"}
            </button>
            <button className="button secondary" onClick={() => startOrConfigure("ask")} title={!speechReady ? "先设置语音服务" : !textReady ? "设置文字服务后可提问" : undefined} disabled={busy || locked("ask")}>
              <Command size={17} />
              {recording && activeTrigger === "ask" ? "结束提问" : "提问"}
            </button>
            <button className="button secondary" onClick={() => startOrConfigure("action")} title={!speechReady ? "先设置语音服务" : !textReady ? "设置文字服务后可使用这个动作" : undefined} disabled={busy || locked("action")}>
              <PuzzlePiece size={17} />
              {recording && activeTrigger === "action" ? "结束录音" : actionName(settings, customSkills)}
            </button>
          </div>
        </div>
        <div className="hero-visual"><VoiceMotion state={state} level={level} width={164} height={56} /><span>{recording ? "说完后结束录音" : "按快捷键录音"}</span><small>{recording ? "使用同一个快捷键" : displayShortcut(settings.shortcut)}</small></div>
      </div>
      <div className="summary-grid">
        <button className="summary-card" onClick={() => setPage("model")}><span><Waveform size={21} /></span><div><small>语音模型</small><strong>{settings.asrModel || "尚未设置"}</strong><p>{!speechReady ? "填写地址与模型名称" : online ? "测试通过" : "待测试连接"}</p></div><CheckCircle size={20} weight={online ? "fill" : "regular"} /></button>
        <button className="summary-card" onClick={() => setPage("writing")}><span><mode.icon size={21} /></span><div><small>处理方式</small><strong>{mode.label}</strong><p>{textReady || !needsText ? mode.detail : `${mode.detail}（文字服务尚未设置）`}</p></div><GearSix size={20} /></button>
      </div>
      <div className="last-result panel">
        <div className="panel-title slim">
          <div><h2>最近结果</h2><p>{lastResult ? lastResult.breakdown : "还没有结果"}</p></div>
          {lastResult && <button className="icon-button" aria-label="复制最近结果" title="复制最近结果" onClick={() => navigator.clipboard.writeText(lastResult.text)}><Copy size={18} /></button>}
        </div>
        <p className={lastResult ? "result-text" : "empty-text"}>{lastResult?.text || (speechReady ? "你的下一段输入会显示在这里。" : "连接语音服务后，你的第一段输入会显示在这里。")}</p>
      </div>
    </section>
  );
}

export function App({ onWelcomeChange, onReplayEntrance } = {}) {
  const previewParams = new URLSearchParams(window.location.search);
  const overlayPreview = previewParams.get("overlay");
  const cardPreview = Boolean(previewParams.get("card"));
  const [windowLabel, setWindowLabel] = useState(() => isTauri() ? getCurrentWindow().label : cardPreview ? "answer" : overlayPreview ? "overlay" : "main");
  const previewPage = previewParams.get("page");
  const [page, setPage] = useState(() => {
    if (isTauri()) return "home";
    if (previewPage === "text") return "model";
    return ["shortcut", "vocabulary", "history", "skills", "writing", "model", "appearance"].includes(previewPage) ? previewPage : "home";
  });
  const workspaceRef = useRef(null);
  useEffect(() => { workspaceRef.current?.scrollTo({ top: 0, left: 0 }); }, [page]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [hydrated, setHydrated] = useState(false);
  const welcomeText = normalizeWelcomeText(settings.welcomeText);
  useEffect(() => {
    if (hydrated) onWelcomeChange?.(welcomeText);
  }, [hydrated, welcomeText, onWelcomeChange]);
  const [customSkills, setCustomSkills] = useState([]);
  const [vocabulary, setVocabulary] = useState(emptyVocabulary);
  const [vocabularyReady, setVocabularyReady] = useState(false);
  const vocabularyRef = useRef(vocabulary);
  const vocabularyReadyRef = useRef(false);
  const vocabularyStoreRef = useRef(null);
  if (!vocabularyStoreRef.current) vocabularyStoreRef.current = createVocabularyStore(desktopInvoke, (next) => {
    vocabularyRef.current = next;
    setVocabulary(next);
  });
  const [history, setHistory] = useState(() => {
    if (isTauri()) return [];
    try {
      const stored = JSON.parse(localStorage.getItem("typefree-windows.history") || "null");
      if (Array.isArray(stored)) return stored;
    } catch {
      // 损坏的历史不影响启动，直接当空的处理。
    }
    // 安装版首次运行显示空历史；样例数据只在浏览器预览里出现。
    return isTauri() ? [] : SAMPLE_HISTORY;
  });
  const [historyReady, setHistoryReady] = useState(() => !isTauri());
  const historyWriteRef = useRef(Promise.resolve());
  const persistedHistoryRef = useRef([]);
  const [online, setOnline] = useState(false);
  const [testing, setTesting] = useState(false);
  const [state, setState] = useState(overlayPreview || "idle");
  const [intent, setIntent] = useState(() => !isTauri() && overlayPreview && INTENT_META[previewParams.get("intent")] ? previewParams.get("intent") : "");
  const [phase, setPhase] = useState(() => !isTauri() && overlayPreview ? ["asr", "classify", "text"].includes(previewParams.get("phase")) ? previewParams.get("phase") : overlayPreview === "processing" ? "asr" : "idle" : "idle");
  const [audioLevel, setAudioLevel] = useState(overlayPreview === "recording" ? Math.max(0, Math.min(1, Number(previewParams.get("level") ?? 0.55) || 0)) : 0);
  const [notice, setNotice] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const [answerCard, setAnswerCard] = useState(cardPreview ? previewParams.get("card") === "skill"
    ? { kind: "skill", title: "会议纪要", question: scenarioFor(BUILTIN_SKILLS[2]).input, answer: scenarioFor(BUILTIN_SKILLS[2]).output }
    : { kind: "ask", title: "提问", question: "下周有三个项目并行，应该怎样安排工作？", answer: "先把必须按时交付的事项排在前面，再为每个项目留出一段完整的工作时间。\n\n1. 周一先确认三项交付的截止时间和依赖，选出最需要推进的一项。\n2. 每天保留一段不被会议打断的时间，完成当天最重要的工作。\n3. 把需要他人协作的事项提前发出，避免等到最后一天。\n\n如果时间不够，先与相关方确认范围与优先级，再调整承诺。" } : null);
  const answerCardRef = useRef(answerCard);
  const closeAnswerRef = useRef(() => {});
  answerCardRef.current = answerCard;
  const streamingAnswerIdRef = useRef(null);
  const followupRequestIdRef = useRef(null);
  /** 文字阶段失败后留给用户选择的现场：原文、意图与耗时。 */
  const [pendingFailure, setPendingFailure] = useState(null);
  const [retrying, setRetrying] = useState(false);
  const [recoverableAudio, setRecoverableAudio] = useState([]);

  const stateRef = useRef(state);
  const settingsRef = useRef(settings);
  const customSkillsRef = useRef(customSkills);
  const activeSnapshotRef = useRef(null);
  const currentIntentRef = useRef("");
  const currentTriggerRef = useRef("");
  const startingRef = useRef(false);
  const startGenerationRef = useRef(0);
  const pendingStopRef = useRef(false);
  const eventRef = useRef(() => {});
  const toggleRef = useRef(() => {});
  const cancelRef = useRef(() => {});
  const stopRef = useRef(() => {});
  stateRef.current = state;
  settingsRef.current = settings;
  customSkillsRef.current = customSkills;


  const notify = (message, ok = false) => {
    if (message && typeof message === "object") {
      const text = String(message.text || "");
      if (!text) { setNotice(null); return; }
      setNotice({ text, ok: Boolean(message.ok) });
      return;
    }
    const text = String(message || "");
    if (!text) { setNotice(null); return; }
    setNotice({ text, ok });
  };

  const pipelineRef = useRef(null);
  if (!pipelineRef.current) {
    pipelineRef.current = createPipeline({ invoke: desktopInvoke, onEvent: (event) => eventRef.current(event) });
  }
  const skillStoreRef = useRef(null);
  if (!skillStoreRef.current) {
    skillStoreRef.current = createSkillStore(desktopInvoke);
  }
  const pipeline = pipelineRef.current;
  const refreshRecoverableAudio = () => {
    if (isTauri()) desktopInvoke("list_recoverable_audio", {}).then(setRecoverableAudio).catch((error) => notify(`读取可恢复录音失败：${describeError(error)}`, false));
  };

  const webRecorder = useWavRecorder({
    onDeviceState: ({ phase: devicePhase }) => {
      if (devicePhase === "recording") setPhase("record");
    },
  });
  const nativeRecorder = useNativeRecorder({
    onDeviceState: ({ phase: devicePhase, message }) => {
      if (devicePhase === "recording") setPhase("record");
      // 设备抖动：只提示，录音仍在继续。这里刻意不动 stopTask。
      if (devicePhase === "warning") {
        if (stateRef.current === "recording") {
          const text = message || "麦克风短暂抖动，录音已继续";
          notify(text, true);
          // 抖动是过程性信息，留几秒就收，免得挡住界面要用户手动关掉。
          setTimeout(() => setNotice((current) => (current && current.text === text ? null : current)), 6000);
        }
        return;
      }
      if (devicePhase === "error" && stateRef.current === "recording") {
        notify(message || "麦克风已中断，正在保存已录内容", false);
        stopTask();
      }
    },
  });
  const recorder = isTauri() ? nativeRecorder : webRecorder;

  const startTask = async (trigger, skillId = "") => {
    if (activeSnapshotRef.current || startingRef.current) return;
    if (stateRef.current === "recording" || stateRef.current === "processing") return;
    if (!hydrated || !historyReady) return;
    const currentSettings = { ...settingsRef.current, learnedEntries: vocabularyRef.current.entries,
      skillDelivery: trigger === "skill" ? "card" : settingsRef.current.skillDelivery };
    if (!currentSettings.asrEndpoint || !currentSettings.asrModel) {
      notify("请先在“服务设置”填写语音服务地址和模型名称", false);
      return;
    }
    const nextIntent = trigger === "action" ? currentSettings.actionType : trigger;
    if (nextIntent === "skill" && !findSkill(skillId || currentSettings.actionSkillId, customSkillsRef.current)) {
      notify("请先为第三个快捷键选择一个写法", false);
      return;
    }
    if (nextIntent !== "dictation" && (!currentSettings.textEndpoint || !currentSettings.textModel)) {
      notify("请先在“服务设置”填写文字服务地址和模型名称", false);
      return;
    }
    startingRef.current = true;
    currentTriggerRef.current = trigger;
    pendingStopRef.current = false;
    const generation = ++startGenerationRef.current;
    await desktopInvoke("stop_learning_monitor", {}, true).catch(() => {});
    if (generation !== startGenerationRef.current) return;
    // 在目标应用仍是前台窗口时取一次身份；只写本地历史，不发给模型。
    const windowContext = await desktopInvoke("get_active_window_context", {}, () => null).catch(() => null);
    if (generation !== startGenerationRef.current) return;
    // 本次任务的写法与设置在录音开始前固定；不会改变后续口述的默认路径。
    const snapshot = pipeline.begin({
      intent: nextIntent,
      skillId,
      settings: currentSettings,
      customSkills: customSkillsRef.current,
      windowContext,
    });
    activeSnapshotRef.current = snapshot;
    currentIntentRef.current = snapshot.intent;
    currentTriggerRef.current = trigger;
    setPendingFailure(null);
    setIntent(snapshot.intent);
    setPhase("record");
    stateRef.current = "recording";
    setState("recording");
    try {
      // intent 随 start 落盘（spool/intent.txt）：应用重启后恢复面板靠它路由回原路径。
      // 追加在末尾——webRecorder.start 是位置参数，插在中间会错位。
      await recorder.start(snapshot.requestId, currentSettings.audioDeviceId, currentSettings.asrEndpoint, currentSettings.asrModel, snapshot.intent);
      if (generation !== startGenerationRef.current) return;
      startingRef.current = false;
      if (pendingStopRef.current) {
        pendingStopRef.current = false;
        stopTask();
      }
    } catch (error) {
      if (generation !== startGenerationRef.current) return;
      activeSnapshotRef.current = null;
      // 麦克风没拿到就作废这条任务，避免它的 requestId 一直占着当前任务。
      pipeline.cancel();
      notify(describeError(error), false);
      setState("error");
    } finally {
      if (generation === startGenerationRef.current) startingRef.current = false;
    }
  };

  const stopTask = async () => {
    if (startingRef.current) { pendingStopRef.current = true; return; }
    const snapshot = activeSnapshotRef.current;
    if (!snapshot) return;
    activeSnapshotRef.current = null;
    stateRef.current = "processing";
    setState("processing");
    setPhase("asr");
    let audio = null;
    let audioError = "";
    try {
      const encodeStarted = nowMs();
      audio = await recorder.stop();
      // encodeMs 由这里补上：runtime 把「拼接 + 重采样 + 打包 + base64」算作编码耗时，
      // pipeline 只认返回值里的这个字段，否则耗时面板上的编码一项永远是 0。
      if (audio) audio.encodeMs = Math.max(0, Math.round(nowMs() - encodeStarted));
    } catch (error) {
      audioError = describeError(error);
      refreshRecoverableAudio();
    }
    await pipeline.complete({ snapshot, audio, audioError });
  };

  const cancelTask = () => {
    pendingStopRef.current = false;
    stateRef.current = "idle";
    startGenerationRef.current += 1;
    startingRef.current = false;
    // 先作废 requestId：即使 ASR 或文字请求稍后返回，也不会再上屏、写历史或改状态。
    pipeline.cancel();
    desktopInvoke("stop_learning_monitor", {}, true).catch(() => {});
    activeSnapshotRef.current = null;
    currentTriggerRef.current = "";
    recorder.abandon();
    setIntent("");
    setPhase("idle");
    setState("idle");
    setPendingFailure(null);
  };

  const toggleTask = (kind, skillId = "") => {
    if (startingRef.current) {
      if (currentTriggerRef.current === kind) pendingStopRef.current = true;
      return;
    }
    const current = stateRef.current;
    if (current === "recording") {
      // 只有「按下的那个入口」能结束这段录音，避免命令键误停普通口述。
      if (currentTriggerRef.current === kind) stopTask();
      return;
    }
    if (current === "processing") return;
    startTask(kind, skillId);
  };

  toggleRef.current = toggleTask;
  cancelRef.current = cancelTask;
  stopRef.current = stopTask;

  // pipeline 的事件都带 requestId；过期任务的结果 pipeline 已经拦下，这里只负责呈现。
  eventRef.current = (event) => {
    if (!event) return;
    if (event.type === "state") {
      setState("processing");
      setPhase(event.phase || "asr");
      return;
    }
    if (event.type === "error") {
      setState("error");
      notify(event.message, false);
      if (event.stage === "asr" && event.audioSessionId) {
        setPendingFailure({ kind: "asr", errorKind: event.errorKind, audioSessionId: event.audioSessionId, audioMs: event.audioMs, intent: event.intent, skillId: event.skillId, skillDelivery: event.skillDelivery, windowContext: event.windowContext, message: event.message });
        refreshRecoverableAudio();
      }
      return;
    }
    if (event.type === "text-failed") {
      setState("error");
      setPendingFailure({
        intent: event.intent,
        skillId: event.skillId,
        skillDelivery: event.skillDelivery,
        translationLanguage: event.translationLanguage,
        rawText: event.rawText,
        audioMs: (event.timings && event.timings.audioMs) || 0,
        message: event.message,
        windowContext: event.windowContext,
      });
      if (event.intent === "ask" && answerCardRef.current?.requestId === event.requestId) {
        const card = { ...answerCardRef.current, streaming: false, error: event.message };
        setAnswerCard(card);
        if (isTauri()) desktopInvoke("show_answer_card", card, true).catch(() => {});
      }
      notify(event.message, false);
      return;
    }
    if (event.type === "answer") {
      const card = { question: event.question, answer: event.text, requestId: event.requestId, kind: event.intent || "ask", title: event.title || "提问", streaming: false };
      setAnswerCard(card);
      if (isTauri()) desktopInvoke("show_answer_card", card, true).catch((error) => notify(describeError(error), false));
      const timings = event.timings || {};
      setHistory((current) => [{
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        savedAt: Date.now(),
        text: event.text,
        rawText: event.question,
        time: historyTime(),
        intent: event.intent || "ask",
        skillId: event.skillId,
        skillDelivery: event.intent === "skill" ? "card" : undefined,
        ms: (timings.encodeMs || 0) + (timings.asrMs || 0) + (timings.textMs || 0),
        breakdown: breakdownOf(timings),
        audioSessionId: event.audioSessionId || null,
        windowContext: event.windowContext,
      }, ...current].slice(0, 50));
      setPendingFailure(null);
      setState("done");
      setPhase("done");
      setTimeout(() => setState((current) => current === "done" ? "idle" : current), 680);
      return;
    }
    if (event.type === "done" || event.type === "paste-failed") {
      const timings = event.timings || {};
      const total = (timings.encodeMs || 0) + (timings.asrMs || 0) + (timings.textMs || 0) + (timings.pasteMs || 0);
      const breakdown = breakdownOf(timings);
      const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        savedAt: Date.now(),
        text: event.text,
        time: historyTime(),
        intent: event.intent,
        ms: total,
        breakdown,
        rawText: event.rawText,
        warning: event.warning || null,
        audioSessionId: event.audioSessionId || null,
        windowContext: event.windowContext,
      };
      setLastResult({ text: event.text, ms: total, intent: event.intent, breakdown });
      setHistory((current) => [entry, ...current].slice(0, 50));
      setPendingFailure(null);
      if (event.type === "paste-failed") {
        stateRef.current = "error";
        setState("error");
        notify(event.message, false);
        // 处理状态要退出来，不能停在 error 上；回 idle 后用户可以直接再按快捷键开新一轮。
        setTimeout(() => setState((current) => (current === "error" ? "idle" : current)), 1200);
        return;
      }
      notify(event.warning ? `已按识别原文完成：${event.warning}` : event.insertedRaw ? "已插入识别原文" : "已完成", !event.warning);
      setState("done");
      setPhase("done");
      // 关掉「自动粘贴」时仍然要复制：否则用户既看不到文字，也拿不到文字。
      if (!event.pasted && event.text) navigator.clipboard.writeText(event.text).catch(() => {});
      setTimeout(() => setState((current) => (current === "done" ? "idle" : current)), 680);
    }
  };

  useEffect(() => {
    if (isTauri()) setWindowLabel(getCurrentWindow().label);
  }, []);

  // 启动配置：桌面版以 settings.json 为准；只有它为空时才把旧 localStorage 迁移一次。
  useEffect(() => {
    let disposed = false;
    const hydrate = async () => {
      const notices = [];
      let raw = null;
      if (isTauri()) {
        try {
          raw = await desktopInvoke("load_settings", {}, () => ({}));
        } catch (error) {
          raw = null;
          notices.push(`读取配置失败，已使用默认值：${describeError(error)}`);
        }
      }
      if (!hasStoredSettings(raw)) {
        let legacy = null;
        try {
          legacy = JSON.parse(localStorage.getItem("typefree-windows.settings") || "null");
        } catch {
          legacy = null;
        }
        if (hasStoredSettings(legacy)) raw = legacy;
      }
      const { settings: normalized, notices: migrationNotices } = normalizeSettings(raw);
      notices.push(...migrationNotices);

      let skills = [];
      try {
        const loaded = await skillStoreRef.current.load();
        skills = loaded.skills;
        if (loaded.rejected) notices.push(`有 ${loaded.rejected} 个自定义写法未通过校验，已跳过。`);
      } catch (error) {
        notices.push(describeError(error));
      }

      let next = normalized;
      if (normalized.processingMode === "skill" && !findSkill(normalized.selectedSkillId, skills)) {
        // 选中的 Skill 不在了就回退自动整理，而不是把用户送进一条注定走不通的路径。
        next = { ...normalized, processingMode: "smart", selectedSkillId: "" };
        notices.push("之前选择的写法已不存在，已恢复自动整理。");
      }

      if (isTauri()) {
        try {
          const status = await desktopInvoke("get_phrase_shortcut_status", {});
          if (status.error) notices.push(status.error);
          if (status.shortcut !== next.phraseShortcut) next = { ...next, phraseShortcut: status.shortcut };
        } catch (error) { notices.push(`读取短语快捷键失败：${describeError(error)}`); }
      }
      if (disposed) return;
      setCustomSkills(skills);
      setSettings(next);
      setHydrated(true);
      if (notices.length) notify(notices.join(" "), false);
    };
    hydrate();
    return () => { disposed = true; };
  }, []);

  // 读完才允许落盘：否则初始默认值会抢先覆盖已有的 settings.json。
  useEffect(() => {
    if (!isTauri() || windowLabel !== "main" || !hydrated) return;
    desktopInvoke("get_launch_at_login", {}).then((enabled) => {
      setSettings((current) => current.launchAtLogin === enabled ? current : { ...current, launchAtLogin: enabled });
    }).catch((error) => notify(`读取登录启动状态失败：${describeError(error)}`, false));
  }, [hydrated, windowLabel]);

  useEffect(() => {
    if (!hydrated || windowLabel !== "main") return;
    const persisted = toPersistedSettings(settings);
    if (!isTauri()) {
      try {
        localStorage.setItem("typefree-windows.settings", JSON.stringify(persisted));
      } catch {
        // 浏览器预览里存储不可用不影响主流程。
      }
      return;
    }
    desktopInvoke("save_settings", { settings: persisted }, true).catch((error) => notify(`保存设置失败：${describeError(error)}`, false));
  }, [settings, hydrated, windowLabel]);

  useEffect(() => {
    if (!isTauri() || windowLabel !== "main") return undefined;
    refreshRecoverableAudio();
  }, [windowLabel]);

  useEffect(() => {
    if (!isTauri() || windowLabel !== "main") return undefined;
    let disposed = false;
    const load = async () => {
      try {
        let entries = await desktopInvoke("load_history", {});
        if (entries === null) {
          const legacy = JSON.parse(localStorage.getItem("typefree-windows.history") || "null");
          entries = Array.isArray(legacy) ? legacy : [];
          // 先写入并由后端重新解密确认，再清除旧明文。
          await desktopInvoke("save_history", { entries, retentionDays: settingsRef.current.historyRetentionDays });
          localStorage.removeItem("typefree-windows.history");
        }
        persistedHistoryRef.current = entries;
        const days = settingsRef.current.historyRetentionDays;
        const cutoff = Date.now() - days * 86_400_000;
        entries = days === 0 ? entries : entries.filter((item) => Number(item.savedAt || String(item.id).split("-")[0]) >= cutoff);
        if (!disposed) { setHistory(entries); setHistoryReady(true); }
      } catch (error) {
        if (!disposed) notify(`历史载入失败，已暂停录音以保护旧记录：${describeError(error)}`, false);
      }
    };
    load();
    return () => { disposed = true; };
  }, [windowLabel]);

  useEffect(() => {
    if (!historyReady || windowLabel !== "main") return;
    if (!isTauri()) {
      try { localStorage.setItem("typefree-windows.history", JSON.stringify(history)); } catch { /* 浏览器预览可无持久存储。 */ }
      return;
    }
    historyWriteRef.current = historyWriteRef.current.catch(() => {}).then(async () => {
      const oldAudio = new Set(persistedHistoryRef.current.map((entry) => entry.audioSessionId).filter(Boolean));
      const keptAudio = new Set(history.map((entry) => entry.audioSessionId).filter(Boolean));
      await desktopInvoke("save_history", { entries: history, retentionDays: settings.historyRetentionDays });
      for (const sessionId of oldAudio) {
        if (!keptAudio.has(sessionId)) await desktopInvoke("release_native_audio", { sessionId });
      }
      await desktopInvoke("cleanup_history_audio", { keptSessionIds: [...keptAudio] });
      persistedHistoryRef.current = history;
      refreshRecoverableAudio();
    });
    historyWriteRef.current.catch((error) => notify(`历史未能保存：${describeError(error)}`, false));
  }, [history, historyReady, settings.historyRetentionDays, windowLabel]);

  useEffect(() => {
    if (windowLabel !== "main") return undefined;
    let disposed = false;
    vocabularyStoreRef.current.load().then(() => {
      if (!disposed) { vocabularyReadyRef.current = true; setVocabularyReady(true); }
    }).catch((error) => notify(`词库未能载入：${describeError(error)}`, false));
    const listener = isTauri() ? listen("vocabulary-correction", (event) => {
      if (!settingsRef.current.autoLearn || !vocabularyReadyRef.current) return;
      let learned = [];
      vocabularyStoreRef.current.update((current) => {
        if (!settingsRef.current.autoLearn) return current;
        const result = learnCorrections(current, { ...event.payload, vocabulary: settingsRef.current.vocabulary });
        learned = result.learned;
        return result.state;
      }).then(() => {
        if (learned.length) notify(`已记住：${learned.map((x) => `${x.variant} → ${x.target}`).join("、")}。可在个人词库删除。`, true);
      }).catch((error) => notify(`词汇未保存：${describeError(error)}`, false));
    }) : null;
    return () => { disposed = true; if (listener) listener.then((off) => off()); };
  }, [windowLabel]);

  useEffect(() => {
    if (windowLabel === "main" && hydrated && !settings.autoLearn) desktopInvoke("stop_learning_monitor", {}, true).catch(() => {});
  }, [settings.autoLearn, hydrated, windowLabel]);

  const dismissWord = async (pair) => {
    try {
      await vocabularyStoreRef.current.update((current) => dismissCorrection(current, pair));
      notify("词条已删除，不再自动学习这项纠正", true);
    } catch (error) { notify(describeError(error), false); }
  };

  const teachCorrection = async (item, edited) => {
    if (!vocabularyReadyRef.current) throw new Error("词库尚未就绪，未保存纠正");
    let learned = [];
    await vocabularyStoreRef.current.update((current) => {
      const result = learnCorrections(current, { original: item.text, edited, sessionId: `manual-${item.id}`, manual: true, vocabulary: settingsRef.current.vocabulary });
      learned = result.learned;
      if (!learned.length) throw new Error("没有可记住的新短词：可能已存在、与手动词冲突、词库已满，或修改包含整句/数字。可在个人词库手动添加。");
      return result.state;
    });
    setHistory((current) => current.map((entry) => entry.id === item.id ? { ...entry, text: edited } : entry));
    notify(`已记住 ${learned.length} 条纠正，下次口述生效`, true);
  };

  const onSelectSkill = (id) => {
    if (!id) {
      setSettings({ ...settingsRef.current, processingMode: "smart", selectedSkillId: "" });
      return;
    }
    if (!findSkill(id, customSkillsRef.current)) {
      setSettings({ ...settingsRef.current, processingMode: "smart", selectedSkillId: "" });
      return;
    }
    setSettings({ ...settingsRef.current, processingMode: "skill", selectedSkillId: id });
  };

  const onSelectActionSkill = (id) => {
    if (!id) {
      setSettings({ ...settingsRef.current, actionType: "translate", actionSkillId: "" });
      return;
    }
    if (!findSkill(id, customSkillsRef.current)) return;
    setSettings({ ...settingsRef.current, actionType: "skill", actionSkillId: id });
    notify(`已绑定动作快捷键：${displayShortcut(settingsRef.current.actionShortcut)}`, true);
  };

  const saveCustomSkills = async (next) => {
    // skillStore.save 返回后端归一化后的数组（丢掉了不合格项），必须回写 state，
    // 否则界面显示的仍是用户提交的那一份，与磁盘内容不一致。
    const normalized = await skillStoreRef.current.save(next);
    setCustomSkills(normalized);
    const current = settingsRef.current;
    const removedDefault = current.selectedSkillId && !findSkill(current.selectedSkillId, normalized);
    const removedAction = current.actionSkillId && !findSkill(current.actionSkillId, normalized);
    if (removedDefault || removedAction) {
      setSettings({
        ...current,
        processingMode: removedDefault ? "smart" : current.processingMode,
        selectedSkillId: removedDefault ? "" : current.selectedSkillId,
        actionType: removedAction ? "translate" : current.actionType,
        actionSkillId: removedAction ? "" : current.actionSkillId,
      });
      notify("所选写法已删除，相关入口已恢复默认设置。", false);
    }
    return normalized;
  };

  const retryTask = async () => {
    if (!pendingFailure || retrying) return;
    setRetrying(true);
    try {
      const retry = pendingFailure.kind === "asr" ? pipeline.retryAudio({
        audioSessionId: pendingFailure.audioSessionId,
        intent: pendingFailure.intent,
        skillId: pendingFailure.skillId,
        skillDelivery: pendingFailure.skillDelivery,
        settings: { ...settingsRef.current, learnedEntries: vocabularyRef.current.entries },
        customSkills: customSkillsRef.current,
        audioMs: pendingFailure.audioMs,
        windowContext: pendingFailure.windowContext,
      }) : pipeline.retry({
        intent: pendingFailure.intent,
        skillId: pendingFailure.skillId,
        skillDelivery: pendingFailure.skillDelivery,
        rawText: pendingFailure.rawText,
        settings: { ...settingsRef.current, learnedEntries: vocabularyRef.current.entries },
        customSkills: customSkillsRef.current,
        audioMs: pendingFailure.audioMs,
        windowContext: pendingFailure.windowContext,
        translationLanguage: pendingFailure.translationLanguage,
      });
      const result = await retry;
      if (result?.ok) setPendingFailure(null);
      refreshRecoverableAudio();
    } finally {
      setRetrying(false);
    }
  };

  const closeFailure = () => {
    setPendingFailure(null);
  };

  const recoverAudio = async (item) => {
    if (retrying || busy) return;
    setRetrying(true);
    try {
      const result = await pipeline.retryAudio({
        audioSessionId: item.sessionId,
        // 重启后 pendingFailure 已丢，spool 里落盘的 intent 是唯一来源；
        // 老录音没有这份元数据，按听写处理。
        intent: item.intent || "dictation",
        settings: { ...settingsRef.current, learnedEntries: vocabularyRef.current.entries },
        customSkills: customSkillsRef.current,
        audioMs: item.audioMs,
      });
      if (result?.ok) setPendingFailure(null);
    } finally {
      setRetrying(false);
      refreshRecoverableAudio();
    }
  };

  const discardAudio = async (item) => {
    if (!window.confirm("丢弃这段可恢复录音？此操作无法撤销。")) return;
    try {
      await desktopInvoke("release_native_audio", { sessionId: item.sessionId });
      setRecoverableAudio((current) => current.filter((entry) => entry.sessionId !== item.sessionId));
      if (pendingFailure?.audioSessionId === item.sessionId) setPendingFailure(null);
    } catch (error) { notify(`丢弃录音失败：${describeError(error)}`, false); }
  };

  const insertRawText = async () => {
    if (!pendingFailure) return;
    const result = await pipeline.insertRaw({
      intent: pendingFailure.intent,
        skillId: pendingFailure.skillId,
        skillDelivery: pendingFailure.skillDelivery,
      rawText: pendingFailure.rawText,
      settings: { ...settingsRef.current, learnedEntries: vocabularyRef.current.entries },
      customSkills: customSkillsRef.current,
      audioMs: pendingFailure.audioMs,
      windowContext: pendingFailure.windowContext,
    });
    if (result && result.ok === false) notify(result.message || "未能输入原文", false);
    else setPendingFailure(null);
  };

  useEffect(() => {
    if (!isTauri() || windowLabel !== "overlay") return undefined;
    const unlisten = listen("dictation-state", (event) => {
      const payload = event.payload || {};
      setState(payload.state || "idle");
      setIntent(payload.intent || "");
      setPhase(payload.phase || "idle");
    });
    const unlistenLevel = listen("dictation-level", (event) => setAudioLevel(event.payload));
    return () => { unlisten.then((fn) => fn()); unlistenLevel.then((fn) => fn()); };
  }, [windowLabel]);

  useEffect(() => {
    if (!isTauri() || windowLabel !== "main") return undefined;
    const unlistenStream = listen("answer-stream", (event) => {
      const payload = event.payload || {};
      if (!payload.text || !pipeline.isCurrent(payload.requestId)) return;
      const card = { question: payload.question, answer: payload.text, requestId: payload.requestId, kind: "ask", title: "提问", streaming: true };
      setAnswerCard(card);
      if (streamingAnswerIdRef.current !== payload.requestId) {
        streamingAnswerIdRef.current = payload.requestId;
        desktopInvoke("show_answer_card", card, true).catch((error) => notify(describeError(error), false));
      }
    });
    const unlistenDismiss = listen("dismiss-result-card", (event) => {
      if (pipeline.isCurrent(event.payload?.requestId)) cancelRef.current();
      if (answerCardRef.current?.requestId === event.payload?.requestId) setAnswerCard(null);
    });
    const unlistenDictation = listen("toggle-dictation", () => toggleRef.current("dictation"));
    const unlistenAsk = listen("toggle-ask", () => toggleRef.current("ask"));
    const unlistenAction = listen("toggle-action", () => toggleRef.current("action"));
    const unlistenPhrase = listen("quick-phrase-result", (event) => notify(event.payload.message, event.payload.ok));
    const unlistenStop = listen("stop-recording", () => stopRef.current());
    const unlistenCancel = listen("cancel-recording", () => cancelRef.current());
    const unlistenShortcut = listen("shortcut-register-failed", (event) => {
      const list = Array.isArray(event.payload) ? event.payload : [];
      notify(list.length ? `快捷键注册失败：${list.join("；")}` : "快捷键注册失败", false);
    });
    return () => {
      unlistenStream.then((fn) => fn());
      unlistenDismiss.then((fn) => fn());
      unlistenDictation.then((fn) => fn());
      unlistenAsk.then((fn) => fn());
      unlistenAction.then((fn) => fn());
      unlistenPhrase.then((fn) => fn());
      unlistenStop.then((fn) => fn());
      unlistenCancel.then((fn) => fn());
      unlistenShortcut.then((fn) => fn());
    };
  }, [windowLabel]);

  useEffect(() => {
    if (!isTauri() || windowLabel !== "answer") return undefined;
    const unlisten = listen("ask-answer", (event) => setAnswerCard(event.payload));
    const unlistenClose = listen("answer-window-close", () => closeAnswerRef.current());
    const unlistenStream = listen("answer-stream", (event) => {
      const payload = event.payload || {};
      setAnswerCard((current) => current?.requestId === payload.requestId ? { ...current, answer: payload.text, streaming: true } : current);
    });
    desktopInvoke("get_answer_card", {}, null).then((card) => { if (card) setAnswerCard(card); }).catch(() => {});
    return () => { unlisten.then((fn) => fn()); unlistenStream.then((fn) => fn()); unlistenClose.then((fn) => fn()); };
  }, [windowLabel]);

  useEffect(() => {
    if (!isTauri() || windowLabel !== "main") return;
    // intent 与 phase 一起发给悬浮窗：只发状态串的话，用户分不清这次是口述还是命令、
    // 也分不清「正在识别」和「正在整理文字」。
    desktopInvoke("set_overlay_state", { state, intent, phase }, true).catch(() => {});
  }, [state, intent, phase, windowLabel]);

  useEffect(() => {
    if (!isTauri() || windowLabel !== "main" || state !== "recording") return;
    // 电平来自采集层，主窗口不自己再算一遍：两处各算一次只会让悬浮窗和主界面打架。
    emit("dictation-level", recorder.level).catch(() => {});
  }, [recorder.level, state, windowLabel]);

  useEffect(() => { setOnline(false); }, [settings.asrEndpoint, settings.asrModel]);

  const testConnection = async () => {
    if (!isTauri()) {
      notify("浏览器预览没有发起连接请求。请在桌面应用中测试语音服务。", false);
      return;
    }
    const endpoint = settingsRef.current.asrEndpoint;
    const model = settingsRef.current.asrModel;
    const stillCurrent = () => endpoint === settingsRef.current.asrEndpoint && model === settingsRef.current.asrModel;
    setTesting(true);
    setNotice(null);
    try {
      await desktopInvoke("test_connection", { endpoint, model });
      if (stillCurrent()) { setOnline(true); notify("语音服务测试通过", true); }
    } catch (error) {
      if (stillCurrent()) { setOnline(false); notify(describeError(error), false); }
    } finally {
      setTesting(false);
    }
  };

  const textReady = Boolean(settings.textEndpoint && settings.textModel);
  const busy = state === "recording" || state === "processing";

  const closeAnswer = () => {
    if (answerCard?.streaming && answerCard.requestId) {
      desktopInvoke("cancel_text_request", { requestId: answerCard.requestId }, true).catch(() => {});
      if (windowLabel === "main" && pipeline.isCurrent(answerCard.requestId)) cancelTask();
    }
    if (isTauri()) emit("dismiss-result-card", { requestId: answerCard?.requestId }).catch(() => {});
    if (followupRequestIdRef.current) desktopInvoke("cancel_text_request", { requestId: followupRequestIdRef.current }, true).catch(() => {});
    followupRequestIdRef.current = null;
    setAnswerCard(null);
    if (isTauri()) desktopInvoke("hide_answer_card", { requestId: answerCard?.requestId }, true).catch(() => {});
  };

  closeAnswerRef.current = closeAnswer;

  const followupAnswer = async ({ turns, question, onDelta }) => {
    const current = settingsRef.current;
    if (!current.textEndpoint || !current.textModel) throw new Error("请先设置文字服务");
    const requestId = `followup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    followupRequestIdRef.current = requestId;
    const system = buildMessages({ task: "ask", instruction: ASK_INSTRUCTION, rawText: turns[0]?.question || question })[0];
    const messages = [system];
    for (const turn of turns.slice(-8)) {
      messages.push({ role: "user", content: String(turn.question).slice(0, 2000) });
      if (turn.answer) messages.push({ role: "assistant", content: String(turn.answer).slice(0, 6000) });
    }
    messages.push({ role: "user", content: question.slice(0, 2000) });
    const off = isTauri() ? await listen("answer-stream", (event) => {
      if (event.payload?.requestId === requestId) onDelta(event.payload.text);
    }) : () => {};
    try {
      const fallback = String(current.textFallbackModels || "").split(/[\n,，]/).map((name) => name.trim()).filter(Boolean).slice(0, 5);
      const models = [...new Set([current.textModel, ...fallback])];
      for (const [index, model] of models.entries()) {
        try {
          const result = await desktopInvoke("stream_answer", { request: {
            requestId, task: "ask", rawText: question, endpoint: current.textEndpoint,
            model, timeoutMs: current.textTimeoutMs,
            authMode: current.textAuthMode, messages,
          } }, () => ({ text: "这是浏览器预览中的追问回答。" }));
          return result.text;
        } catch (error) {
          const transient = /超时|无法连接|请求失败|额度用尽|HTTP (429|500|502|503|504)/i.test(describeError(error));
          if (!transient || index === models.length - 1) throw error;
          onDelta("");
        }
      }
      throw new Error("文字模型没有返回回答");
    } finally { off(); if (followupRequestIdRef.current === requestId) followupRequestIdRef.current = null; }
  };

  const clearHistory = () => {
    if (window.confirm("清空本机保存的全部历史记录？此操作无法撤销。")) {
      setHistory([]);
      setLastResult(null);
    }
  };

  const exportHistory = async () => {
    try {
      if (isTauri()) {
        await historyWriteRef.current;
        const path = await desktopInvoke("export_history", {});
        notify(`历史已导出到 ${path}`, true);
      } else {
        const url = URL.createObjectURL(new Blob([JSON.stringify(history, null, 2)], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = `${BRAND.name}-历史记录.json`;
        link.click();
        URL.revokeObjectURL(url);
      }
    } catch (error) { notify(`导出失败：${describeError(error)}`, false); }
  };

  const changeHistoryRetention = (days) => {
    setSettings({ ...settingsRef.current, historyRetentionDays: days });
    if (days > 0) {
      const cutoff = Date.now() - days * 86_400_000;
      setHistory((current) => current.filter((item) => Number(item.savedAt || String(item.id).split("-")[0]) >= cutoff));
    }
  };

  const retranscribeHistory = async (item) => {
    if (!item.audioSessionId || busy || retrying) return;
    setRetrying(true);
    try {
      await pipeline.retryAudio({
        audioSessionId: item.audioSessionId,
        intent: item.intent,
        skillId: item.skillId,
        skillDelivery: item.skillDelivery,
        settings: { ...settingsRef.current, learnedEntries: vocabularyRef.current.entries },
        customSkills: customSkillsRef.current,
        audioMs: 0,
        windowContext: item.windowContext,
        preserveAudio: true,
      });
    } finally { setRetrying(false); }
  };

  if (windowLabel === "answer") {
    return <AnswerCard card={answerCard} onClose={closeAnswer} onFollowup={followupAnswer} />;
  }

  if (windowLabel === "overlay") {
    return (
      <Overlay
        state={state}
        level={audioLevel}
        intent={intent}
        phase={phase}
        onStop={() => {
          if (isTauri()) return emit("stop-recording");
          setPhase("asr"); setState("processing");
        }}
        onCancel={() => {
          if (isTauri()) return emit("cancel-recording");
          setState("idle"); setPhase("idle");
        }}
      />
    );
  }

  return (
    <main className="app-shell">
      <Sidebar page={page} setPage={setPage} online={online} />
      <section className="workspace" ref={workspaceRef}>
        <div className="topbar">
          <span><StatusDot online={online} />{online ? "语音服务已通过测试" : "语音服务尚未测试"}</span>
          <button className="mini-shortcut" title="语音输入" onClick={() => toggleTask("dictation")} disabled={state === "processing" || (state === "recording" && currentTriggerRef.current !== "dictation")}><Microphone size={16} weight="fill" />{displayShortcut(settings.shortcut)}</button>
          <button className="mini-shortcut" title="提问" onClick={() => toggleTask("ask")} disabled={state === "processing" || (state === "recording" && currentTriggerRef.current !== "ask")}><Command size={16} />{displayShortcut(settings.askShortcut)}</button>
          <button className="mini-shortcut" title={actionName(settings, customSkills)} onClick={() => toggleTask("action")} disabled={state === "processing" || (state === "recording" && currentTriggerRef.current !== "action")}><PuzzlePiece size={16} />{displayShortcut(settings.actionShortcut)}</button>
        </div>

        {pendingFailure && (
          <div className="panel failure-panel">
            <div className="panel-title slim">
              <div>
                <h2>{pendingFailure.kind === "asr" ? "语音识别未完成" : "文字处理未完成"}</h2>
                <p>{pendingFailure.message}{FAILURE_HINTS[pendingFailure.errorKind] || ""}{["command", "ask"].includes(pendingFailure.intent) ? " · 原始问题或命令不会输入到当前窗口" : ""}</p>
              </div>
              <button className="icon-button" onClick={closeFailure} title="关闭"><X size={16} /></button>
            </div>
            {pendingFailure.kind !== "asr" && <div className="preview-box">
              <span className="preview-label">{pendingFailure.intent === "ask" ? "识别到的问题" : pendingFailure.intent === "command" ? "识别到的命令" : "识别到的原文"}</span>
              <p>{pendingFailure.rawText}</p>
            </div>}
            <div className="form-actions">
              {pendingFailure.kind !== "asr" && !["command", "ask"].includes(pendingFailure.intent) && (
                <button className="button secondary" onClick={insertRawText} disabled={busy}><TextT size={17} />输入原文</button>
              )}
              {pendingFailure.kind !== "asr" && <button className="button secondary" onClick={() => navigator.clipboard.writeText(pendingFailure.rawText)}><ClipboardText size={17} />复制原文</button>}
              <button className="button primary" onClick={retryTask} disabled={busy || retrying}>
                {retrying ? <ArrowClockwise className="spin" size={17} /> : <Repeat size={17} />}
                {retrying ? "正在重试" : pendingFailure.kind === "asr" ? "重新识别" : "重试"}
              </button>
            </div>
          </div>
        )}

        {recoverableAudio.filter((item) => item.sessionId !== pendingFailure?.audioSessionId).map((item) => (
          <div className="panel failure-panel" key={item.sessionId}>
            <div className="panel-title slim"><div><h2>待处理录音</h2><p>{item.error || `约 ${Math.ceil(item.audioMs / 1000)} 秒，已由 Windows 加密保存在本机。`}</p></div></div>
            <div className="form-actions">
              <button className="button secondary" onClick={() => discardAudio(item)} disabled={busy || retrying}>丢弃录音</button>
              <button className="button primary" onClick={() => recoverAudio(item)} disabled={busy || retrying || Boolean(item.error)}>{retrying ? "正在识别" : "重新识别"}</button>
            </div>
          </div>
        ))}

        {page === "appearance" && <AppearanceSettings settings={settings} setSettings={setSettings} ready={hydrated} onReplayEntrance={onReplayEntrance} />}
        {page === "home" && <Overview settings={settings} customSkills={customSkills} online={online} setPage={setPage} state={state} intent={intent} phase={phase} activeTrigger={currentTriggerRef.current} toggleTask={toggleTask} lastResult={lastResult} textReady={textReady} level={recorder.level} />}
        {page === "model" && <ModelSettings settings={settings} setSettings={setSettings} online={online} testing={testing} testConnection={testConnection} onNotice={notify} onSpeechKeySaved={() => setOnline(false)} />}
        {page === "writing" && <WritingSettings settings={settings} setSettings={setSettings} customSkills={customSkills} onSelectSkill={onSelectSkill} textReady={textReady} />}
        {page === "skills" && <SkillEditor customSkills={customSkills} selectedSkillId={settings.actionType === "skill" ? settings.actionSkillId : ""} dailySkillId={settings.processingMode === "skill" ? settings.selectedSkillId : ""} onSelect={onSelectActionSkill} onSelectDaily={onSelectSkill} onRun={(id) => toggleTask("skill", id)} running={state === "recording" && currentTriggerRef.current === "skill"} onDeliveryChange={(value) => setSettings({ ...settingsRef.current, skillDelivery: value })} onSaveCustomSkills={saveCustomSkills} pipeline={pipeline} settings={settings} onNotice={notify} busy={busy} />}
        {page === "shortcut" && <ShortcutSettings settings={settings} setSettings={setSettings} customSkills={customSkills} onNotice={notify} busy={busy} />}
        {page === "vocabulary" && <VocabularySettings settings={settings} setSettings={setSettings} vocabulary={vocabulary} onDismiss={dismissWord} ready={vocabularyReady} />}
        {page === "history" && <History history={history} onClear={clearHistory} onTeach={teachCorrection} onExport={exportHistory} onRetranscribe={retranscribeHistory} retentionDays={settings.historyRetentionDays} onRetentionChange={changeHistoryRetention} keepAudio={settings.keepHistoryAudio} onKeepAudioChange={(value) => setSettings({ ...settingsRef.current, keepHistoryAudio: value })} busy={busy || retrying} />}
      </section>
      {notice && (
        <div className={`toast ${notice.ok ? "success" : ""}`}>
          {notice.ok ? <CheckCircle size={18} weight="fill" /> : <WarningCircle size={18} weight="fill" />}
          {notice.text}
          <button onClick={() => setNotice(null)}><X size={15} /></button>
        </div>
      )}
      {!isTauri() && answerCard && <div className="answer-preview"><AnswerCard card={answerCard} onClose={closeAnswer} onFollowup={followupAnswer} /></div>}
    </main>
  );
}
