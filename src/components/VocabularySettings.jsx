import { BookOpenText, Trash } from "@phosphor-icons/react";
import { correctionKey, MAX_RULES, MAX_AUTO_HOTWORDS } from "../vocabulary/rules.js";

export function VocabularySettings({ settings, setSettings, vocabulary, onDismiss, ready }) {
  const automaticLearningAvailable = !globalThis.window?.__TAURI_INTERNALS__ || !/Mac/.test(globalThis.navigator?.platform || "");
  const appleHints = settings.asrProvider === "apple";
  const hotwordCount = vocabulary.entries.filter((item) => item.kind === "hotword").length;
  const rows = (items, pending) => items.map((item) => (
    <div className="vocabulary-row" key={correctionKey(item)}>
      {item.kind === "hotword"
        ? <div><strong>{item.target}</strong><span className="vocabulary-variant">（原识别：{item.variant}）</span></div>
        : <div><span className="vocabulary-variant">{item.variant}</span><span aria-hidden="true"> → </span><strong>{item.target}</strong></div>}
      <span className="vocabulary-source">{pending ? "旧版候选" : item.kind === "hotword" ? "正确词提示" : item.source === "manual" ? "手动替换" : "旧版替换"}</span>
      <button className="icon-button" title={pending ? "忽略此纠正" : "删除并不再自动学习"} aria-label={item.kind === "hotword" ? `删除正确词 ${item.target}` : `删除 ${item.variant} 到 ${item.target}`} onClick={() => onDismiss(item)} disabled={!ready}><Trash size={17} /></button>
    </div>
  ));
  return <section className="page-content">
    <header className="page-heading"><div><span className="eyebrow">常用词</span><h1>个人词库</h1><p>保存常用名字、术语和明确的替换规则。</p></div></header>
    <div className="panel settings-list">
      <div><div><strong>自动学习正确词</strong><span>{automaticLearningAvailable ? "一次有效的短词纠正后，记住正确词。关闭后保留已有词条。" : "Mac 暂不自动观察输入框。可在历史中「纠正并记住」保存明确替换，或编辑下方手动规则。"}</span></div><button className={`toggle ${automaticLearningAvailable && settings.autoLearn ? "on" : ""}`} role="switch" aria-label="自动学习正确词" aria-checked={automaticLearningAvailable && settings.autoLearn} disabled={!automaticLearningAvailable} onClick={() => setSettings({ ...settings, autoLearn: !settings.autoLearn })}><i /></button></div>
    </div>
    {automaticLearningAvailable && <p className="vocabulary-help">自动输入后，在原输入框里改正短词并停留 4 秒。仅观察本次输入，最长 60 秒；切换输入框即停止。有效的近音纠正会保存正确词供支持的识别引擎参考，不新增强制替换。部分编辑器无法读取时，可在历史中明确教学；删除的词条不会再次自动加入。</p>}
    <p className="vocabulary-help">{appleHints ? "Apple 系统识别会接收词库中的正确词提示，实际识别结果仍以语音为准。" : "当前语音服务尚未接入已验证的热词接口。正确词提示会保留；手动和旧版替换规则继续在本机生效。"}</p>
    {!ready && <p role="status" className="test-result">词库尚未就绪，请查看提示后重新打开应用。</p>}
    <div className="panel form-panel compact">
      <div className="panel-title"><div className="icon-tile"><BookOpenText size={22} /></div><div><h2>已保存词条 <small>{vocabulary.entries.length} / {MAX_RULES}</small></h2><p>正确词提示 {hotwordCount} / {MAX_AUTO_HOTWORDS}；手动和旧版替换保留原有含义。</p></div></div>
      {vocabulary.entries.length ? rows(vocabulary.entries, false) : <p className="empty-text">还没有词条。可以在输入框或历史记录中纠正误识别。</p>}
    </div>
    {vocabulary.candidates.length > 0 && <div className="panel form-panel compact">
      <div className="panel-title"><div><h2>旧版待确认词条 <small>{vocabulary.candidates.length}</small></h2><p>这些是旧版本保留的候选，目前不生效。再次有效纠正时只保存正确词提示；候选 30 天后到期。</p></div></div>
      {rows(vocabulary.candidates, true)}
    </div>}
    <div className="panel form-panel compact">
      <div className="panel-title"><div><h2>手动规则</h2><p>每行一条：正确写法=误写1|误写2。手动规则优先，并会提供正确词提示。</p></div></div>
      <textarea aria-label="手动规则" value={settings.vocabulary} onChange={(e) => setSettings({ ...settings, vocabulary: e.target.value })} rows={5} />
    </div>
    <p className="vocabulary-help">学习对比在本机完成，只保存短词。支持热词的识别引擎会接收正确词提示；替换规则在本机执行。启用文字整理时，处理后的口述会发送给配置的文字服务。</p>
  </section>;
}
