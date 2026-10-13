import { BookOpenText, Trash } from "@phosphor-icons/react";
import { correctionKey, MAX_RULES } from "../vocabulary/learning.js";

export function VocabularySettings({ settings, setSettings, vocabulary, onDismiss, ready }) {
  const rows = (items, pending) => items.map((item) => (
    <div className="vocabulary-row" key={correctionKey(item)}>
      <div><span className="vocabulary-variant">{item.variant}</span><span aria-hidden="true"> → </span><strong>{item.target}</strong></div>
      <span className="vocabulary-source">{pending ? "1 / 2 次" : item.source === "manual" ? "主动纠正" : "自动学到"}</span>
      <button className="icon-button" title={pending ? "忽略此纠正" : "删除并不再自动学习"} aria-label={`删除 ${item.variant} 到 ${item.target}`} onClick={() => onDismiss(item)} disabled={!ready}><Trash size={17} /></button>
    </div>
  ));
  return <section className="page-content">
    <header className="page-heading"><div><span className="eyebrow">越用越懂你的词</span><h1>个人词库</h1><p>你纠正过的人名、产品名和术语，在下一次口述中自动使用。</p></div></header>
    <div className="panel settings-list">
      <div><div><strong>自动学习纠正</strong><span>同一改法在两次口述后出现，才会加入词库。关闭后保留已学词条。</span></div><button className={`toggle ${settings.autoLearn ? "on" : ""}`} role="switch" aria-label="自动学习纠正" aria-checked={settings.autoLearn} onClick={() => setSettings({ ...settings, autoLearn: !settings.autoLearn })}><i /></button></div>
    </div>
    <p className="vocabulary-help">自动输入后，在原输入框里改正文字并停留 4 秒。仅观察本次输入，最长 60 秒；切换输入框即停止。部分编辑器无法读取时，可在历史记录中点击「纠正并记住」。候选 30 天过期，删除的纠正不会再自动学入。</p>
    {!ready && <p role="status" className="test-result">词库尚未就绪，请查看提示后重新打开应用。</p>}
    <div className="panel form-panel compact">
      <div className="panel-title"><div className="icon-tile"><BookOpenText size={22} /></div><div><h2>已经记住 <small>{vocabulary.entries.length} / {MAX_RULES}</small></h2><p>自动纠正和主动教学共用这份词库，不会改动你的手动词典。</p></div></div>
      {vocabulary.entries.length ? rows(vocabulary.entries, false) : <p className="empty-text">还没有学到词汇。照常说话，遇到误识别时纠正它。</p>}
    </div>
    <div className="panel form-panel compact">
      <div className="panel-title"><div><h2>等待再次纠正 <small>{vocabulary.candidates.length}</small></h2><p>这些候选尚未生效，只有再次遇到相同纠正才会记住。</p></div></div>
      {vocabulary.candidates.length ? rows(vocabulary.candidates, true) : <p className="empty-text">暂无候选。</p>}
    </div>
    <div className="panel form-panel compact">
      <div className="panel-title"><div><h2>手动词典</h2><p>每行一条：正确写法=误写1|误写2。手动词优先。</p></div></div>
      <textarea aria-label="手动词典" value={settings.vocabulary} onChange={(e) => setSettings({ ...settings, vocabulary: e.target.value })} rows={5} />
    </div>
    <p className="vocabulary-help">学习对比在本机完成，只保存短词规则。规则会本地修正识别结果；启用文字整理时，修正后的口述会发送给你配置的文字模型。</p>
  </section>;
}
