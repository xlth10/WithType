// 页面、HUD、入口与状态装配。
//
// 这个文件只做「接线」：录音在 dictation/useWavRecorder，任务与上屏在 dictation/pipeline，
// 本地文字处理在 text/。App.jsx 自己不做 WAV 编码、不调 paste_text、不改写文本——
// 一旦这里出现第二个上屏入口，取消竞态和「命令失败不落原文」这两条约定就会被绕过。

import { useEffect, useRef, useState } from "react";
import {
  ArrowClockwise,
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
import { SkillEditor } from "./components/SkillEditor.jsx";
import { AnswerCard } from "./components/AnswerCard.jsx";
import { TextSettings } from "./components/TextSettings.jsx";
import { createPipeline } from "./dictation/pipeline.js";
import { useWavRecorder } from "./dictation/useWavRecorder.js";
import { displayShortcut, shortcutFromKeydown, shortcutIdentity } from "./shortcuts/capture.js";
import { BUILTIN_SKILLS, findBuiltinSkill } from "./text/builtinSkills.js";
import { createSkillStore } from "./text/skillStore.js";
import {
  DEFAULT_SETTINGS,
  PROCESSING_MODES,
  hasStoredSettings,
  normalizeSettings,
  toPersistedSettings,
} from "./text/settingsMigration.js";

const MODE_META = {
  original: { label: "原文", detail: "保留原句，使用个人词库", icon: Waveform },
  corrected: { label: "术语纠错", detail: "本地词典替换", icon: BookOpenText },
  clean: { label: "轻度整理", detail: "去口头禅与断句", icon: Sparkle },
  smart: { label: "智能整理", detail: "词典之后调用文字模型", icon: MagicWand },
  skill: { label: "按技能整理", detail: "持续使用所选技能", icon: PuzzlePiece },
};

const INTENT_META = {
  dictation: { label: "口述", icon: Microphone },
  command: { label: "语音命令", icon: Command },
  ask: { label: "随便问", icon: Command },
  translate: { label: "翻译", icon: TextT },
  skill: { label: "技能", icon: PuzzlePiece },
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

/** 把耗时拆成一句可读的说明，方便对着「慢在哪一步」排查。 */
function breakdownOf(timings = {}) {
  const parts = [];
  if (timings.encodeMs) parts.push(`编码 ${timings.encodeMs} ms`);
  parts.push(`识别 ${timings.asrMs || 0} ms`);
  if (timings.textMs) parts.push(`整理 ${timings.textMs} ms`);
  if (timings.pasteMs) parts.push(`上屏 ${timings.pasteMs} ms`);
  return parts.join(" · ");
}

/** 悬浮窗与概览共用的状态文案：录音、识别、整理文字、生成内容必须是四件能说清的事。 */
function statusLabel(state, intent, phase) {
  if (state === "recording") return intent === "ask" ? "正在听你提问" : "正在录音";
  if (state === "processing") {
    if (phase === "classify") return "正在判断口述类型";
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
  if (settings.actionType === "skill") return findSkill(settings.actionSkillId, customSkills)?.name || "选择技能";
  return settings.actionType === "command" ? "语音命令" : "翻译";
}

function windowName(context) {
  if (!context || typeof context !== "object") return "";
  const app = String(context.app || "").trim();
  const title = String(context.title || "").trim();
  return [app, title].filter(Boolean).join(" · ");
}

function Logo({ size = 34 }) {
  return <img className="brand-icon" style={{ width: size, height: size }} src="/assets/typefree-windows-icon.svg" alt="" />;
}

function StatusDot({ online }) {
  return <span className={`status-dot ${online ? "online" : "offline"}`} aria-hidden="true" />;
}

function Overlay({ state, level, intent, phase, onStop, onCancel }) {
  const label = statusLabel(state, intent, phase);
  return (
    <main className="overlay-shell">
      <section className={`voice-hud ${state} ${intent || "dictation"}`} aria-label={label} title={label}>
        <VoiceMotion state={state} level={level} />
        {state === "done" && <Check className="hud-symbol success" size={18} weight="bold" />}
        {state === "error" && <WarningCircle className="hud-symbol error" size={19} weight="fill" />}
        {intent && intent !== "dictation" && state !== "idle" && <span className="hud-badge">{INTENT_META[intent]?.label || "口述"}</span>}
        <div className="hud-controls">
          {state === "recording" && <button onClick={onStop} aria-label="结束录音"><Stop size={15} weight="fill" /></button>}
          <button onClick={onCancel} aria-label="取消或关闭"><X size={16} /></button>
        </div>
      </section>
    </main>
  );
}

function Sidebar({ page, setPage, online }) {
  const items = [
    ["home", House, "概览"],
    ["model", Waveform, "语音模型"],
    ["writing", Sparkle, "文字整理"],
    ["vocabulary", BookOpenText, "个人词库"],
    ["text", TextT, "文字模型"],
    ["skills", PuzzlePiece, "技能"],
    ["shortcut", Keyboard, "快捷键"],
    ["history", ClockCounterClockwise, "历史记录"],
  ];
  return (
    <aside className="sidebar">
      <div className="brand-row"><Logo /><div><strong>Typefree Windows</strong><span>非官方 · 声音写作</span></div></div>
      <nav>
        {items.map(([id, Icon, label]) => (
          <button className={page === id ? "active" : ""} key={id} onClick={() => setPage(id)}>
            <Icon size={19} weight={page === id ? "fill" : "regular"} />{label}
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="privacy-line"><ShieldCheck size={17} weight="fill" /><span>音频发送到已配置的语音服务</span></div>
        <div className="server-line"><StatusDot online={online} /><span>{online ? "ASR 服务正常" : "尚未测试连接"}</span></div>
      </div>
    </aside>
  );
}

function Field({ label, hint, children }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

function Toggle({ checked, onChange, disabled = false }) {
  return <button type="button" className={`toggle ${checked ? "on" : ""}`} onClick={() => onChange(!checked)} aria-pressed={checked} disabled={disabled}><i /></button>;
}

function ModelSettings({ settings, setSettings, online, testing, testConnection, onNotice }) {
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const saveKey = async () => {
    if (!key.trim()) {
      onNotice({ text: "请先填写要保存的 ASR API Key", ok: false });
      return;
    }
    setSaving(true);
    try {
      await desktopInvoke("save_api_key", { key });
      setKey("");
      onNotice({ text: "ASR API Key 已保存到系统凭据库", ok: true });
    } catch (error) {
      onNotice({ text: describeError(error), ok: false });
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="page-content">
      <header className="page-heading"><div><span className="eyebrow">服务连接</span><h1>语音模型</h1><p>填写已部署的语音服务地址。文字处理服务在「文字模型」中单独配置。</p></div><div className={`connection-badge ${online ? "success" : ""}`}><StatusDot online={online} />{online ? "连接正常" : "等待测试"}</div></header>
      <div className="panel form-panel">
        <div className="panel-title"><div className="icon-tile"><Waveform size={22} weight="bold" /></div><div><h2>Qwen3-ASR-1.7B</h2><p>OpenAI 兼容语音转写接口</p></div></div>
        <div className="form-grid">
          <Field label="API 地址" hint="填写到 /v1 即可，例如 http://10.0.0.8:8000/v1"><input value={settings.asrEndpoint} onChange={(e) => setSettings({ ...settings, asrEndpoint: e.target.value })} /></Field>
          <Field label="模型名称"><input value={settings.asrModel} onChange={(e) => setSettings({ ...settings, asrModel: e.target.value })} /></Field>
          <Field label="API Key" hint="保存后写入 Windows 凭据库，不进入配置文件"><div className="input-with-icon"><Key size={18} /><input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="已保存则留空" /></div></Field>
        </div>
        <div className="form-actions"><button className="button secondary" onClick={testConnection} disabled={testing}>{testing ? <ArrowClockwise className="spin" size={18} /> : <PaperPlaneTilt size={18} />}{testing ? "正在连接" : "测试连接"}</button><button className="button primary" onClick={saveKey} disabled={saving}><LockKey size={18} weight="fill" />保存密钥</button></div>
      </div>
      <div className="note-card"><ShieldCheck size={22} weight="fill" /><div><strong>音频发送范围</strong><p>音频会发送到上方填写的地址。建议使用 HTTPS，或确保设备位于可信 VPN/局域网。</p></div></div>
    </section>
  );
}

function WritingSettings({ settings, setSettings, customSkills, onSelectSkill, textReady }) {
  const needsText = settings.processingMode === "smart" || settings.processingMode === "skill";
  const skills = skillOptions(customSkills);
  return (
    <section className="page-content">
      <header className="page-heading"><div><span className="eyebrow">日常写法</span><h1>整理到刚刚好。</h1><p>从保留原文到重新组织，选一种你常用的处理程度。第三个快捷键另设。</p></div></header>
      <div className="mode-grid">
        {PROCESSING_MODES.map((id) => {
          const item = MODE_META[id];
          const Icon = item.icon;
          return <button key={id} className={`mode-card ${settings.processingMode === id ? "selected" : ""}`} onClick={() => setSettings({ ...settings, processingMode: id })}><span className="mode-icon"><Icon size={21} /></span><strong>{item.label}</strong><small>{item.detail}</small>{settings.processingMode === id && <span className="check-mark"><Check size={13} weight="bold" /></span>}</button>;
        })}
      </div>

      {(settings.processingMode === "skill" || settings.processingMode === "smart") && (
        <div className="panel form-panel compact">
          <div className="panel-title"><div className="icon-tile"><PuzzlePiece size={22} /></div><div><h2>持续使用技能</h2><p>智能整理和技能都需要文字模型；缺少配置时会保留原文并提示。</p></div></div>
          <div className="form-grid">
            <Field label="普通口述的技能" hint="仅当上方选择「按技能整理」时持续生效">
              <select value={settings.processingMode === "skill" ? settings.selectedSkillId : ""} onChange={(event) => onSelectSkill(event.target.value)} disabled={settings.processingMode !== "skill"}>
                <option value="">未选择（智能整理）</option>
                {skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}{skill.source === "builtin" ? "（内置）" : ""}</option>)}
              </select>
            </Field>
          </div>
          {needsText && !textReady && <p className="test-result">尚未配置文字模型地址或模型名称，这两种模式暂时会按原文处理。可前往「文字模型」页填写。</p>}
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
  const fields = { dictation: "shortcut", ask: "askShortcut", action: "actionShortcut" };

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
    const onBlur = () => { if (!captureBusyRef.current) setCaptureKind(null); };
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
      if (!captureReady || result.kind === "waiting") return;
      if (result.kind === "invalid") {
        setCaptureMessage(result.message);
        return;
      }
      const others = Object.entries(fields).filter(([kind]) => kind !== captureKind);
      if (others.some(([, field]) => shortcutIdentity(settings[field]) === shortcutIdentity(result.value))) {
        setCaptureMessage("这个组合键已经被其他入口使用");
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
        onNotice({ text: isTauri() ? "快捷键已更新" : "预览已更新；全局快捷键需在安装版验证", ok: true });
      } catch (error) {
        setCaptureMessage(`未能设置：${describeError(error)}。请换一个组合键。`);
      } finally {
        captureBusyRef.current = false;
        setCaptureBusy(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [captureKind, captureReady, captureBusy, settings.shortcut, settings.askShortcut, settings.actionShortcut]);

  const beginCapture = (kind) => {
    if (busy || captureKind) return;
    captureBusyRef.current = false;
    setCaptureMessage("");
    setCaptureKind(kind);
  };

  const actionLabel = settings.actionType === "skill"
    ? findSkill(settings.actionSkillId, customSkills)?.name || "技能未选择"
    : settings.actionType === "command" ? "语音命令" : "翻译成英文";
  const rows = [
    ["dictation", "语音输入", "说完后输入到当前窗口。"],
    ["ask", "随便问", "口述问题，回答只显示在卡片中。"],
    ["action", actionLabel, "使用绑定的动作，不改变普通口述。"],
  ];

  return (
    <section className="page-content">
      <header className="page-heading"><div><span className="eyebrow">按键与动作</span><h1>按一次开始，再按一次完成。</h1><p>按下全局快捷键开始录音，再按同一个键处理文字。点选按键位可以修改组合键；按 Esc 取消录制新键。</p></div></header>
      <div className="panel settings-list">
        {rows.map(([kind, title, detail]) => (
          <div key={kind} className={captureKind === kind ? "shortcut-row capturing" : "shortcut-row"}>
            <div><strong>{title}</strong><span>{detail}</span></div>
            <div className="shortcut-edit">
              <button
                className={`shortcut-record ${captureKind === kind ? "capturing" : ""}`}
                type="button"
                aria-label={`${title}快捷键，当前 ${displayShortcut(settings[fields[kind]])}，点击后按新组合键`}
                onClick={() => captureKind === kind ? setCaptureKind(null) : beginCapture(kind)}
                disabled={busy || captureBusy || (captureKind !== null && captureKind !== kind)}
              >
                <span>{captureKind === kind ? captureReady ? captureBusy ? "正在设置…" : "请按组合键…" : "准备中…" : displayShortcut(settings[fields[kind]])}</span>
                <small>{captureKind === kind ? "Esc 取消" : "点击更改"}</small>
              </button>
            </div>
          </div>
        ))}
      </div>
      <p className={`shortcut-capture-message ${captureMessage ? "error" : ""}`} role="status" aria-live="polite">
        {captureMessage || (captureKind ? "同时按住 Ctrl、Alt 或 Win，再按字母、数字、空格或 F1–F12。" : "原有快捷键会保留到新组合键设置成功。")}
      </p>
      <div className="panel form-panel compact">
        <div className="panel-title"><div className="icon-tile"><PuzzlePiece size={20} /></div><div><h2>把常用动作放在第三个键上</h2><p>默认翻译；也可以换成一个技能或语音命令。</p></div></div>
        <div className="form-grid">
          <Field label="动作">
            <select value={settings.actionType} onChange={(event) => setSettings({ ...settings, actionType: event.target.value })}>
              <option value="translate">翻译成英文</option>
              <option value="skill">运行技能</option>
              <option value="command">语音命令</option>
            </select>
          </Field>
          {settings.actionType === "skill" && <Field label="技能" hint="只处理这次录音，不改变普通口述的设置">
            <select value={settings.actionSkillId} onChange={(event) => setSettings({ ...settings, actionSkillId: event.target.value })}>
              <option value="">请选择技能</option>
              {skillOptions(customSkills).map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}
            </select>
          </Field>}
        </div>
      </div>
      <div className="panel settings-list">
        <div><div><strong>结果自动输入</strong><span>关闭后复制到剪贴板；随便问始终只显示卡片。</span></div><Toggle checked={settings.autoPaste} onChange={(value) => setSettings({ ...settings, autoPaste: value })} /></div>
        <div><div><strong>自动判断语音命令</strong><span>实验功能：会增加一次文字模型请求。关掉后仍可在第三个入口选择语音命令。</span></div><Toggle checked={settings.autoIntent} onChange={(value) => setSettings({ ...settings, autoIntent: value })} disabled={!settings.textEndpoint || !settings.textModel} /></div>
        <div><div><strong>登录 Windows 后启动</strong><span>暂不可用。</span></div><Toggle checked={false} disabled onChange={() => {}} /></div>
      </div>
    </section>
  );
}

function History({ history, onClear, onTeach }) {
  return (
    <section className="page-content">
      <header className="page-heading"><div><span className="eyebrow">回看</span><h1>最近说过的话</h1><p>保留最近 50 条。应用与窗口名称只存在本机，不发送给模型。</p></div>{history.length > 0 && <button className="button secondary" onClick={onClear}>清空历史</button>}</header>
      <div className="history-list">
        {history.length === 0 && <div className="panel form-panel"><p className="empty-text">这里还没有记录。按快捷键开始录音。</p></div>}
        {history.map((item) => (
          <article key={item.id}>
            <div className="history-main">
              <p>{item.text}</p>
              {item.intent === "dictation" && <HistoryCorrection item={item} onTeach={onTeach} />}
              {item.intent === "ask" && item.rawText && <span>问题：{item.rawText}</span>}
              <span>{item.time} · {(INTENT_META[item.intent] || INTENT_META.dictation).label}{windowName(item.windowContext) ? ` · ${windowName(item.windowContext)}` : ""} · {item.ms} ms{item.breakdown ? ` · ${item.breakdown}` : ""}</span>
            </div>
            <button title="复制" onClick={() => navigator.clipboard.writeText(item.text)}><Copy size={18} /></button>
          </article>
        ))}
      </div>
    </section>
  );
}

function Overview({ settings, customSkills, online, setPage, state, intent, phase, activeTrigger, toggleTask, lastResult, textReady }) {
  const recording = state === "recording";
  const busy = state === "processing";
  const mode = MODE_META[settings.processingMode] || MODE_META.original;
  const locked = (trigger) => recording && activeTrigger !== trigger;
  return (
    <section className="page-content overview">
      <header className="page-heading"><div><span className="eyebrow">从开口开始</span><h1>说出来，写下去。</h1><p>一段话，可以直接落字，也可以先问、先整理。选好入口，再开口。</p></div></header>
      <div className="hero-card">
        <div className="hero-copy">
          <span className={`hero-status ${state}`}>{statusLabel(state, intent, phase)}</span>
          <h2>{recording ? `${INTENT_META[intent]?.label || "口述"}录音中` : "给这段话选个去处"}</h2>
          <p>{recording ? "再按同一个快捷键结束；也可点击按钮结束。" : "在任意应用按一次快捷键说话，再按一次，文字进入光标处。"}</p>
          <div className="hero-actions">
            <button className="button dark" onClick={() => toggleTask("dictation")} disabled={busy || locked("dictation")}>
              {recording && intent === "dictation" ? <Stop size={17} weight="fill" /> : <Microphone size={17} weight="fill" />}
              {recording && activeTrigger === "dictation" ? "结束录音" : "语音输入"}
            </button>
            <button className="button secondary" onClick={() => toggleTask("ask")} disabled={busy || locked("ask")}>
              <Command size={17} />
              {recording && activeTrigger === "ask" ? "结束提问" : "随便问"}
            </button>
            <button className="button secondary" onClick={() => toggleTask("action")} disabled={busy || locked("action")}>
              <PuzzlePiece size={17} />
              {recording && activeTrigger === "action" ? "结束录音" : actionName(settings, customSkills)}
            </button>
          </div>
        </div>
        <div className="hero-visual"><Microphone size={26} weight="regular" /><span>{recording ? "录音中" : "语音输入"}</span></div>
      </div>
      <div className="summary-grid">
        <button className="summary-card" onClick={() => setPage("model")}><span><Waveform size={21} /></span><div><small>语音模型</small><strong>{settings.asrModel || "未配置"}</strong><p>{online ? "连接正常" : "需要测试连接"}</p></div><CheckCircle size={20} weight={online ? "fill" : "regular"} /></button>
        <button className="summary-card" onClick={() => setPage("writing")}><span><mode.icon size={21} /></span><div><small>当前模式</small><strong>{mode.label}</strong><p>{textReady || mode.label === "原文" ? mode.detail : `${mode.detail}（文字模型未配置）`}</p></div><GearSix size={20} /></button>
      </div>
      <div className="last-result panel">
        <div className="panel-title slim">
          <div><h2>最近一次</h2><p>{lastResult ? lastResult.breakdown : "还没有输入记录"}</p></div>
          {lastResult && <button className="icon-button" onClick={() => navigator.clipboard.writeText(lastResult.text)}><Copy size={18} /></button>}
        </div>
        <p className={lastResult ? "result-text" : "empty-text"}>{lastResult?.text || "按一次快捷键开始录音。"}</p>
      </div>
    </section>
  );
}

export function App() {
  const previewParams = new URLSearchParams(window.location.search);
  const overlayPreview = previewParams.get("overlay");
  const cardPreview = previewParams.get("card") === "1";
  const [windowLabel, setWindowLabel] = useState(() => isTauri() ? getCurrentWindow().label : cardPreview ? "answer" : overlayPreview ? "overlay" : "main");
  const [page, setPage] = useState(!isTauri() && ["shortcut", "vocabulary", "history"].includes(previewParams.get("page")) ? previewParams.get("page") : "home");
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [hydrated, setHydrated] = useState(false);
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
    try {
      const stored = JSON.parse(localStorage.getItem("typefree-windows.history") || "null");
      if (Array.isArray(stored)) return stored;
    } catch {
      // 损坏的历史不影响启动，直接当空的处理。
    }
    // 安装版首次运行显示空历史；样例数据只在浏览器预览里出现。
    return isTauri() ? [] : SAMPLE_HISTORY;
  });
  const [online, setOnline] = useState(false);
  const [testing, setTesting] = useState(false);
  const [state, setState] = useState(overlayPreview || "idle");
  const [intent, setIntent] = useState("");
  const [phase, setPhase] = useState("idle");
  const [audioLevel, setAudioLevel] = useState(overlayPreview === "recording" ? Math.max(0, Math.min(1, Number(previewParams.get("level") ?? 0.55) || 0)) : 0);
  const [notice, setNotice] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const [answerCard, setAnswerCard] = useState(cardPreview ? { question: "下周的工作怎么安排？", answer: "先列出必须完成的事项，再按截止时间排优先级。" } : null);
  /** 文字阶段失败后留给用户选择的现场：原文、意图与耗时。 */
  const [pendingFailure, setPendingFailure] = useState(null);
  const [retrying, setRetrying] = useState(false);

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

  const recorder = useWavRecorder({
    onDeviceState: ({ phase: devicePhase }) => {
      if (devicePhase === "recording") setPhase("record");
    },
  });

  const startTask = async (trigger) => {
    if (activeSnapshotRef.current || startingRef.current) return;
    if (stateRef.current === "recording" || stateRef.current === "processing") return;
    if (!hydrated) return;
    const currentSettings = { ...settingsRef.current, learnedEntries: vocabularyRef.current.entries };
    const nextIntent = trigger === "action" ? currentSettings.actionType : trigger;
    if (nextIntent === "skill" && !findSkill(currentSettings.actionSkillId, customSkillsRef.current)) {
      notify("请先为第三个快捷键选择一个技能", false);
      return;
    }
    if (nextIntent !== "dictation" && (!currentSettings.textEndpoint || !currentSettings.textModel)) {
      notify("请先配置文字模型地址和模型名称", false);
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
    // 本次任务的技能与设置在录音开始前固定；不会改变后续口述的默认路径。
    const snapshot = pipeline.begin({
      intent: nextIntent,
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
      await recorder.start();
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

  const toggleTask = (kind) => {
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
    startTask(kind);
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
      return;
    }
    if (event.type === "text-failed") {
      setState("error");
      setPendingFailure({
        intent: event.intent,
        translationLanguage: event.translationLanguage,
        rawText: event.rawText,
        audioMs: (event.timings && event.timings.audioMs) || 0,
        message: event.message,
        windowContext: event.windowContext,
      });
      notify(event.message, false);
      return;
    }
    if (event.type === "answer") {
      const card = { question: event.question, answer: event.text };
      setAnswerCard(card);
      if (isTauri()) desktopInvoke("show_answer_card", card, true).catch((error) => notify(describeError(error), false));
      const timings = event.timings || {};
      setHistory((current) => [{
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        text: event.text,
        rawText: event.question,
        time: historyTime(),
        intent: "ask",
        ms: (timings.encodeMs || 0) + (timings.asrMs || 0) + (timings.textMs || 0),
        breakdown: breakdownOf(timings),
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
        text: event.text,
        time: historyTime(),
        intent: event.intent,
        ms: total,
        breakdown,
        rawText: event.rawText,
        windowContext: event.windowContext,
      };
      setLastResult({ text: event.text, ms: total, intent: event.intent, breakdown });
      setHistory((current) => [entry, ...current].slice(0, 50));
      setPendingFailure(null);
      if (event.type === "paste-failed") {
        stateRef.current = "error";
        setState("error");
        notify(event.message, false);
        return;
      }
      notify(event.insertedRaw ? "已插入识别原文" : "已完成", true);
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
        if (loaded.rejected) notices.push(`有 ${loaded.rejected} 个自定义 Skill 未通过校验，已跳过。`);
      } catch (error) {
        notices.push(describeError(error));
      }

      let next = normalized;
      if (normalized.processingMode === "skill" && !findSkill(normalized.selectedSkillId, skills)) {
        // 选中的 Skill 不在了就回退智能整理，而不是把用户送进一条注定走不通的路径。
        next = { ...normalized, processingMode: "smart", selectedSkillId: "" };
        notices.push("之前选择的 Skill 已不存在，文字整理已回退为「智能整理」。");
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
    desktopInvoke("save_settings", { settings: persisted }, true).catch(() => {});
  }, [settings, hydrated, windowLabel]);

  useEffect(() => {
    try {
      localStorage.setItem("typefree-windows.history", JSON.stringify(history));
    } catch {
      // 同上：历史落盘失败不阻断口述。
    }
  }, [history]);

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
      notify("已删除，不再自动学习这条纠正", true);
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
    notify("已设为第三个快捷键的动作", true);
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
      notify("所选技能已删除，相关入口已恢复默认设置。", false);
    }
    return normalized;
  };

  const retryTask = async () => {
    if (!pendingFailure || retrying) return;
    setRetrying(true);
    try {
      await pipeline.retry({
        intent: pendingFailure.intent,
        rawText: pendingFailure.rawText,
        settings: { ...settingsRef.current, learnedEntries: vocabularyRef.current.entries },
        customSkills: customSkillsRef.current,
        audioMs: pendingFailure.audioMs,
        windowContext: pendingFailure.windowContext,
        translationLanguage: pendingFailure.translationLanguage,
      });
      setPendingFailure(null);
    } finally {
      setRetrying(false);
    }
  };

  const insertRawText = async () => {
    if (!pendingFailure) return;
    const result = await pipeline.insertRaw({
      intent: pendingFailure.intent,
      rawText: pendingFailure.rawText,
      settings: { ...settingsRef.current, learnedEntries: vocabularyRef.current.entries },
      customSkills: customSkillsRef.current,
      audioMs: pendingFailure.audioMs,
      windowContext: pendingFailure.windowContext,
    });
    if (result && result.ok === false) notify(result.message || "无法插入原文", false);
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
    const unlistenDictation = listen("toggle-dictation", () => toggleRef.current("dictation"));
    const unlistenAsk = listen("toggle-ask", () => toggleRef.current("ask"));
    const unlistenAction = listen("toggle-action", () => toggleRef.current("action"));
    const unlistenStop = listen("stop-recording", () => stopRef.current());
    const unlistenCancel = listen("cancel-recording", () => cancelRef.current());
    const unlistenShortcut = listen("shortcut-register-failed", (event) => {
      const list = Array.isArray(event.payload) ? event.payload : [];
      notify(list.length ? `快捷键注册失败：${list.join("；")}` : "快捷键注册失败", false);
    });
    return () => {
      unlistenDictation.then((fn) => fn());
      unlistenAsk.then((fn) => fn());
      unlistenAction.then((fn) => fn());
      unlistenStop.then((fn) => fn());
      unlistenCancel.then((fn) => fn());
      unlistenShortcut.then((fn) => fn());
    };
  }, [windowLabel]);

  useEffect(() => {
    if (!isTauri() || windowLabel !== "answer") return undefined;
    const unlisten = listen("ask-answer", (event) => setAnswerCard(event.payload));
    desktopInvoke("get_answer_card", {}, null).then((card) => { if (card) setAnswerCard(card); }).catch(() => {});
    return () => { unlisten.then((fn) => fn()); };
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

  const testConnection = async () => {
    setTesting(true);
    setNotice(null);
    try {
      await desktopInvoke("test_connection", { endpoint: settings.asrEndpoint }, () => new Promise((resolve) => setTimeout(resolve, 700)));
      setOnline(true);
      notify("ASR 服务连接正常", true);
    } catch (error) {
      setOnline(false);
      notify(describeError(error), false);
    } finally {
      setTesting(false);
    }
  };

  const textReady = Boolean(settings.textEndpoint && settings.textModel);
  const busy = state === "recording" || state === "processing";

  const closeAnswer = () => {
    setAnswerCard(null);
    if (isTauri()) desktopInvoke("hide_answer_card", {}, true).catch(() => {});
  };

  const clearHistory = () => {
    if (window.confirm("清空本机保存的全部历史记录？此操作无法撤销。")) {
      setHistory([]);
      setLastResult(null);
    }
  };

  if (windowLabel === "answer") {
    return <AnswerCard card={answerCard} onClose={closeAnswer} />;
  }

  if (windowLabel === "overlay") {
    return (
      <Overlay
        state={state}
        level={audioLevel}
        intent={intent}
        phase={phase}
        onStop={() => emit("stop-recording")}
        onCancel={() => emit("cancel-recording")}
      />
    );
  }

  return (
    <main className="app-shell">
      <Sidebar page={page} setPage={setPage} online={online} />
      <section className="workspace">
        <div className="topbar">
          <span><StatusDot online={online} />{online ? "语音服务在线" : "语音服务待连接"}</span>
          <button className="mini-shortcut" title="语音输入" onClick={() => toggleTask("dictation")} disabled={state === "processing" || (state === "recording" && currentTriggerRef.current !== "dictation")}><Microphone size={16} weight="fill" />{displayShortcut(settings.shortcut)}</button>
          <button className="mini-shortcut" title="随便问" onClick={() => toggleTask("ask")} disabled={state === "processing" || (state === "recording" && currentTriggerRef.current !== "ask")}><Command size={16} />{displayShortcut(settings.askShortcut)}</button>
          <button className="mini-shortcut" title={actionName(settings, customSkills)} onClick={() => toggleTask("action")} disabled={state === "processing" || (state === "recording" && currentTriggerRef.current !== "action")}><PuzzlePiece size={16} />{displayShortcut(settings.actionShortcut)}</button>
        </div>

        {pendingFailure && (
          <div className="panel failure-panel">
            <div className="panel-title slim">
              <div>
                <h2>文字整理没有完成</h2>
                <p>{pendingFailure.message}{["command", "ask"].includes(pendingFailure.intent) ? " · 原始问题或命令不会输入到当前窗口" : ""}</p>
              </div>
              <button className="icon-button" onClick={() => setPendingFailure(null)} title="关闭"><X size={16} /></button>
            </div>
            <div className="preview-box">
              <span className="preview-label">{pendingFailure.intent === "ask" ? "识别到的问题" : pendingFailure.intent === "command" ? "识别到的命令" : "识别到的原文"}</span>
              <p>{pendingFailure.rawText}</p>
            </div>
            <div className="form-actions">
              {!["command", "ask"].includes(pendingFailure.intent) && (
                <button className="button secondary" onClick={insertRawText} disabled={busy}><TextT size={17} />插入原文</button>
              )}
              <button className="button secondary" onClick={() => navigator.clipboard.writeText(pendingFailure.rawText)}><ClipboardText size={17} />复制原文</button>
              <button className="button primary" onClick={retryTask} disabled={busy || retrying}>
                {retrying ? <ArrowClockwise className="spin" size={17} /> : <Repeat size={17} />}
                {retrying ? "正在重试" : "重试"}
              </button>
            </div>
          </div>
        )}

        {page === "home" && <Overview settings={settings} customSkills={customSkills} online={online} setPage={setPage} state={state} intent={intent} phase={phase} activeTrigger={currentTriggerRef.current} toggleTask={toggleTask} lastResult={lastResult} textReady={textReady} />}
        {page === "model" && <ModelSettings settings={settings} setSettings={setSettings} online={online} testing={testing} testConnection={testConnection} onNotice={notify} />}
        {page === "writing" && <WritingSettings settings={settings} setSettings={setSettings} customSkills={customSkills} onSelectSkill={onSelectSkill} textReady={textReady} />}
        {page === "text" && <TextSettings settings={settings} setSettings={setSettings} invoke={desktopInvoke} onNotice={notify} />}
        {page === "skills" && <SkillEditor customSkills={customSkills} selectedSkillId={settings.actionType === "skill" ? settings.actionSkillId : ""} onSelect={onSelectActionSkill} onSaveCustomSkills={saveCustomSkills} pipeline={pipeline} settings={settings} onNotice={notify} busy={busy} />}
        {page === "shortcut" && <ShortcutSettings settings={settings} setSettings={setSettings} customSkills={customSkills} onNotice={notify} busy={busy} />}
        {page === "vocabulary" && <VocabularySettings settings={settings} setSettings={setSettings} vocabulary={vocabulary} onDismiss={dismissWord} ready={vocabularyReady} />}
        {page === "history" && <History history={history} onClear={clearHistory} onTeach={teachCorrection} />}
      </section>
      {notice && (
        <div className={`toast ${notice.ok ? "success" : ""}`}>
          {notice.ok ? <CheckCircle size={18} weight="fill" /> : <WarningCircle size={18} weight="fill" />}
          {notice.text}
          <button onClick={() => setNotice(null)}><X size={15} /></button>
        </div>
      )}
      {!isTauri() && answerCard && <div className="answer-preview"><AnswerCard card={answerCard} onClose={closeAnswer} /></div>}
    </main>
  );
}
