// 文字模型设置页：地址、模型、超时、认证方式、API Key 与连接测试。
//
// 两条约束：
// 1. 密钥只走 save_text_api_key，进系统凭据库。它既不在配置文件里，
//    也不进 localStorage，界面上只在输入框里短暂存在，保存后立刻清空。
// 2. 连接测试发一段真实短文本，而不是 GET /models：私有网关常把 /models 关掉，
//    那样「能连上」会被误报成「连不上」。

import { useState } from "react";
import {
  ArrowClockwise,
  BookOpenText,
  Key,
  LockKey,
  PaperPlaneTilt,
  ShieldCheck,
  Waveform,
} from "@phosphor-icons/react";
import { DEFAULT_SETTINGS } from "../text/settingsMigration.js";

const TIMEOUT_PRESETS = [
  { value: 15000, label: "15 秒" },
  { value: 30000, label: "30 秒" },
  { value: 60000, label: "60 秒" },
  { value: 120000, label: "120 秒" },
];

const AUTH_MODES = [
  { value: "bearer", label: "Bearer Token（Authorization 头）" },
  { value: "none", label: "无认证（内网服务不需要密钥）" },
];

function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function TextSettings({ settings, setSettings, invoke, onNotice }) {
  const [key, setKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [result, setResult] = useState(null);

  const patch = (changes) => setSettings({ ...settings, ...changes });

  const saveKey = async () => {
    if (!key.trim()) {
      onNotice({ text: "请先填写要保存的 API Key", ok: false });
      return;
    }
    setSavingKey(true);
    try {
      await invoke("save_text_api_key", { key });
      setKey("");
      onNotice({ text: "文字模型 API Key 已保存到系统凭据库", ok: true });
    } catch (error) {
      onNotice({ text: String(error && error.message ? error.message : error), ok: false });
    } finally {
      setSavingKey(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setResult(null);
    try {
      const reply = await invoke(
        "test_text_connection",
        {
          endpoint: settings.textEndpoint,
          model: settings.textModel,
          timeoutMs: settings.textTimeoutMs,
          authMode: settings.textAuthMode,
        },
        () => "ok（浏览器预览：未真正发起请求）",
      );
      setResult({ ok: true, message: String(reply || "") });
    } catch (error) {
      setResult({ ok: false, message: String(error && error.message ? error.message : error) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="page-content">
      <header className="page-heading">
        <div>
          <span className="eyebrow">服务连接</span>
          <h1>文字模型</h1>
          <p>随便问、翻译、技能和智能整理都使用这里的服务。可与语音模型分别配置。</p>
        </div>
        <div className={`connection-badge ${result?.ok ? "success" : ""}`}>
          {result?.ok ? "连接正常" : "等待测试"}
        </div>
      </header>

      <div className="panel form-panel">
        <div className="panel-title">
          <div className="icon-tile"><BookOpenText size={22} weight="bold" /></div>
          <div>
            <h2>文字服务接口</h2>
            <p>支持流式预览；成稿完成后一次输入到目标应用。</p>
          </div>
        </div>
        <div className="form-grid">
          <Field label="API 地址" hint="填写到 /v1 即可，例如 http://10.0.0.9:8000/v1；留空则不启用文字整理">
            <input
              value={settings.textEndpoint}
              placeholder={DEFAULT_SETTINGS.textEndpoint || "http://10.0.0.9:8000/v1"}
              onChange={(event) => patch({ textEndpoint: event.target.value })}
            />
          </Field>
          <Field label="模型名称" hint="例如 Qwen3-8B、deepseek-v3；留空则不启用文字整理">
            <input
              value={settings.textModel}
              onChange={(event) => patch({ textModel: event.target.value })}
            />
          </Field>
          <Field label="快速模型（可选）" hint="普通智能整理、翻译与意图判断优先使用；技能使用主模型。留空时使用主模型。">
            <input value={settings.textFastModel || ""} onChange={(event) => patch({ textFastModel: event.target.value })} />
          </Field>
          <Field label="备用模型（可选）" hint="用逗号分隔。失败时按顺序尝试，共享本次整理的总等待预算。">
            <input value={settings.textFallbackModels || ""} onChange={(event) => patch({ textFallbackModels: event.target.value })} />
          </Field>
          <Field label="认证方式">
            <select
              value={settings.textAuthMode}
              onChange={(event) => patch({ textAuthMode: event.target.value })}
            >
              {AUTH_MODES.map((mode) => (
                <option key={mode.value} value={mode.value}>{mode.label}</option>
              ))}
            </select>
          </Field>
          <Field label="本次整理总等待预算" hint="包括分段处理与备用模型；耗尽后普通口述保留原文。">
            <select
              value={settings.textTimeoutMs}
              onChange={(event) => patch({ textTimeoutMs: Number(event.target.value) })}
            >
              {TIMEOUT_PRESETS.map((preset) => (
                <option key={preset.value} value={preset.value}>{preset.label}</option>
              ))}
            </select>
          </Field>
          <Field label="API Key" hint="保存后写入 Windows 凭据库，不进入配置文件与浏览器存储">
            <div className="input-with-icon">
              <Key size={18} />
              <input
                type="password"
                value={key}
                placeholder="已保存则留空"
                onChange={(event) => setKey(event.target.value)}
                disabled={settings.textAuthMode === "none"}
              />
            </div>
          </Field>
        </div>
        <div className="form-grid">
          <Field label="流式预览" hint="在概览显示生成进展；服务不支持时回退完整响应。">
            <select value={settings.textStreaming === false ? "off" : "on"} onChange={(event) => patch({ textStreaming: event.target.value === "on" })}>
              <option value="on">开启</option><option value="off">关闭</option>
            </select>
          </Field>
          <Field label="录音期间提前整理" hint="仅普通智能整理生效，会增加文字请求；自动意图判断开启时不使用。">
            <select value={settings.textIncremental ? "on" : "off"} onChange={(event) => patch({ textIncremental: event.target.value === "on" })}>
              <option value="off">关闭</option><option value="on">开启</option>
            </select>
          </Field>
        </div>
        <div className="form-actions">
          <button
            className="button secondary"
            onClick={testConnection}
            disabled={testing || !settings.textEndpoint || !settings.textModel}
          >
            {testing ? <ArrowClockwise className="spin" size={18} /> : <PaperPlaneTilt size={18} />}
            {testing ? "正在测试" : "测试连接"}
          </button>
          <button
            className="button primary"
            onClick={saveKey}
            disabled={savingKey || settings.textAuthMode === "none"}
          >
            <LockKey size={18} weight="fill" />
            保存密钥
          </button>
        </div>
        {result && (
          <p className={`test-result ${result.ok ? "success" : "error"}`}>
            {result.ok ? `返回：${result.message}` : result.message}
          </p>
        )}
      </div>

      <div className="note-card">
        <ShieldCheck size={22} weight="fill" />
        <div>
          <strong>密钥不进配置文件</strong>
          <p>
            语音识别与文字模型各自使用独立的凭据项，二者互不覆盖。切换为「无认证」时不会读取已保存的密钥；
            模型名称同样留空即视为不启用，不会退回默认服务。
          </p>
        </div>
      </div>

      <div className="note-card">
        <Waveform size={22} />
        <div>
          <strong>连接测试会发送一段真实文本</strong>
          <p>
            测试请求会走完整的整理链路（含认证），只有拿到合法的模型回复才算通过；
            超时、401/403、空响应会分别报出原因，错误信息不会回显密钥。
          </p>
        </div>
      </div>
    </section>
  );
}
