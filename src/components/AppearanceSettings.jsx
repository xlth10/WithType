import { BRAND } from "../ui/brand.js";
import { normalizeWelcomeText, WELCOME_TEXT_LIMIT } from "../ui/welcome.js";

export function AppearanceSettings({ settings, setSettings, onReplayEntrance, ready }) {
  const patch = (welcomeText) => setSettings((current) => ({ ...current, welcomeText }));
  return <section className="page-content">
    <header className="page-heading"><div><span className="eyebrow">你的 WithType</span><h1>外观</h1><p>让每次进入，都有一句属于你的问候。</p></div></header>
    <div className="panel form-panel welcome-settings">
      <div className="panel-title"><div><h2>进入时的欢迎语</h2><p>墨珠落在纸上，化成你写下的文字。</p></div></div>
      <label className="field">
        <span>欢迎语</span>
        <input value={settings.welcomeText} placeholder={BRAND.welcome} disabled={!ready} spellCheck={false}
          onChange={(event) => patch(Array.from(event.target.value).slice(0, WELCOME_TEXT_LIMIT).join(""))}
          onBlur={(event) => patch(normalizeWelcomeText(event.target.value))}
          aria-label="欢迎语" aria-describedby="welcome-hint" />
        <small id="welcome-hint">最多 {WELCOME_TEXT_LIMIT} 个字符，自动保存在本机。留空使用默认欢迎语。</small>
      </label>
      <div className="form-actions">
        <button className="button primary" type="button" onClick={onReplayEntrance} disabled={!ready || !onReplayEntrance}>预览进入动画</button>
        <button className="button secondary" type="button" onClick={() => patch(BRAND.welcome)} disabled={!ready || settings.welcomeText === BRAND.welcome}>恢复默认</button>
      </div>
    </div>
  </section>;
}
