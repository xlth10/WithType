import { BookOpenText, Trash } from "@phosphor-icons/react";
import { correctionKey, MAX_RULES } from "../vocabulary/rules.js";

export function VocabularySettings({ settings, setSettings, vocabulary, onDismiss, ready }) {
  const automaticLearningAvailable = !globalThis.window?.__TAURI_INTERNALS__ || !/Mac/.test(globalThis.navigator?.platform || "");
  const rows = (items, pending) => items.map((item) => (
    <div className="vocabulary-row" key={correctionKey(item)}>
      <div><span className="vocabulary-variant">{item.variant}</span><span aria-hidden="true"> → </span><strong>{item.target}</strong></div>
      <span className="vocabulary-source">{pending ? "1 / 2 次" : item.source === "manual" ? "手动纠正" : "自动学习"}</span>
      <button className="icon-button" title={pending ? "忽略此纠正" : "删除并不再自动学习"} aria-label={`删除 ${item.variant} 到 ${item.target}`} onClick={() => onDismiss(item)} disabled={!ready}><Trash size={17} /></button>
    </div>
  ));
  return <section className="page-content">
    <header className="page-heading"><div><span className="eyebrow">常用词</span><h1>个人词库</h1><p>收录你常用的名字和术语，在后续输入中纠正误识别。</p></div></header>
    <div className="panel settings-list">
      <div><div><strong>自动学习词条</strong><span>{automaticLearningAvailable ? "同一短词在两次语音输入中被纠正后，加入词库。关闭后保留已有词条。" : "Mac 版请在历史记录中点击「纠正并记住」，或编辑下方手动规则。"}</span></div><button className={`toggle ${automaticLearningAvailable && settings.autoLearn ? "on" : ""}`} role="switch" aria-label="自动学习词条" aria-checked={automaticLearningAvailable && settings.autoLearn} disabled={!automaticLearningAvailable} onClick={() => setSettings({ ...settings, autoLearn: !settings.autoLearn })}><i /></button></div>
    </div>
    {automaticLearningAvailable && <p className="vocabulary-help">自动输入后，在原输入框里改正文字并停留 4 秒。仅观察本次输入，最长 60 秒；切换输入框即停止。部分编辑器无法读取时，可在历史记录中点击「纠正并记住」。待确认词条 30 天内未再次纠正则移除；删除的词条不会再次自动加入。</p>}
    {!ready && <p role="status" className="test-result">词库尚未就绪，请查看提示后重新打开应用。</p>}
    <div className="panel form-panel compact">
      <div className="panel-title"><div className="icon-tile"><BookOpenText size={22} /></div><div><h2>已保存词条 <small>{vocabulary.entries.length} / {MAX_RULES}</small></h2><p>自动学习和手动纠正都保存在这里，手动规则单独设置。</p></div></div>
      {vocabulary.entries.length ? rows(vocabulary.entries, false) : <p className="empty-text">还没有词条。你可以在输入框或历史记录中纠正误识别。</p>}
    </div>
    <div className="panel form-panel compact">
      <div className="panel-title"><div><h2>待确认词条 <small>{vocabulary.candidates.length}</small></h2><p>再次出现相同纠正后才会生效，30 天内未确认则移除。</p></div></div>
      {vocabulary.candidates.length ? rows(vocabulary.candidates, true) : <p className="empty-text">没有待确认的词条。</p>}
    </div>
    <div className="panel form-panel compact">
      <div className="panel-title"><div><h2>手动规则</h2><p>每行一条：正确写法=误写1|误写2。手动规则优先。</p></div></div>
      <textarea aria-label="手动规则" value={settings.vocabulary} onChange={(e) => setSettings({ ...settings, vocabulary: e.target.value })} rows={5} />
    </div>
    <p className="vocabulary-help">学习对比在本机完成，只保存短词规则。规则会本地修正识别结果；启用文字整理时，修正后的口述会发送给你配置的文字服务。</p>
  </section>;
}
