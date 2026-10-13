// 模型配置中的文字处理分区：地址、模型、超时、认证方式、API Key 与连接测试。
//
// 两条约束：
// 1. 密钥只走 save_text_api_key，进系统凭据库。它既不在配置文件里，
//    也不进 localStorage，界面上只在输入框里短暂存在，保存后立刻清空。
// 2. 连接测试发一段真实短文本，而不是 GET /models：私有网关常把 /models 关掉，
//    那样「能连上」会被误报成「连不上」。

import { useEffect, useRef, useState } from "react";
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

export function TextSettings({ settings, setSettings, invoke, onNotice, previewMode = false }) {
  const [key, setKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [result, setResult] = useState(null);

  const signature = JSON.stringify([settings.textEndpoint, settings.textModel, settings.textTimeoutMs, settings.textAuthMode]);
  const signatureRef = useRef(signature);
  signatureRef.current = signature;
  useEffect(() => { setResult(null); }, [signature]);
  const patch = (changes) => setSettings((current) => ({ ...current, ...changes }));

  const saveKey = async () => {
    if (!key.trim()) {
      onNotice({ text: "请先填写要保存的 API Key", ok: false });
      return;
    }
    setSavingKey(true);
    try {
      await invoke("save_text_api_key", { key });
      setKey("");
      setResult(null);
      onNotice({ text: "文字模型 API Key 已保存到系统凭据库", ok: true });
    } catch (error) {
      onNotice({ text: String(error && error.message ? error.message : error), ok: false });
    } finally {
      setSavingKey(false);
    }
  };

  const testConnection = async () => {
    if (previewMode) {
      setResult({ ok: null, message: "浏览器预览没有发起连接请求。请在桌面应用中测试文字服务。" });
      return;
    }
    const testedSignature = signature;
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
      if (signatureRef.current === testedSignature) setResult({ ok: true, message: String(reply || "") });
    } catch (error) {
      if (signatureRef.current === testedSignature) setResult({ ok: false, message: String(error && error.message ? error.message : error) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="model-section" id="text-model" aria-labelledby="text-model-heading">
      <header className="model-section-heading">
        <div>
          <span className="eyebrow">02 · 从文字到成稿</span>
          <h2 id="text-model-heading">文字处理</h2>
          <p>智能整理、随便问、翻译和技能使用这里的服务；仅转写录音时可留空。</p>
        </div>
        <div className={`connection-badge ${result?.ok ? "success" : ""}`}>
          {result?.ok ? "文字测试通过" : result?.ok === false ? "文字测试失败" : "文字待测试"}
        </div>
      </header>

      <div className="panel form-panel">
        <div className="panel-title">
          <div className="icon-tile"><BookOpenText size={22} weight="bold" /></div>
          <div>
            <h3>OpenAI 兼容文字接口</h3>
            <p>使用 /chat/completions；随便问支持流式回答，不支持时回退完整响应。</p>
          </div>
        </div>
        <div className="form-grid">
          <Field label="文字 API 地址" hint="填写到 /v1 即可，例如 http://10.0.0.9:8000/v1；留空则不启用文字整理">
            <input
              value={settings.textEndpoint}
              placeholder={DEFAULT_SETTINGS.textEndpoint || "http://10.0.0.9:8000/v1"}
              onChange={(event) => patch({ textEndpoint: event.target.value })}
            />
          </Field>
          <Field label="文字模型名称" hint="例如 Qwen3-8B、deepseek-v3；留空则不启用文字整理">
            <input
              value={settings.textModel}
              onChange={(event) => patch({ textModel: event.target.value })}
            />
          </Field>
          <Field label="快速模型（可选）" hint="意图判断与翻译优先使用；留空时使用主模型。">
            <input value={settings.textFastModel || ""} onChange={(event) => patch({ textFastModel: event.target.value })} />
          </Field>
          <Field label="备用模型（可选）" hint="同一服务下的模型名称，用逗号分隔。仅超时、网络错误或限流时按顺序尝试。">
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
          <Field label="响应超时">
            <select
              value={settings.textTimeoutMs}
              onChange={(event) => patch({ textTimeoutMs: Number(event.target.value) })}
            >
              {TIMEOUT_PRESETS.map((preset) => (
                <option key={preset.value} value={preset.value}>{preset.label}</option>
              ))}
            </select>
          </Field>
          <Field label="文字 API Key" hint="保存后写入 Windows 凭据库，不进入配置文件与浏览器存储">
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
        <div className="form-actions">
          <button
            className="button secondary"
            onClick={testConnection}
            disabled={testing || savingKey || !settings.textEndpoint.trim() || !settings.textModel.trim()}
          >
            {testing ? <ArrowClockwise className="spin" size={18} /> : <PaperPlaneTilt size={18} />}
            {testing ? "正在测试文字" : "测试文字服务"}
          </button>
          <button
            className="button primary"
            onClick={saveKey}
            disabled={savingKey || testing || settings.textAuthMode === "none" || !key.trim() || previewMode}
          >
            <LockKey size={18} weight="fill" />
            {savingKey ? "保存中…" : "保存文字密钥"}
          </button>
        </div>
        {result && (
          <p className={`test-result ${result.ok === true ? "success" : result.ok === false ? "error" : ""}`}>
            {result.ok === true ? `返回：${result.message}` : result.message}
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
