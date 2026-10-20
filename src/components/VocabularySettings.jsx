import { useId, useMemo, useRef, useState } from "react";
import { DownloadSimple, MagnifyingGlass, PencilSimple, Plus, Trash, UploadSimple, X } from "@phosphor-icons/react";
import { correctionKey, getAsrVocabularySummary, MAX_RULES, MAX_AUTO_HOTWORDS } from "../vocabulary/rules.js";
import { exportVocabularyCsv, MAX_CSV_BYTES, previewVocabularyCsv, validateVocabularyWord } from "../vocabulary/management.js";
import "./VocabularySettings.css";

const PAGE_SIZE = 25;
const IMPORT_BYTES = MAX_CSV_BYTES;
const sourceKey = (item) => item.source === "imported" ? "import" : ["auto", "manual", "import"].includes(item.source) ? item.source : "legacy";
const sourceLabel = (item) => ({ auto: "自动学习", manual: "手动", import: "导入", legacy: "旧版" })[sourceKey(item)];
const rowStatus = { add: "可新增", duplicate: "已存在", invalid: "无效", overflow: "超出容量" };
const learningReason = (reason) => ({ ready: "", accessibility_permission_required: "需要在系统设置中授予辅助功能权限，自动学习才会生效。", unsupported_platform: "当前环境无法自动观察外部输入框。可在历史记录中纠正，或直接添加正确词。", platform_unsupported: "当前环境无法自动观察外部输入框。可在历史记录中纠正，或直接添加正确词。" })[reason] ?? reason;

export function VocabularySettings({ settings, setSettings, vocabulary, onDismiss, onAddWord, onEditWord, onImportWords, onExportWords, ready, capability = {} }) {
  const id = useId();
  const [newWord, setNewWord] = useState("");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [source, setSource] = useState("all");
  const [page, setPage] = useState(1);
  const [editingKey, setEditingKey] = useState(null);
  const [editedWord, setEditedWord] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const [previewVisible, setPreviewVisible] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState("");
  const addInput = useRef(null);
  const fileInput = useRef(null);
  const editButtons = useRef(new Map());
  const entries = vocabulary.entries || [];
  const candidates = vocabulary.candidates || [];
  const hotwordCount = entries.filter((item) => item.kind === "hotword").length;
  const automaticLearningAvailable = Boolean(capability.automaticLearningAvailable);
  const hints = useMemo(() => getAsrVocabularySummary(settings.vocabulary, entries), [settings.vocabulary, entries]);
  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return entries.filter((item) => (kind === "all" || (kind === "hotword" ? item.kind === "hotword" : item.kind !== "hotword"))
      && (source === "all" || sourceKey(item) === source)
      && (!search || `${item.target}\n${item.variant || ""}`.toLocaleLowerCase().includes(search)));
  }, [entries, query, kind, source]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const preview = useMemo(() => previewVisible ? previewVocabularyCsv(csvText, vocabulary, settings.vocabulary) : null, [previewVisible, csvText, vocabulary, settings.vocabulary]);
  const disabled = !ready || Boolean(busy);
  const closeEdit = (key) => {
    setEditingKey(null); setError(null);
    requestAnimationFrame(() => (editButtons.current.get(key) || addInput.current)?.focus());
  };

  const perform = async (action, task, success) => {
    if (disabled) return false;
    setBusy(action); setError(null); setNotice("");
    try {
      const result = await task();
      if (result?.ok === false) throw new Error(result.error || "保存失败，请重试。");
      if (success) setNotice(success);
      return true;
    } catch (failure) {
      setError({ action, text: String(failure?.message || failure || "操作失败，请重试。") });
      return false;
    } finally { setBusy(""); }
  };
  const submitWord = async (event) => {
    event.preventDefault();
    const checked = validateVocabularyWord(newWord);
    if (!checked.valid) { setError({ action: "add", text: checked.reason }); return; }
    if (!onAddWord) return;
    if (await perform("add", () => onAddWord(checked.word), `已添加「${checked.word}」。`)) {
      setNewWord(""); addInput.current?.focus();
    }
  };
  const saveEdit = async (event, item) => {
    event.preventDefault();
    const checked = validateVocabularyWord(editedWord);
    if (!checked.valid) { setError({ action: "edit", text: checked.reason }); return; }
    if (await perform("edit", () => onEditWord(item, checked.word), "正确词已更新。")) closeEdit(correctionKey({ ...item, target: checked.word }));
  };
  const readFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPreviewVisible(false); setError(null); setNotice("");
    if (file.size > IMPORT_BYTES) { setError({ action: "import", text: "文件超过 1 MB，请拆分为较小的 CSV 文件后重试。" }); return; }
    setBusy("read");
    try { setCsvText(await file.text()); setFileName(file.name); }
    catch { setError({ action: "import", text: "无法读取这个文件，请重新选择或粘贴 CSV 内容。" }); }
    finally { setBusy(""); }
  };
  const showError = (action) => error?.action === action && <p className="vocab-error" role="alert">{error.text}</p>;

  return <section className="page-content vocabulary-settings">
    <header className="page-heading"><div><h1>个人词库</h1><p>记住名字和专业术语，让常用词写得更准确。</p></div></header>
    {!ready && <p role="status" className="vocab-error">词库尚未就绪，请查看应用提示后重试。</p>}
    <section className="panel form-panel vocab-add" aria-labelledby={`${id}-add-title`}>
      <h2 id={`${id}-add-title`}>添加正确词</h2>
      <p id={`${id}-add-help`} className="vocab-description">直接填写正确写法，例如人名、品牌或项目缩写，无需提供误识别。每词最多 40 字。</p>
      <form onSubmit={submitWord} className="vocab-add-form">
        <label className="field"><span className="vocab-sr-only">正确词</span><input ref={addInput} value={newWord} onChange={(event) => { setNewWord(event.target.value); if (error?.action === "add") setError(null); }} onKeyDown={(event) => { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }} placeholder="例如：WithType、徐翔、项目名称" maxLength={80} disabled={disabled} aria-describedby={`${id}-add-help`} aria-invalid={error?.action === "add" || undefined} autoComplete="off" /></label>
        <button type="submit" className="button primary" disabled={disabled || !newWord.trim() || !onAddWord}><Plus size={17} aria-hidden="true" />{busy === "add" ? "正在添加…" : "添加正确词"}</button>
      </form>{showError("add")}
    </section>
    <section className="panel form-panel compact vocab-library" aria-labelledby={`${id}-library-title`}>
      <div className="vocab-section-heading"><div><h2 id={`${id}-library-title`}>已保存词条 <small>{entries.length} / {MAX_RULES}</small></h2><p className="vocab-description">正确词 {hotwordCount} 条 · 明确替换 {entries.length - hotwordCount} 条</p></div><div className="vocab-file-actions">
        <button type="button" className="button secondary" disabled={disabled} aria-expanded={importOpen} aria-controls={`${id}-import`} onClick={() => { setImportOpen(!importOpen); setError(null); }}><UploadSimple size={17} aria-hidden="true" />导入 CSV</button>
        <button type="button" className="button secondary" disabled={disabled || (!entries.length && !settings.vocabulary.trim()) || !onExportWords} onClick={() => perform("export", () => onExportWords(exportVocabularyCsv(vocabulary, { manualVocabulary: settings.vocabulary })))}><DownloadSimple size={17} aria-hidden="true" />{busy === "export" ? "正在导出…" : "导出 CSV"}</button>
      </div></div><p className="vocab-description vocab-export-help">导出 CSV 包含已保存词条及下方手动规则。</p>{showError("export")}
      {importOpen && <section id={`${id}-import`} className="vocab-import" aria-labelledby={`${id}-import-title`}>
        <div className="vocab-section-heading"><h3 id={`${id}-import-title`}>导入前先核对</h3><button type="button" className="icon-button" aria-label="关闭 CSV 导入" disabled={Boolean(busy)} onClick={() => setImportOpen(false)}><X size={17} /></button></div>
        <p className="vocab-description">一列填写正确词；两列按「误写、正确写法」导入明确替换。也支持本应用导出的 CSV 文件。重复和无效词条会跳过。</p>
        <div className="vocab-import-file"><input className="vocab-sr-only" ref={fileInput} type="file" accept=".csv,text/csv" onChange={readFile} tabIndex={-1} /><button type="button" className="button secondary" disabled={disabled} onClick={() => fileInput.current?.click()}>{busy === "read" ? "正在读取…" : "选择 CSV 文件"}</button><span>{fileName || "UTF-8 编码，最大 1 MB、1,000 行"}</span></div>
        <label className="field"><span>或粘贴 CSV 内容</span><textarea value={csvText} rows={4} maxLength={IMPORT_BYTES} disabled={disabled} placeholder={'正确词\nWithType\n徐翔'} onChange={(event) => { setCsvText(event.target.value); setFileName(""); setPreviewVisible(false); if (error?.action === "import") setError(null); }} /></label>
        {!preview && <button type="button" className="button secondary vocab-preview-button" disabled={disabled || !csvText.trim()} onClick={() => { setPreviewVisible(true); setError(null); }}>预览词条</button>}
        {preview && <div className="vocab-import-preview">
          <p role="status" className="vocab-preview-summary">可新增 <strong>{preview.validCount}</strong> · 重复 {preview.duplicateCount} · 无效 {preview.invalidCount} · 超出容量 {preview.overflowCount}</p>
          {preview.errors?.length > 0 && <div role="alert">{preview.errors.map((message, index) => <p key={index} className="vocab-error">{typeof message === "string" ? message : message.reason || message.message}</p>)}</div>}
          {preview.rows?.length > 0 && <div className="vocab-preview-scroll"><table><caption className="vocab-sr-only">CSV 导入预览，显示前 15 条</caption><thead><tr><th scope="col">行</th><th scope="col">词条</th><th scope="col">结果</th></tr></thead><tbody>{preview.rows.slice(0, 15).map((item, index) => <tr key={`${item.line}-${index}`}><td>{item.line}</td><td><span>{item.kind === "hotword" ? item.target : `${item.variant || ""} → ${item.target}`}</span>{item.reason && <small>{item.reason}</small>}</td><td>{rowStatus[item.status] || item.status}</td></tr>)}</tbody></table></div>}
          {preview.rows?.length > 15 && <p className="vocab-description">仅展示前 15 条；统计包含全部 {preview.rows.length} 条。</p>}
          <div className="vocab-import-apply"><p className="vocab-description">确认后仅导入可新增词条，已有内容保留。</p><button type="button" className="button primary" disabled={disabled || !preview.canImport || !onImportWords} onClick={async () => {
            if (await perform("import", () => onImportWords(preview.entriesToAdd), "已完成导入，可在列表中查看。")) { setCsvText(""); setFileName(""); setPreviewVisible(false); setImportOpen(false); }
          }}>{busy === "import" ? "正在导入…" : `确认导入 ${preview.validCount} 条`}</button></div>
        </div>}{showError("import")}
      </section>}
      <div className="vocab-filter-row"><label className="field vocab-search"><span className="vocab-sr-only">搜索词条或误写</span><div className="input-with-icon"><MagnifyingGlass size={18} aria-hidden="true" /><input type="search" value={query} placeholder="搜索词条或误写" onChange={(event) => { setQuery(event.target.value); setPage(1); }} /></div></label>
        <label className="field"><span className="vocab-sr-only">按类型筛选</span><select value={kind} onChange={(event) => { setKind(event.target.value); setPage(1); }}><option value="all">全部类型</option><option value="hotword">正确词</option><option value="replacement">明确替换</option></select></label>
        <label className="field"><span className="vocab-sr-only">按来源筛选</span><select value={source} onChange={(event) => { setSource(event.target.value); setPage(1); }}><option value="all">全部来源</option><option value="manual">手动</option><option value="auto">自动学习</option><option value="import">导入</option><option value="legacy">旧版</option></select></label>
      </div>
      <p className="vocab-result-count" aria-live="polite">{filtered.length === entries.length ? `共 ${entries.length} 条词条` : `找到 ${filtered.length} 条，共 ${entries.length} 条`}</p>
      {filtered.length ? <ul className="vocab-entry-list">{visibleRows.map((item) => {
        const key = correctionKey(item);
        const isEditing = editingKey === key;
        return <li className="vocab-entry" key={key}>
          {isEditing ? <form className="vocab-edit-form" onSubmit={(event) => saveEdit(event, item)}><label className="field"><span className="vocab-sr-only">修改正确词 {item.target}</span><input value={editedWord} maxLength={80} autoFocus disabled={disabled} onKeyDown={(event) => { if (event.key === "Escape") closeEdit(key); if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }} onChange={(event) => setEditedWord(event.target.value)} aria-invalid={error?.action === "edit" || undefined} /></label><div className="vocab-row-actions"><button type="submit" className="button primary" disabled={disabled || !editedWord.trim()}>{busy === "edit" ? "正在保存…" : "保存"}</button><button type="button" className="button secondary" disabled={disabled} onClick={() => closeEdit(key)}>取消</button></div>{showError("edit")}</form>
            : <><div className="vocab-entry-copy"><div>{item.kind === "hotword" ? <strong>{item.target}</strong> : <><span className="vocab-variant">{item.variant}</span><span aria-label="替换为"> → </span><strong>{item.target}</strong></>}</div><small>{sourceLabel(item)} · {item.kind === "hotword" ? "正确词提示" : "明确替换"}{item.kind === "hotword" && item.source === "auto" && item.variant ? ` · 原识别：${item.variant}` : ""}</small></div><div className="vocab-row-actions">{item.kind === "hotword" && <button type="button" className="icon-button" ref={(node) => { if (node) editButtons.current.set(key, node); else editButtons.current.delete(key); }} disabled={disabled || !onEditWord} title="修改正确词" aria-label={`修改正确词 ${item.target}`} onClick={() => { setEditingKey(key); setEditedWord(item.target); setError(null); }}><PencilSimple size={18} /></button>}<button type="button" className="icon-button" disabled={disabled} title={item.kind === "hotword" ? "删除，且不再自动学习此词" : "删除这条替换"} aria-label={`删除${item.kind === "hotword" ? "正确词" : "替换"} ${item.target}`} onClick={() => perform("delete", () => onDismiss(item), `已删除「${item.target}」。`)}><Trash size={18} /></button></div></>}
        </li>;
      })}</ul> : <div className="vocab-empty"><p>{entries.length ? "没有符合筛选条件的词条。" : "还没有词条。先添加一个常用名字或专业术语。"}</p>{entries.length > 0 && <button type="button" className="button secondary" onClick={() => { setQuery(""); setKind("all"); setSource("all"); setPage(1); }}>清除筛选</button>}</div>}
      {pageCount > 1 && <nav className="vocab-pagination" aria-label="词条分页"><span>第 {currentPage} / {pageCount} 页</span><button type="button" className="button secondary" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>上一页</button><button type="button" className="button secondary" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>下一页</button></nav>}
      {showError("delete")}<p className="vocab-description vocab-delete-help">删除正确词后，不再自动学习此词；仍可手动添加回来。</p>
    </section>
    <section className="panel form-panel compact vocab-behavior" aria-labelledby={`${id}-behavior-title`}>
      <h2 id={`${id}-behavior-title`}>词库如何生效</h2>
      <div className="vocab-learning-row"><div><h3>自动学习正确词</h3><p className="vocab-description">{automaticLearningAvailable ? "口述后改正短词，符合条件的纠正会记住正确写法。关闭后保留已有词条。" : learningReason(capability.learningReason) || "当前环境无法自动观察外部输入框。可在历史记录中纠正，或直接添加正确词。"}</p></div><button type="button" className={`toggle ${automaticLearningAvailable && settings.autoLearn ? "on" : ""}`} role="switch" aria-label="自动学习正确词" aria-checked={Boolean(automaticLearningAvailable && settings.autoLearn)} disabled={!ready || !automaticLearningAvailable} onClick={() => setSettings({ ...settings, autoLearn: !settings.autoLearn })}><i /></button></div>
      {automaticLearningAvailable && <p className="vocab-description">{capability.learningPermissionGranted === false ? learningReason(capability.learningReason) || "需要在系统设置中授予辅助功能权限，自动学习才会生效。" : "只观察本次输入，改正后停留 4 秒；最长观察 60 秒，切换输入框即停止。无法读取的编辑器可在历史中纠正。"}</p>}
      <p className="vocab-description">自动学习词条 {entries.filter((item) => item.kind === "hotword" && item.source === "auto").length} / {MAX_AUTO_HOTWORDS}；达到上限后暂停新增，可在上方筛选并删除不再使用的词。</p>
      <div className="vocab-hint-summary"><h3>{capability.asrHintsAvailable ? `${capability.asrLabel || "当前识别服务"} · 正确词提示已接入` : "正确词已保存，当前识别服务暂未接入词提示"}</h3><p className="vocab-description">{capability.asrHintsAvailable ? `每次识别最多使用 ${hints.limit} 个正确词。当前选入 ${hints.words.length} 个${hints.omittedCount ? `，超出 ${hints.omittedCount} 个` : ""}；提示用于辅助识别，结果仍以语音为准。` : `已保留 ${hints.eligibleCount} 个去重后的有效词提示。当前服务不会收到这些词提示；明确替换规则继续在本机生效。`}</p>
        {hints.words.length > 0 && <details className="vocab-hint-details"><summary>{capability.asrHintsAvailable ? "查看下次识别可用词提示" : "查看已保留的词提示"}（{hints.words.length}）</summary><p className="vocab-description">优先选取手动规则、手动与导入词条，再选自动学习词，去重后每次最多 {hints.limit} 个。{hints.omittedCount > 0 ? `超出上限的 ${hints.omittedCount} 个词仍留在词库。` : ""}</p><ul>{hints.words.map((word) => <li key={word.toLocaleLowerCase()}>{word}</li>)}</ul></details>}
      </div>
    </section>
    <section className="panel form-panel compact vocab-manual" aria-labelledby={`${id}-rules-title`}>
      <h2 id={`${id}-rules-title`}>明确替换规则</h2><p id={`${id}-rules-help`} className="vocab-description">需要固定替换时再设置。每行一条：正确写法=误写1|误写2。这里的手动规则优先，也会提供正确词提示。</p>
      <label className="field"><span className="vocab-sr-only">明确替换规则</span><textarea aria-describedby={`${id}-rules-help`} value={settings.vocabulary} disabled={!ready} onChange={(event) => setSettings({ ...settings, vocabulary: event.target.value })} rows={4} placeholder="WithType=with type|威思泰普" /></label>
    </section>
    {candidates.length > 0 && <details className="vocab-legacy"><summary>旧版待确认词条（{candidates.length}）</summary><p className="vocab-description">这些候选目前不生效。再次有效纠正时只保存正确词提示；候选 30 天后到期。</p><ul className="vocab-entry-list">{candidates.map((item) => <li className="vocab-entry" key={correctionKey(item)}><div className="vocab-entry-copy"><span>{item.variant} → <strong>{item.target}</strong></span></div><button type="button" className="icon-button" aria-label={`忽略候选 ${item.target}`} disabled={disabled} onClick={() => perform("delete", () => onDismiss(item))}><Trash size={18} /></button></li>)}</ul></details>}
    {notice && <p className="vocab-notice" role="status">{notice}</p>}
    <p className="vocab-privacy">学习对比在本机完成，只保存短词。支持词提示的识别服务会接收正确词；启用文字整理时，口述内容会发送给已配置的文字服务。</p>
  </section>;
}
