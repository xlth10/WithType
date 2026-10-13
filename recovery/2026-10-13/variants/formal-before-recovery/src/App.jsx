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
import { AppearanceSettings } from "./components/AppearanceSettings.jsx";
import { normalizeWelcomeText } from "./ui/welcome.js";
import { createPipeline } from "./dictation/pipeline.js";
import { useWavRecorder } from "./dictation/useWavRecorder.js";
import { useNativeRecorder } from "./dictation/useNativeRecorder.js";
import { createVoiceController } from "./dictation/controller.js";
import { displayShortcut, shortcutFromKeydown, shortcutIdentity } from "./shortcuts/capture.js";
import { copyResult, normalizeDelivery, recentResult, needsResultCard } from "./dictation/delivery.js";
import { ASK_INSTRUCTION, BUILTIN_SKILLS, buildMessages, findBuiltinSkill } from "./text/builtinSkills.js";
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
  smart: { label: "智能整理", detail: "短句直接输出，长句调用文字模型", icon: MagicWand },
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
  if (timings.stopToDeliveredMs != null || timings.stopToReadyMs != null) parts.push(`停止后 ${timings.stopToDeliveredMs ?? timings.stopToReadyMs} ms`);
  if (timings.encodeMs) parts.push(`编码 ${timings.encodeMs} ms`);
  if (timings.stopToAsrMs != null) parts.push(`识别就绪 ${timings.stopToAsrMs} ms`);
  else parts.push(`识别 ${timings.asrMs || 0} ms`);
  if (timings.classifyMs) parts.push(`意图 ${timings.classifyMs} ms`);
  if (timings.textMs) parts.push(`整理 ${timings.textMs} ms`);
  if (timings.textFirstTokenMs != null) parts.push(`首字 ${timings.textFirstTokenMs} ms`);
  if (timings.textRequests > 1) parts.push(`文字 ${timings.textRequests} 次请求`);
  if (timings.pasteMs) parts.push(`上屏 ${timings.pasteMs} ms`);
  return parts.join(" · ");
}

/** 悬浮窗与概览共用的状态文案：录音、识别、整理文字、生成内容必须是四件能说清的事。 */
function statusLabel(state, intent, phase) {
  if (phase === "background-unavailable") return "语音输入尚未就绪，可从托盘恢复";
  if (state === "recording") return intent === "ask" ? "正在听你提问" : "正在录音";
  if (state === "processing") {
    if (phase === "choose-target") return "请选择输入位置";
    if (phase === "classify") return "正在判断口述类型";
    if (phase === "text") return intent === "ask" ? "正在回答" : intent === "translate" ? "正在翻译" : "正在处理文字";
    return "正在识别";
  }
  if (state === "done") return ({ inserted: "已输入", copied: "已复制", sent: "请确认输入结果", answer: "回答已生成" })[phase] || "已完成";
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
  return <img className="brand-icon" style={{ width: size, height: size }} src="/assets/withtype-icon.svg" alt="" />;
}

function StatusDot({ online }) {
  return <span className={`status-dot ${online ? "online" : "offline"}`} aria-hidden="true" />;
}

function Overlay({ state, level, intent, phase, countdown, onStop, onCancel }) {
  const label = statusLabel(state, intent, phase);
  return (
    <main className="overlay-shell">
      <section className={`voice-hud ${state} ${intent || "dictation"}`} aria-label={label} title={label}>
        <VoiceMotion state={state} level={level} />
        {state === "done" && (phase === "inserted" || phase === "answer" ? <Check className="hud-symbol success" size={18} weight="bold" /> : <ClipboardText className="hud-symbol" size={18} />)}
        {state === "error" && <WarningCircle className="hud-symbol error" size={19} weight="fill" />}
        {phase === "background-unavailable" && <span className="hud-badge">输入未就绪</span>}
        {countdown !== null ? <span className="hud-badge">{phase === "choose-target" ? `${countdown}秒后输入` : `还剩${countdown}秒`}</span> : intent && intent !== "dictation" && state !== "idle" && <span className="hud-badge">{INTENT_META[intent]?.label || "口述"}</span>}
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
    ["appearance", GearSix, "外观"],
  ];
  return (
    <aside className="sidebar">
      <div className="brand-row"><Logo /><div><strong>WithType</strong><span>声音写作</span></div></div>
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
        <div className="panel-title"><div className="icon-tile"><Waveform size={22} weight="bold" /></div><div><h2>OpenAI 兼容 ASR</h2><p>上传 16 kHz 单声道 PCM16 WAV</p></div></div>
        <div className="form-grid">
          <Field label="API 地址" hint="填写到 /v1 即可，例如 http://10.0.0.8:8000/v1"><input value={settings.asrEndpoint} onChange={(e) => setSettings({ ...settings, asrEndpoint: e.target.value })} /></Field>
          <Field label="模型名称"><input value={settings.asrModel} onChange={(e) => setSettings({ ...settings, asrModel: e.target.value })} /></Field>
          {isTauri() && <Field label="麦克风" hint="默认设备会跟随 Windows 系统设置；设备断开时会提示并保留已录内容。"><select value={settings.audioDeviceId || ""} onChange={(e) => setSettings({ ...settings, audioDeviceId: e.target.value })}><option value="">Windows 默认麦克风</option>{devices.map((device) => <option key={device.id} value={device.id}>{device.name}{device.isDefault ? "（当前默认）" : ""}</option>)}</select></Field>}
          <Field label="API Key" hint="保存后写入 Windows 凭据库，不进入配置文件"><div className="input-with-icon"><Key size={18} /><input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="已保存则留空" /></div></Field>
        </div>
        <div className="form-actions"><button className="button secondary" onClick={testConnection} disabled={testing}>{testing ? <ArrowClockwise className="spin" size={18} /> : <PaperPlaneTilt size={18} />}{testing ? "正在连接" : "测试连接"}</button><button className="button primary" onClick={saveKey} disabled={saving}><LockKey size={18} weight="fill" />保存密钥</button></div>
        <p className="test-result">测试连接会向所填模型发送 1 秒静音 WAV；服务返回空文字也算接口连接成功。</p>
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
  const fields = { dictation: "shortcut", ask: "askShortcut", action: "actionShortcut", copy: "copyShortcut" };

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
  }, [captureKind, captureReady, captureBusy, settings.shortcut, settings.askShortcut, settings.actionShortcut, settings.copyShortcut]);

  const beginCapture = (kind) => {
    if (busy || captureKind) return;
    captureBusyRef.current = false;
    setCaptureMessage("");
    setCaptureKind(kind);
  };

  const actionLabel = settings.actionType === "skill"
    ? findSkill(settings.actionSkillId, customSkills)?.name || "技能未选择"
    : settings.actionType === "command" ? "语音命令" : `翻译成${settings.defaultTranslationLanguage}`;
  const rows = [
    ["dictation", "语音输入", "说完后输入到当前窗口。"],
    ["ask", "随便问", "口述问题，回答只显示在卡片中。"],
    ["action", actionLabel, "使用绑定的动作，不改变普通口述。"],
    ["copy", "复制上次结果", "无需打开设置，复制最近一次完成的正文。"],
  ];

  return (
    <section className="page-content">
      <header className="page-heading"><div><span className="eyebrow">按键与动作</span><h1>按一次开始，再按一次完成。</h1><p>按下全局快捷键开始录音，再按同一个键处理文字；语音输入键也可结束其他模式的录音，Esc 取消当前录音或处理。点选按键位可以修改组合键；按 Esc 取消录制新键。</p></div></header>
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
              <option value="translate">翻译</option>
              <option value="skill">运行技能</option>
              <option value="command">语音命令</option>
            </select>
          </Field>
          {settings.actionType === "translate" && <Field label="默认输出语言"><select value={settings.defaultTranslationLanguage} onChange={(event) => setSettings({ ...settings, defaultTranslationLanguage: event.target.value })}>{["英文", "日文", "韩文", "中文", "法文", "德文", "西班牙文"].map((language) => <option key={language} value={language}>{language}</option>)}</select></Field>}
          {settings.actionType === "skill" && <Field label="技能" hint="只处理这次录音，不改变普通口述的设置">
            <select value={settings.actionSkillId} onChange={(event) => setSettings({ ...settings, actionSkillId: event.target.value })}>
              <option value="">请选择技能</option>
              {skillOptions(customSkills).map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}
            </select>
          </Field>}
        </div>
      </div>
      <div className="panel settings-list">
        <div><div><strong>结果自动输入</strong><span>完成正文默认保留在剪贴板；关闭后只复制。随便问显示卡片，不改剪贴板。</span></div><Toggle checked={settings.autoPaste} onChange={(value) => setSettings({ ...settings, autoPaste: value })} /></div>
        <div><div><strong>自动判断语音命令</strong><span>实验功能：会增加一次文字模型请求。关掉后仍可在第三个入口选择语音命令。</span></div><Toggle checked={settings.autoIntent} onChange={(value) => setSettings({ ...settings, autoIntent: value })} disabled={!settings.textEndpoint || !settings.textModel} /></div>
        <div><div><strong>登录 Windows 后启动</strong><span>已配置语音模型时进入托盘；需要配置时打开主界面。</span></div><Toggle checked={settings.launchAtLogin} disabled={!isTauri()} onChange={async (value) => {
          try {
            await desktopInvoke("set_launch_at_login", { enabled: value });
            setSettings((current) => ({ ...current, launchAtLogin: value }));
          } catch (error) { onNotice(`设置登录启动失败：${describeError(error)}`, false); }
        }} /></div>
      </div>
    </section>
  );
}

function History({ onCopy, history, onClear, onTeach, onExport, onRetranscribe, retentionDays, onRetentionChange, keepAudio, onKeepAudioChange, busy }) {
  return (
    <section className="page-content">
      <header className="page-heading"><div><span className="eyebrow">回看</span><h1>最近说过的话</h1><p>保留最近 50 条。Windows 历史使用系统数据保护加密，应用与窗口名称不发送给模型。</p></div><div className="form-actions"><button className="button secondary" onClick={onExport}>导出历史</button>{history.length > 0 && <button className="button secondary" onClick={onClear}>清空历史</button>}</div></header>
      <div className="panel form-panel compact"><Field label="保留期限"><select value={retentionDays} onChange={(event) => onRetentionChange(Number(event.target.value))}><option value={7}>7 天</option><option value={30}>30 天</option><option value={90}>90 天</option><option value={365}>1 年</option><option value={0}>一直保留</option></select></Field><div><strong>保留后续录音</strong><span>默认关闭；开启后可从历史重新转写，录音与历史一同到期。</span><Toggle checked={keepAudio} onChange={onKeepAudioChange} disabled={!isTauri()} /></div></div>
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
            {item.audioSessionId && <button title="用当前模型重新转写" onClick={() => onRetranscribe(item)} disabled={busy}><Repeat size={18} /></button>}
            <button title="复制" onClick={() => onCopy(item.text)}><Copy size={18} /></button>
          </article>
        ))}
      </div>
    </section>
  );
}

function Overview({ onCopy, settings, customSkills, online, setPage, state, intent, phase, activeTrigger, toggleTask, lastResult, textReady }) {
  const recording = state === "recording";
  const busy = state === "processing";
  const mode = MODE_META[settings.processingMode] || MODE_META.original;
  const locked = (trigger) => recording && trigger !== "dictation" && activeTrigger !== trigger;
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
              {recording ? <Stop size={17} weight="fill" /> : <Microphone size={17} weight="fill" />}
              {recording ? "结束录音" : "语音输入"}
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
          {lastResult && <button className="icon-button" onClick={() => onCopy(lastResult.text)}><Copy size={18} /></button>}
        </div>
        <p className={lastResult ? "result-text" : "empty-text"}>{lastResult?.text || "按一次快捷键开始录音。"}</p>
      </div>
    </section>
  );
}

export function App({ onWelcomeChange, onReplayEntrance, onEntranceUnavailable } = {}) {
  const previewParams = new URLSearchParams(window.location.search);
  const overlayPreview = previewParams.get("overlay");
  const cardPreview = previewParams.get("card") === "1";
  const [windowLabel, setWindowLabel] = useState(() => isTauri() ? getCurrentWindow().label : cardPreview ? "answer" : overlayPreview ? "overlay" : "main");
  const [page, setPage] = useState(!isTauri() && ["shortcut", "vocabulary", "history", "appearance"].includes(previewParams.get("page")) ? previewParams.get("page") : "home");
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [hydrated, setHydrated] = useState(false);
  const welcomeText = normalizeWelcomeText(settings.welcomeText);
  useEffect(() => {
    if (hydrated && windowLabel === "main") onWelcomeChange?.(welcomeText);
  }, [hydrated, windowLabel, welcomeText, onWelcomeChange]);
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
  const [intent, setIntent] = useState("");
  const [phase, setPhase] = useState("idle");
  const [textPreview, setTextPreview] = useState("");
  const [audioLevel, setAudioLevel] = useState(overlayPreview === "recording" ? Math.max(0, Math.min(1, Number(previewParams.get("level") ?? 0.55) || 0)) : 0);
  const [notice, setNotice] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const lastResultRef = useRef(null);
  lastResultRef.current = lastResult;
  const copyLastRef = useRef(() => {});
  const dismissedCardIdRef = useRef("");
  const [countdown, setCountdown] = useState(null);
  const [answerCard, setAnswerCard] = useState(cardPreview ? previewParams.get("kind") === "delivery" ? {
    kind: "delivery", requestId: "preview-delivery", question: "", status: "copied",
    message: "没有可用输入位置，已复制，可以粘贴",
    answer: "先完成本周的功能验证，再整理实际使用中发现的问题。周五前确定下周的安排，并同步给团队。",
  } : { question: "下周的工作怎么安排？", answer: "先列出必须完成的事项，再按截止时间排优先级。", streaming: previewParams.get("streaming") === "1" } : null);
  const streamingAnswerIdRef = useRef(null);
  const followupRequestIdRef = useRef(null);
  /** 文字阶段失败后留给用户选择的现场：原文、意图与耗时。 */
  const [pendingFailure, setPendingFailure] = useState(null);
  const [retrying, setRetrying] = useState(false);
  const [recoverableAudio, setRecoverableAudio] = useState([]);
  const [controllerStatus, setControllerStatus] = useState({ phase: "starting", message: "" });
  const controllerRef = useRef(null);

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
    pipelineRef.current = createPipeline({ invoke: desktopInvoke, onEvent: (event) => eventRef.current(event),
      onTaskStart: (taskId) => isTauri() && windowLabel === "main"
        ? controllerRef.current?.trackTask(taskId) ?? Promise.reject(new Error("语音输入尚未就绪")) : undefined,
      onTaskEnd: (taskId) => controllerRef.current?.finishTask(taskId),
    });
  }
  const skillStoreRef = useRef(null);
  if (!skillStoreRef.current) {
    skillStoreRef.current = createSkillStore(desktopInvoke);
  }
  const pipeline = pipelineRef.current;
  const copyOutput = async (text) => {
    const result = await copyResult(desktopInvoke, text);
    notify(result.message, result.copied);
    return result;
  };
  copyLastRef.current = () => {
    if (lastResultRef.current?.text) void copyOutput(lastResultRef.current.text);
    else notify("还没有可复制的完成结果", false);
  };
  const requestInsert = async (text) => {
    if (isTauri()) await desktopInvoke("request_voice_action", { action: "insert-result", text });
    else await insertSavedText(text);
  };
  const insertSavedText = async (text) => {
    if (!text || stateRef.current === "recording" || stateRef.current === "processing" || startingRef.current) return;
    const generation = ++startGenerationRef.current;
    setPhase("choose-target");
    stateRef.current = "processing";
    setState("processing");
    await desktopInvoke("hide_answer_card", {}, true).catch(() => {});
    setAnswerCard(null);
    for (let remaining = 3; remaining > 0; remaining -= 1) {
      if (generation !== startGenerationRef.current) return;
      setCountdown(remaining);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (generation !== startGenerationRef.current) return;
    setCountdown(null);
    try { await pipeline.insertResult({ text, settings: settingsRef.current }); }
    catch (error) { setState("error"); notify(describeError(error), false); }
  };
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
      if (devicePhase === "error" && stateRef.current === "recording") {
        notify(message || "麦克风已中断，正在保存已录内容", false);
        stopTask();
      }
    },
  });
  const recorder = isTauri() ? nativeRecorder : webRecorder;

  const startTask = async (trigger) => {
    if (activeSnapshotRef.current || startingRef.current) return;
    if (stateRef.current === "recording" || stateRef.current === "processing") return;
    if (!hydrated || !historyReady) return;
    const currentSettings = { ...settingsRef.current, learnedEntries: vocabularyRef.current.entries };
    if (!currentSettings.asrEndpoint || !currentSettings.asrModel) {
      notify("请先配置语音模型地址和名称", false);
      return;
    }
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
    setTextPreview("");
    setIntent(snapshot.intent);
    setPhase("record");
    stateRef.current = "recording";
    setState("recording");
    try {
      if (!await pipeline.prepare(snapshot) || generation !== startGenerationRef.current) return;
      // UIA 提供方可能较慢，目标检查不阻塞麦克风开始采集。
      const targetReady = desktopInvoke("capture_input_target", { sessionId: snapshot.requestId }, () => Promise.resolve()).catch(() => {});
      const recordingReady = recorder.start(snapshot.requestId, currentSettings.audioDeviceId, currentSettings.asrEndpoint, currentSettings.asrModel,
        snapshot.intent === "dictation" && snapshot.processingMode === "smart" && currentSettings.textIncremental && !currentSettings.autoIntent);
      await Promise.all([targetReady, recordingReady]);
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
    pipeline.markStopped(snapshot);
    stateRef.current = "processing";
    setState("processing");
    setPhase("asr");
    let audio = null;
    let audioError = "";
    try {
      const encodeStarted = nowMs();
      audio = await recorder.stop();
      // Native stop includes ASR drain; only the browser recorder performs encoding here.
      if (audio) audio.encodeMs = audio.nativeSessionId ? 0 : Math.max(0, Math.round(nowMs() - encodeStarted));
    } catch (error) {
      audioError = describeError(error);
      refreshRecoverableAudio();
    }
    await pipeline.complete({ snapshot, audio, audioError });
  };

  const cancelTask = ({ preserveAudio = false } = {}) => {
    setCountdown(null);
    pendingStopRef.current = false;
    stateRef.current = "idle";
    startGenerationRef.current += 1;
    startingRef.current = false;
    // 先作废 requestId，拦截迟到的生成结果；已经提交给系统的正文只归档，不再更新当前任务状态。
    pipeline.cancel({ preserveAudio });
    setTextPreview("");
    desktopInvoke("stop_learning_monitor", {}, true).catch(() => {});
    activeSnapshotRef.current = null;
    currentTriggerRef.current = "";
    recorder.abandon({ preserveAudio });
    setIntent("");
    setPhase("idle");
    setState("idle");
    setPendingFailure(null);
  };

  const toggleTaskLocal = (kind) => {
    if (startingRef.current) {
      if (kind === "dictation" || currentTriggerRef.current === kind) pendingStopRef.current = true;
      return;
    }
    const current = stateRef.current;
    if (current === "recording") {
      // 主输入键可以结束所有录音；其他键只结束各自启动的录音。
      if (kind === "dictation" || currentTriggerRef.current === kind) return stopTask();
      return;
    }
    if (current === "processing") return;
    return startTask(kind);
  };

  const toggleTask = (kind) => {
    if (isTauri()) desktopInvoke("request_voice_action", { action: `toggle-${kind}` }).catch((error) => notify(describeError(error), false));
    else void toggleTaskLocal(kind);
  };

  toggleRef.current = toggleTaskLocal;
  cancelRef.current = cancelTask;
  stopRef.current = stopTask;

  // pipeline 的事件都带 requestId；过期任务的结果 pipeline 已经拦下，这里只负责呈现。
  eventRef.current = (event) => {
    if (!event) return;
    if (event.type === "text-preview") { setTextPreview(event.text || ""); return; }
    if (event.type === "state") {
      setState("processing");
      setPhase(event.phase || "asr");
      return;
    }
    if (event.type === "error") {
      setState("error");
      notify(event.message, false);
      if (event.stage === "asr" && event.audioSessionId) {
        setPendingFailure({ kind: "asr", errorKind: event.errorKind, audioSessionId: event.audioSessionId, audioMs: event.audioMs, intent: event.intent, windowContext: event.windowContext, message: event.message });
        refreshRecoverableAudio();
      }
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
      const card = { question: event.question, answer: event.text, requestId: event.requestId, streaming: false };
      setAnswerCard(card);
      if (isTauri() && dismissedCardIdRef.current !== card.requestId) desktopInvoke("show_answer_card", card, true).catch((error) => notify(describeError(error), false));
      const timings = event.timings || {};
      setHistory((current) => [{
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        savedAt: Date.now(),
        text: event.text,
        rawText: event.question,
        time: historyTime(),
        intent: "ask",
        ms: timings.stopToReadyMs ?? ((timings.encodeMs || 0) + (timings.asrMs || 0) + (timings.textMs || 0)),
        breakdown: breakdownOf(timings),
        timings,
        audioSessionId: event.audioSessionId || null,
        windowContext: event.windowContext,
      }, ...current].slice(0, 50));
      setPendingFailure(null);
      setState("done");
      setPhase("answer");
      setTimeout(() => setState((current) => current === "done" ? "idle" : current), 680);
      return;
    }
    if (["done", "paste-failed", "archived-result"].includes(event.type)) {
      const timings = event.timings || {};
      const total = timings.stopToDeliveredMs ?? ((timings.encodeMs || 0) + (timings.asrMs || 0) + (timings.textMs || 0) + (timings.pasteMs || 0));
      const breakdown = breakdownOf(timings);
      const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        savedAt: Date.now(),
        text: event.text,
        time: historyTime(),
        intent: event.intent,
        ms: total,
        breakdown,
        timings,
        rawText: event.rawText,
        warning: event.warning || null,
        delivery: event.delivery,
        archived: event.type === "archived-result",
        audioSessionId: event.audioSessionId || null,
        windowContext: event.windowContext,
      };
      setHistory((current) => [entry, ...current].slice(0, 50));
      if (event.type === "archived-result") return;
      setLastResult({ text: event.text, ms: total, intent: event.intent, breakdown });
      setPendingFailure(null);
      const delivery = normalizeDelivery(event.delivery);
      const resultCard = { kind: "delivery", answer: event.text, question: "", status: delivery.status, message: event.message || delivery.message, requestId: event.requestId };
      if (needsResultCard(delivery)) {
        setAnswerCard(resultCard);
        if (isTauri()) desktopInvoke("show_delivery_card", { text: event.text, status: delivery.status, message: resultCard.message, requestId: event.requestId }, true).catch((error) => notify(describeError(error), false));
      }
      if (delivery.status === "retained") {
        stateRef.current = "error";
        setState("error");
        notify(resultCard.message, false);
        return;
      }
      notify(event.warning ? `${delivery.message} · 已使用识别原文：${event.warning}` : delivery.message, !event.warning && delivery.status !== "sent");
      setState("done");
      setPhase(delivery.status);
      setTimeout(() => setState((current) => (current === "done" ? "idle" : current)), 680);
    }
  };

  useEffect(() => {
    if (isTauri()) setWindowLabel(getCurrentWindow().label);
  }, []);

  useEffect(() => {
    if (!isTauri() || windowLabel !== "main") return undefined;
    const controller = createVoiceController({ invoke: desktopInvoke, listen,
      onStatus: (status) => {
        setControllerStatus(status);
        if (status.message) notify(status.message, false);
      },
      onInterrupt: () => { cancelRef.current({ preserveAudio: true }); refreshRecoverableAudio(); },
      onAction: ({ action, text }) => {
        if (action.startsWith("toggle-")) return toggleRef.current(action.slice(7));
        if (action === "stop-recording") return stopRef.current();
        if (action === "cancel-recording") return cancelRef.current();
        if (action === "copy-last-result") return copyLastRef.current();
        if (action === "insert-result") return insertSavedText(text);
      },
      onError: (error) => notify(describeError(error), false),
    });
    controllerRef.current = controller;
    void controller.start();
    return () => { controller.dispose(); if (controllerRef.current === controller) controllerRef.current = null; };
  }, [windowLabel]);

  useEffect(() => {
    controllerRef.current?.setResourcesReady(hydrated && historyReady && vocabularyReady);
  }, [hydrated, historyReady, vocabularyReady, windowLabel]);

  useEffect(() => {
    if (windowLabel === "main" && historyReady) setLastResult(recentResult(history));
  }, [history, historyReady, windowLabel]);

  useEffect(() => {
    if (!isTauri() || windowLabel !== "main") return;
    desktopInvoke("set_interaction_active", { active: state === "recording" || state === "processing" }, true)
      .catch(() => notify("Esc 快捷键不可用，可以用悬浮条取消", false));
  }, [state, windowLabel]);

  useEffect(() => {
    if (windowLabel !== "main" || state !== "recording") return;
    const start = Date.now();
    const timer = setInterval(() => {
      const remaining = Math.max(0, 900 - Math.floor((Date.now() - start) / 1000));
      setCountdown(remaining <= 60 ? remaining : null);
    }, 1000);
    return () => { clearInterval(timer); setCountdown(null); };
  }, [state, windowLabel]);

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
          if (!disposed) {
            const message = `配置载入失败，已暂停输入以保护已有配置：${describeError(error)}`;
            if (windowLabel === "main") onEntranceUnavailable?.();
            notify(message, false);
            if (windowLabel === "main") controllerRef.current?.fail(message).catch(() => {});
          }
          return;
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
      // The greeting is ready independently of skills; resource failures must remain visible.
      if (!disposed && windowLabel === "main") onWelcomeChange?.(normalized.welcomeText);

      let skills = [];
      try {
        const loaded = await skillStoreRef.current.load();
        skills = loaded.skills;
        if (loaded.rejected) notices.push(`有 ${loaded.rejected} 个自定义 Skill 未通过校验，已跳过。`);
      } catch (error) {
        if (!disposed) {
          const message = `技能载入失败，已暂停输入以保护已有设置：${describeError(error)}`;
            if (windowLabel === "main") onEntranceUnavailable?.();
          notify(message, false);
          if (windowLabel === "main") controllerRef.current?.fail(message).catch(() => {});
        }
        return;
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
    if (!isTauri() || windowLabel !== "main" || !hydrated) return undefined;
    let disposed = false;
    const refresh = () => desktopInvoke("get_launch_at_login", {}).then((enabled) => {
      if (!disposed) setSettings((current) => current.launchAtLogin === enabled ? current : { ...current, launchAtLogin: enabled });
    }).catch((error) => { if (!disposed) notify(`读取登录启动状态失败：${describeError(error)}`, false); });
    void refresh();
    const listener = getCurrentWindow().onFocusChanged(({ payload }) => { if (payload) void refresh(); });
    return () => { disposed = true; listener.then((off) => off()).catch(() => {}); };
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
    desktopInvoke("save_settings", { settings: persisted }, true).catch(() => {});
  }, [settings, hydrated, windowLabel]);

  useEffect(() => {
    if (!isTauri() || windowLabel !== "main") return undefined;
    refreshRecoverableAudio();
  }, [windowLabel]);

  useEffect(() => {
    if (!isTauri() || windowLabel !== "main" || !hydrated) return undefined;
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
        if (!disposed) { setHistory(entries); setLastResult(recentResult(entries)); setHistoryReady(true); }
      } catch (error) {
        if (!disposed) {
          const message = `历史载入失败，已暂停录音以保护旧记录：${describeError(error)}`;
          notify(message, false); controllerRef.current?.fail(message).catch(() => {});
        }
      }
    };
    load();
    return () => { disposed = true; };
  }, [windowLabel, hydrated]);

  useEffect(() => {
    if (!historyReady || !hydrated || windowLabel !== "main") return;
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
    }).catch((error) => {
      if (!disposed) {
        const message = `词库未能载入：${describeError(error)}`;
        notify(message, false); controllerRef.current?.fail(message).catch(() => {});
      }
    });
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
      const retry = pendingFailure.kind === "asr" ? pipeline.retryAudio({
        audioSessionId: pendingFailure.audioSessionId,
        intent: pendingFailure.intent,
        settings: { ...settingsRef.current, learnedEntries: vocabularyRef.current.entries },
        customSkills: customSkillsRef.current,
        audioMs: pendingFailure.audioMs,
        windowContext: pendingFailure.windowContext,
      }) : pipeline.retry({
        intent: pendingFailure.intent,
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
    } catch (error) { notify(describeError(error), false); }
    finally {
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
        intent: "dictation",
        settings: { ...settingsRef.current, learnedEntries: vocabularyRef.current.entries },
        customSkills: customSkillsRef.current,
        audioMs: item.audioMs,
      });
      if (result?.ok) setPendingFailure(null);
    } catch (error) { notify(describeError(error), false); }
    finally {
      setRetrying(false);
      refreshRecoverableAudio();
    }
  };

  const discardAudio = async (item) => {
    if (!await confirmDestructive("丢弃这段可恢复录音？此操作无法撤销。")) return;
    try {
      await desktopInvoke("release_native_audio", { sessionId: item.sessionId });
      setRecoverableAudio((current) => current.filter((entry) => entry.sessionId !== item.sessionId));
      if (pendingFailure?.audioSessionId === item.sessionId) setPendingFailure(null);
    } catch (error) { notify(`丢弃录音失败：${describeError(error)}`, false); }
  };

  const insertRawText = async () => {
    if (!pendingFailure) return;
    try {
      const result = await pipeline.insertRaw({
        intent: pendingFailure.intent,
        rawText: pendingFailure.rawText,
        settings: { ...settingsRef.current, learnedEntries: vocabularyRef.current.entries },
        customSkills: customSkillsRef.current,
        audioMs: pendingFailure.audioMs,
        windowContext: pendingFailure.windowContext,
      });
      if (result && result.ok === false) notify(result.message || "无法保留原文", false);
      else setPendingFailure(null);
    } catch (error) { notify(describeError(error), false); }
  };

  useEffect(() => {
    if (!isTauri() || windowLabel !== "overlay") return undefined;
    const unlisten = listen("dictation-state", (event) => {
      const payload = event.payload || {};
      setState(payload.state || "idle");
      setIntent(payload.intent || "");
      setPhase(payload.phase || "idle");
      setCountdown(payload.countdown ?? null);
    });
    const unlistenLevel = listen("dictation-level", (event) => setAudioLevel(event.payload));
    return () => { unlisten.then((fn) => fn()); unlistenLevel.then((fn) => fn()); };
  }, [windowLabel]);

  useEffect(() => {
    if (!isTauri() || windowLabel !== "main") return undefined;
    const unlistenStream = listen("answer-stream", (event) => {
      const payload = event.payload || {};
      if (!payload.text || !pipeline.isCurrent(payload.requestId)) return;
      pipeline.acceptTextStream(payload);
      const card = { question: payload.question, answer: payload.text, requestId: payload.requestId, streaming: true };
      setAnswerCard(card);
      if (streamingAnswerIdRef.current !== payload.requestId) {
        streamingAnswerIdRef.current = payload.requestId;
        dismissedCardIdRef.current !== card.requestId && desktopInvoke("show_answer_card", card, true).catch((error) => notify(describeError(error), false));
      }
    });
    const unlistenText = listen("text-stream", (event) => pipeline.acceptTextStream(event.payload || {}));
    const unlistenTranscript = listen("audio-transcript", (event) => pipeline.acceptTranscript(event.payload || {}));
    const unlistenRecovery = listen("recoverable-audio-changed", () => refreshRecoverableAudio());
    const unlistenDismiss = listen("answer-dismissed", (event) => { dismissedCardIdRef.current = event.payload?.requestId || ""; });
    const unlistenShortcut = listen("shortcut-register-failed", (event) => {
      const list = Array.isArray(event.payload) ? event.payload : [];
      notify(list.length ? `快捷键注册失败：${list.join("；")}` : "快捷键注册失败", false);
    });
    return () => {
      unlistenStream.then((fn) => fn());
      unlistenText.then((fn) => fn());
      unlistenTranscript.then((fn) => fn());
      unlistenRecovery.then((fn) => fn());
      unlistenDismiss.then((fn) => fn());
      unlistenShortcut.then((fn) => fn());
    };
  }, [windowLabel]);

  useEffect(() => {
    if (!isTauri() || windowLabel !== "answer") return undefined;
    const unlisten = listen("ask-answer", (event) => setAnswerCard(event.payload));
    const unlistenStream = listen("answer-stream", (event) => {
      const payload = event.payload || {};
      setAnswerCard((current) => current?.requestId === payload.requestId ? { ...current, answer: payload.text } : current);
    });
    desktopInvoke("get_answer_card", {}, null).then((card) => { if (card) setAnswerCard(card); }).catch(() => {});
    return () => { unlisten.then((fn) => fn()); unlistenStream.then((fn) => fn()); };
  }, [windowLabel]);

  useEffect(() => {
    if (!isTauri() || windowLabel !== "main") return;
    // intent 与 phase 一起发给悬浮窗：只发状态串的话，用户分不清这次是口述还是命令、
    // 也分不清「正在识别」和「正在整理文字」。
    desktopInvoke("set_overlay_state", { state, intent, phase, countdown }, true).catch(() => {});
  }, [state, intent, phase, countdown, windowLabel]);

  useEffect(() => {
    if (!isTauri() || windowLabel !== "main" || state !== "recording") return;
    // 电平来自采集层，主窗口不自己再算一遍：两处各算一次只会让悬浮窗和主界面打架。
    emit("dictation-level", recorder.level).catch(() => {});
  }, [recorder.level, state, windowLabel]);

  const testConnection = async () => {
    setTesting(true);
    setNotice(null);
    try {
      await desktopInvoke("test_connection", { endpoint: settings.asrEndpoint, model: settings.asrModel }, () => new Promise((resolve) => setTimeout(resolve, 700)));
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
    dismissedCardIdRef.current = answerCard?.requestId || "";
    if (isTauri()) emit("answer-dismissed", { requestId: answerCard?.requestId }).catch(() => {});
    if (followupRequestIdRef.current) desktopInvoke("cancel_text_request", { requestId: followupRequestIdRef.current }, true).catch(() => {});
    followupRequestIdRef.current = null;
    setAnswerCard(null);
    if (isTauri()) desktopInvoke("hide_answer_card", {}, true).catch(() => {});
  };

  const followupAnswer = async ({ turns, question, onDelta }) => {
    const current = settingsRef.current;
    if (!current.textEndpoint || !current.textModel) throw new Error("请先配置文字模型");
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
      const deadline = nowMs() + Math.max(3000, Math.min(300000, Number(current.textTimeoutMs) || 60000));
      for (const [index, model] of models.entries()) {
        if (followupRequestIdRef.current !== requestId) throw new Error("文字请求已取消");
        const remainingMs = Math.floor(deadline - nowMs());
        if (remainingMs <= 0) throw new Error("文字处理总预算已耗尽");
        try {
          const result = await desktopInvoke("stream_answer", { request: {
            requestId, task: "ask", rawText: question, endpoint: current.textEndpoint,
            model, timeoutMs: Math.max(1, Math.floor(remainingMs / (models.length - index))),
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

  const confirmDestructive = async (message) => {
    try {
      if (!isTauri()) return window.confirm(message);
      return await controllerRef.current.withDialog(() => window.confirm(message));
    } catch (error) { notify(describeError(error), false); return false; }
  };
  const clearHistory = async () => {
    if (await confirmDestructive("清空本机保存的全部历史记录？此操作无法撤销。")) {
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
        link.download = "withtype-history.json";
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
        settings: { ...settingsRef.current, learnedEntries: vocabularyRef.current.entries },
        customSkills: customSkillsRef.current,
        audioMs: 0,
        windowContext: item.windowContext,
        preserveAudio: true,
      });
    } catch (error) { notify(describeError(error), false); }
    finally { setRetrying(false); }
  };

  if (windowLabel === "answer") {
    return <AnswerCard card={answerCard} onClose={closeAnswer} onFollowup={followupAnswer} onCopy={copyOutput} onInsert={requestInsert} />;
  }

  if (windowLabel === "overlay") {
    return (
      <Overlay
        state={state}
        level={audioLevel}
        intent={intent}
        phase={phase}
        countdown={countdown}
        onStop={() => desktopInvoke("request_voice_action", { action: "stop-recording" }).catch((error) => notify(describeError(error), false))}
        onCancel={() => desktopInvoke("request_voice_action", { action: "cancel-recording" }).catch((error) => notify(describeError(error), false))}
      />
    );
  }

  return (
    <main className="app-shell">
      <Sidebar page={page} setPage={setPage} online={online} />
      <section className="workspace">
        <div className="topbar">
          <span><StatusDot online={online} />{online ? "语音服务在线" : "语音服务待连接"}</span>
          {isTauri() && <span className="background-status" role="status">
            {controllerStatus.phase === "ready" ? "后台输入可用" : controllerStatus.phase === "suspended" ? "输入已暂停" : controllerStatus.phase === "failed" ? "输入暂不可用" : "输入正在准备"}
            {controllerStatus.phase === "failed" && <button className="button secondary" onClick={() => desktopInvoke("recover_voice_controller", {}).catch((error) => notify(describeError(error), false))}>恢复</button>}
          </span>}
          <button className="mini-shortcut" title="语音输入" onClick={() => toggleTask("dictation")} disabled={state === "processing"}><Microphone size={16} weight="fill" />{displayShortcut(settings.shortcut)}</button>
          <button className="mini-shortcut" title="随便问" onClick={() => toggleTask("ask")} disabled={state === "processing" || (state === "recording" && currentTriggerRef.current !== "ask")}><Command size={16} />{displayShortcut(settings.askShortcut)}</button>
          <button className="mini-shortcut" title={actionName(settings, customSkills)} onClick={() => toggleTask("action")} disabled={state === "processing" || (state === "recording" && currentTriggerRef.current !== "action")}><PuzzlePiece size={16} />{displayShortcut(settings.actionShortcut)}</button>
        </div>

        {textPreview && (state === "recording" || state === "processing") && (
          <section className="panel text-preview-panel" aria-label="文字整理预览">
            <div className="panel-title slim"><div><h2>整理预览</h2><p>已生成 {textPreview.length} 字 · 完成后统一输入</p></div></div>
            <p className="result-text text-preview-text">{textPreview.slice(-6000)}</p>
          </section>
        )}
        {pendingFailure && (
          <div className="panel failure-panel">
            <div className="panel-title slim">
              <div>
                <h2>{pendingFailure.kind === "asr" ? "语音识别没有完成" : "文字整理没有完成"}</h2>
                <p>{pendingFailure.message}{pendingFailure.errorKind === "auth" ? " · 请检查 ASR 密钥或权限" : pendingFailure.errorKind === "rate-limit" ? " · 可稍后重新转写" : pendingFailure.errorKind === "format" ? " · 当前服务可能不接受 WAV 文件" : ""}{["command", "ask"].includes(pendingFailure.intent) ? " · 原始问题或命令不会输入到当前窗口" : ""}</p>
              </div>
              <button className="icon-button" onClick={closeFailure} title="关闭"><X size={16} /></button>
            </div>
            {pendingFailure.kind !== "asr" && <div className="preview-box">
              <span className="preview-label">{pendingFailure.intent === "ask" ? "识别到的问题" : pendingFailure.intent === "command" ? "识别到的命令" : "识别到的原文"}</span>
              <p>{pendingFailure.rawText}</p>
            </div>}
            <div className="form-actions">
              {pendingFailure.kind !== "asr" && !["command", "ask"].includes(pendingFailure.intent) && (
                <button className="button secondary" onClick={insertRawText} disabled={busy}><TextT size={17} />保留原文</button>
              )}
              {pendingFailure.kind !== "asr" && <button className="button secondary" onClick={() => copyOutput(pendingFailure.rawText)}><ClipboardText size={17} />复制原文</button>}
              <button className="button primary" onClick={retryTask} disabled={busy || retrying}>
                {retrying ? <ArrowClockwise className="spin" size={17} /> : <Repeat size={17} />}
                {retrying ? "正在重试" : pendingFailure.kind === "asr" ? "重新转写" : "重试"}
              </button>
            </div>
          </div>
        )}

        {recoverableAudio.filter((item) => item.sessionId !== pendingFailure?.audioSessionId).map((item) => (
          <div className="panel failure-panel" key={item.sessionId}>
            <div className="panel-title slim"><div><h2>可恢复的录音</h2><p>{item.error || `约 ${Math.ceil(item.audioMs / 1000)} 秒，已由 Windows 加密保存在本机。`}</p></div></div>
            <div className="form-actions">
              <button className="button secondary" onClick={() => discardAudio(item)} disabled={busy || retrying}>丢弃录音</button>
              <button className="button primary" onClick={() => recoverAudio(item)} disabled={busy || retrying || Boolean(item.error)}>{retrying ? "正在转写" : "重新转写"}</button>
            </div>
          </div>
        ))}

        {page === "home" && <Overview onCopy={copyOutput} settings={settings} customSkills={customSkills} online={online} setPage={setPage} state={state} intent={intent} phase={phase} activeTrigger={currentTriggerRef.current} toggleTask={toggleTask} lastResult={lastResult} textReady={textReady} />}
        {page === "model" && <ModelSettings settings={settings} setSettings={setSettings} online={online} testing={testing} testConnection={testConnection} onNotice={notify} />}
        {page === "writing" && <WritingSettings settings={settings} setSettings={setSettings} customSkills={customSkills} onSelectSkill={onSelectSkill} textReady={textReady} />}
        {page === "text" && <TextSettings settings={settings} setSettings={setSettings} invoke={desktopInvoke} onNotice={notify} />}
        {page === "skills" && <SkillEditor customSkills={customSkills} selectedSkillId={settings.actionType === "skill" ? settings.actionSkillId : ""} onSelect={onSelectActionSkill} onSaveCustomSkills={saveCustomSkills} pipeline={pipeline} settings={settings} onNotice={notify} busy={busy} />}
        {page === "appearance" && <AppearanceSettings settings={settings} setSettings={setSettings} onReplayEntrance={onReplayEntrance} ready={hydrated} />}
        {page === "shortcut" && <ShortcutSettings settings={settings} setSettings={setSettings} customSkills={customSkills} onNotice={notify} busy={busy} />}
        {page === "vocabulary" && <VocabularySettings settings={settings} setSettings={setSettings} vocabulary={vocabulary} onDismiss={dismissWord} ready={vocabularyReady} />}
        {page === "history" && <History onCopy={copyOutput} history={history} onClear={clearHistory} onTeach={teachCorrection} onExport={exportHistory} onRetranscribe={retranscribeHistory} retentionDays={settings.historyRetentionDays} onRetentionChange={changeHistoryRetention} keepAudio={settings.keepHistoryAudio} onKeepAudioChange={(value) => setSettings({ ...settingsRef.current, keepHistoryAudio: value })} busy={busy || retrying} />}
      </section>
      {notice && (
        <div className={`toast ${notice.ok ? "success" : ""}`}>
          {notice.ok ? <CheckCircle size={18} weight="fill" /> : <WarningCircle size={18} weight="fill" />}
          {notice.text}
          <button onClick={() => setNotice(null)}><X size={15} /></button>
        </div>
      )}
      {!isTauri() && answerCard && <div className="answer-preview"><AnswerCard card={answerCard} onClose={closeAnswer} onFollowup={followupAnswer} onCopy={copyOutput} onInsert={requestInsert} /></div>}
    </main>
  );
}
