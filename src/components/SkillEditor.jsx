import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowClockwise, ArrowRight, Check, Copy, FloppyDisk, Keyboard, Microphone, Plus, Sparkle, Stop, Trash, WarningCircle, X } from "@phosphor-icons/react";
import { BUILTIN_SKILLS, SKILL_LIMITS, copyBuiltinAsCustom } from "../text/builtinSkills.js";
import { createSkillId, validateCustomSkill } from "../text/skillValidation.js";
import { scenarioFor } from "../text/skillScenarios.js";
import { createSkillEditorSession, skillEditorSessionReducer } from "../text/skillEditorSession.js";
import { cloneSkill, missingInfoPolicyFor, normalizeExamples, skillPreviewKey, SKILL_SCHEMA_VERSION } from "../text/skillContract.js";
import { displayShortcut } from "../shortcuts/capture.js";

const EMPTY = { id: "", name: "", description: "", instruction: "", outputFormat: "plain", schemaVersion: SKILL_SCHEMA_VERSION, revision: 1, missingInfoPolicy: "omit", examples: [] };
function Field({ label, hint, children }) {
  return <label className="field full-width"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

/** Select a scenario, try its output, then use it once or bind an explicit entry. */
export function SkillEditor({ customSkills, selectedSkillId, dailySkillId, onSelect, onSelectDaily, onRun, onSaveCustomSkills, pipeline, settings, onNotice, busy = false, running = false, onDeliveryChange, editorSession, setEditorSession, onConfigureTextService }) {
  const session = editorSession ?? createSkillEditorSession(selectedSkillId);
  const { viewedId, draft, sampleText } = session;
  const updateSession = (action) => setEditorSession((current) => skillEditorSessionReducer(current ?? createSkillEditorSession(selectedSkillId), action));
  const [errors, setErrors] = useState([]);
  const [preview, setPreview] = useState(null);
  const [trialOutput, setTrialOutput] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const saving = Boolean(session.pendingOperation);
  const submissionStarted = useRef(false);
  const previewGeneration = useRef(0);
  useEffect(() => () => { previewGeneration.current += 1; }, []);
  const allSkills = useMemo(() => [...BUILTIN_SKILLS, ...customSkills.filter((s) => s.enabled !== false)], [customSkills]);
  const selected = allSkills.find((skill) => skill.id === viewedId) || allSkills[0];
  const scenario = scenarioFor(selected);
  const modelReady = Boolean(settings.textEndpoint && settings.textModel);
  const desktopMode = typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
  const dailySkillName = allSkills.find((skill) => skill.id === dailySkillId)?.name;
  const locked = busy || saving;
  const currentTemplate = draft || selected;
  const previewStale = Boolean(preview?.ok && preview.key !== skillPreviewKey(currentTemplate, sampleText));
  const setExamples = (examples) => updateSession({ type: "draft-field", field: "examples", value: examples });
  const saveTrialExample = () => {
    if (locked || previewStale || !preview?.ok || !trialOutput.trim()) return;
    const base = draft || (selected.source === "builtin" ? copyBuiltinAsCustom(selected, createSkillId()) : cloneSkill(selected));
    const checked = normalizeExamples([...(base.examples || []), { input: preview.input, output: trialOutput }]);
    setErrors(checked.errors);
    if (checked.errors.length) return;
    updateSession({ type: "edit", draft: { ...base, examples: checked.examples } });
    onNotice({ text: "参考样例已加入草稿，保存模板后生效；请换一段文字再试用", ok: true });
  };

  const select = (skill) => {
    previewGeneration.current += 1;
    updateSession({ type: "select", skill }); setPreview(null); setErrors([]); setPreviewing(false);
  };
  const edit = (skill) => {
    previewGeneration.current += 1;
    updateSession({ type: "edit", draft: skill }); setErrors([]); setPreview(null); setPreviewing(false);
  };
  const save = async () => {
    if (saving || submissionStarted.current) return;
    const { skill, errors: found } = validateCustomSkill(draft, { existing: customSkills });
    setErrors(found);
    if (found.length) return;
    const operation = { kind: "save", revision: session.revision ?? 0 };
    submissionStarted.current = true;
    updateSession({ type: "operation-started", operation });
    try {
      const next = customSkills.some((s) => s.id === skill.id) ? customSkills.map((s) => s.id === skill.id ? skill : s) : [...customSkills, skill];
      await onSaveCustomSkills(next);
      updateSession({ type: "operation-succeeded", operation, skill }); setPreview(null);
      onNotice({ text: `模板「${skill.name}」已保存，可试用或设为默认`, ok: true });
    } catch (error) {
      const message = String(error?.message || error);
      setErrors([message]); onNotice({ text: `保存模板失败：${message}`, ok: false });
    } finally {
      updateSession({ type: "operation-finished", operation });
      submissionStarted.current = false;
    }
  };
  const remove = async () => {
    if (saving || submissionStarted.current) return;
    if (!window.confirm(`删除模板「${selected.name}」？绑定的入口会恢复默认。`)) return;
    const operation = { kind: "remove", revision: session.revision ?? 0 };
    submissionStarted.current = true;
    updateSession({ type: "operation-started", operation });
    try {
      await onSaveCustomSkills(customSkills.filter((s) => s.id !== selected.id));
      updateSession({ type: "operation-succeeded", operation });
      onNotice({ text: "模板已删除", ok: true });
    } catch (error) {
      const message = String(error?.message || error);
      setErrors([message]); onNotice({ text: `删除模板失败：${message}`, ok: false });
    } finally {
      updateSession({ type: "operation-finished", operation });
      submissionStarted.current = false;
    }
  };
  const runPreview = async () => {
    let skill = selected;
    if (draft) {
      const validated = validateCustomSkill(draft, { existing: customSkills });
      setErrors(validated.errors);
      if (validated.errors.length) return;
      skill = validated.skill;
    }
    const requestKey = skillPreviewKey(skill, sampleText);
    const input = sampleText;
    const generation = ++previewGeneration.current;
    setPreviewing(true); setPreview(null);
    try {
      const result = await pipeline.preview({ settings, skill, rawText: sampleText });
      if (generation === previewGeneration.current) { setPreview({ ...result, key: requestKey, input }); setTrialOutput(result.text || ""); }
    } catch (error) {
      if (generation === previewGeneration.current) setPreview({ ok: false, error: String(error?.message || error) });
    } finally { if (generation === previewGeneration.current) setPreviewing(false); }
  };

  return <section className="page-content skills-page">
    <header className="page-heading"><div><span className="eyebrow">文字处理</span><h1>整理模板</h1><p>润色日常表达，或整理成邮件、汇报和纪要；也可以保存自己的整理要求。</p></div><button className="button secondary" onClick={() => edit({ ...EMPTY, id: createSkillId() })} disabled={locked || Boolean(draft)}><Plus size={17} />新建模板</button></header>
    <div className={`skill-layout ${draft ? "editing" : ""}`}>
      {!draft && <aside className="skill-list panel" aria-label="整理模板列表">
        <div className="skill-list-heading">常用模板 <span>{allSkills.length}</span></div>
        {allSkills.map((skill) => <button key={skill.id} className={`skill-item ${selected?.id === skill.id && !draft ? "selected" : ""}`} aria-pressed={selected?.id === skill.id && !draft} onClick={() => select(skill)} disabled={locked}>
          <span className="skill-item-head"><strong>{skill.name}</strong><span className="skill-category">{scenarioFor(skill).category}</span></span>
          <small>{scenarioFor(skill).when}</small>
          {(skill.id === selectedSkillId || skill.id === dailySkillId) && <span className="skill-binding-label"><Check size={12} />{skill.id === selectedSkillId ? "动作快捷键" : "语音输入"}</span>}
        </button>)}
      </aside>}
      <div className="skill-detail">
        {draft ? <section className="panel form-panel skill-editor-panel">
          <div className="panel-title"><div className="icon-tile"><Sparkle size={22} /></div><div><h2>{customSkills.some((s) => s.id === draft.id) ? "编辑模板" : "新建模板"}</h2><p>{saving ? "正在保存提交时的内容；你可以继续编辑，新增修改需再次保存。" : "切换页面后可继续编辑，关闭应用前请保存。"}</p></div></div>
          <div className="form-grid">
            <Field label="模板名称" hint={`最多 ${SKILL_LIMITS.name} 字`}><input value={draft.name} placeholder="例如：客户沟通记录" onChange={(e) => updateSession({ type: "draft-field", field: "name", value: e.target.value })} /></Field>
            <Field label="适用场景" hint="选填，一句话说明适用场景"><input value={draft.description} placeholder="例如：拜访客户后，快速整理需求和下一步" onChange={(e) => updateSession({ type: "draft-field", field: "description", value: e.target.value })} /></Field>
            <Field label="输出格式"><select value={draft.outputFormat} onChange={(e) => updateSession({ type: "draft-field", field: "outputFormat", value: e.target.value })}><option value="plain">纯文本 · 适合邮件和聊天</option><option value="markdown">Markdown · 适合笔记和文档</option></select></Field>
            <Field label="整理要求" hint="必填，描述想得到什么、如何组织，以及需要保留的信息。"><textarea rows={7} value={draft.instruction} placeholder="描述要输出什么、如何组织，以及哪些信息必须保留…" onChange={(e) => updateSession({ type: "draft-field", field: "instruction", value: e.target.value })} /></Field>
            <Field label="缺少信息时" hint="只影响没有内容的栏目；口述中明确的未定事项仍会保留。"><select value={missingInfoPolicyFor(draft)} onChange={(e) => updateSession({ type: "draft-field", field: "missingInfoPolicy", value: e.target.value })}><option value="omit">省略空栏目</option><option value="mark">标为待确认</option></select></Field>
          </div>
          <details className="skill-examples" open={(draft.examples || []).length > 0 ? true : undefined}>
            <summary>参考样例（选填） · {(draft.examples || []).length}/{SKILL_LIMITS.examples}</summary>
            <p className="scenario-cue">这些样例会发给模型，用来示范写法。每项最多 {SKILL_LIMITS.exampleText} 字，合计最多 {SKILL_LIMITS.examplesTotal} 字。</p>
            {(draft.examples || []).map((example, index) => <div className="skill-example" key={index}>
              <div className="skill-example-heading"><strong>样例 {index + 1}</strong><button className="button quiet" type="button" aria-label={`删除样例 ${index + 1}`} onClick={() => setExamples(draft.examples.filter((_, at) => at !== index))}>删除</button></div>
              <Field label={`样例 ${index + 1} 原始口述`}><textarea rows={3} value={example.input} onChange={(e) => setExamples(draft.examples.map((item, at) => at === index ? { ...item, input: e.target.value } : item))} /></Field>
              <Field label={`样例 ${index + 1} 期望结果`}><textarea rows={3} value={example.output} onChange={(e) => setExamples(draft.examples.map((item, at) => at === index ? { ...item, output: e.target.value } : item))} /></Field>
            </div>)}
            <button type="button" className="button secondary" disabled={(draft.examples || []).length >= SKILL_LIMITS.examples || saving} onClick={() => setExamples([...(draft.examples || []), { input: "", output: "" }])}><Plus size={16} />添加参考样例</button>
          </details>
          <div className="form-actions"><button className="button secondary" disabled={saving} onClick={() => { edit(null); }}><X size={17} />取消编辑</button><button className="button primary" onClick={save} disabled={locked}><FloppyDisk size={17} />{saving ? "正在保存…" : "保存模板"}</button></div>
        </section> : <section className="panel form-panel skill-scenario">
          <div className="panel-title"><div className="icon-tile"><Sparkle size={22} /></div><div><span className="skill-category">{scenario.category} · {selected.source === "builtin" ? "内置模板" : "我的模板"}</span><h2>{selected.name}</h2></div></div>
          <p className="scenario-description">{scenario.when}</p><p className="scenario-cue">{scenario.cue}</p>
          <div className="skill-run-row"><button className="button primary" disabled={locked && !running} onClick={() => onRun(selected.id)}>{running ? <Stop size={17} weight="fill" /> : <Microphone size={17} weight="fill" />}{running ? "结束并整理" : "按此模板录音"}</button><span>这次录音的结果显示为卡片，快捷键设置保持原样。</span></div>
          <div className="skill-bindings">
            <button disabled={locked} className={selected.id === dailySkillId ? "bound" : ""} onClick={() => onSelectDaily(selected.id === dailySkillId ? "" : selected.id)}><Microphone size={18} /><span><strong>{selected.id === dailySkillId ? "已设为默认 · 恢复自动整理" : "设为默认模板"}</strong><small>{dailySkillName ? `当前默认：${dailySkillName}` : "当前未设默认模板"} · {displayShortcut(settings.shortcut)} 语音输入</small></span>{selected.id === dailySkillId ? <Check size={17} /> : <ArrowRight size={17} />}</button>
          </div>
          <details className="skill-binding-options"><summary>更多用法与整理要求{selected.id === selectedSkillId && " · 已用于动作快捷键"}</summary>
          <div className="skill-delivery" role="group" aria-label="模板结果去向"><span>结果去向</span><button aria-pressed={settings.skillDelivery !== "card"} onClick={() => onDeliveryChange("paste")} disabled={locked}>输入到光标处</button><button aria-pressed={settings.skillDelivery === "card"} onClick={() => onDeliveryChange("card")} disabled={locked}>显示为卡片</button></div>
          <div className="skill-bindings">
            <button disabled={locked} className={selected.id === selectedSkillId ? "bound" : ""} onClick={() => onSelect(selected.id)}><Keyboard size={18} /><span><strong>{selected.id === selectedSkillId ? "已用于动作快捷键" : "用于动作快捷键"}</strong><small>{displayShortcut(settings.actionShortcut)} · 语音输入单独设置</small></span>{selected.id === selectedSkillId ? <Check size={17} /> : <ArrowRight size={17} />}</button>
          </div>
          <p className="scenario-cue">缺项：{missingInfoPolicyFor(selected) === "mark" ? "标为待确认" : "省略空栏目"} · 参考样例：{(selected.examples || []).length} 组 · 版本 {selected.revision || 1}</p>
          <details className="skill-rules"><summary>查看整理要求</summary><pre className="skill-instruction">{selected.instruction}</pre></details>
          <div className="form-actions">{selected.source === "builtin" ? <button className="button secondary" disabled={locked} onClick={() => edit(copyBuiltinAsCustom(selected, createSkillId()))}><Copy size={17} />复制并调整</button> : <><button className="button secondary" disabled={locked} onClick={() => edit({ ...selected })}>编辑模板</button><button className="button quiet" disabled={locked} onClick={remove}><Trash size={16} />删除</button></>}</div>
          </details>
        </section>}
        {errors.length > 0 && <ul className="error-list" role="alert">{errors.map((message) => <li key={message}><WarningCircle size={15} />{message}</li>)}</ul>}
        <section className="panel form-panel skill-tryout">
          <div className="panel-title"><div><h2>试用模板</h2><p>先用一段自己的文字，看看整理结果是否合适。</p></div><span className="skill-category">{(draft?.outputFormat || selected.outputFormat) === "markdown" ? "Markdown" : "纯文本"}</span></div>
          <label className="field"><span>试用文字</span><textarea rows={4} value={sampleText} onChange={(e) => updateSession({ type: "sample", value: e.target.value })} aria-label="模板试用文字" /></label>
          <div className={`preview-box ${preview && !preview.ok ? "error" : ""}`} aria-live="polite"><span className="preview-label">{previewing ? "正在整理…" : preview ? preview.ok ? previewStale ? "配置已更改，请重新试用" : "试用结果 · 可修改后保存为样例" : "试用未完成" : "参考示例"}</span>{preview?.ok ? <label className="field"><span>期望结果（可修改）</span><textarea rows={5} value={trialOutput} onChange={(e) => setTrialOutput(e.target.value)} /></label> : <p>{preview ? preview.error : !draft && scenario.output ? scenario.output : "点击试用，看看这段内容会如何整理。"}</p>}</div>
          {preview?.ok && <div className="skill-preview-actions"><span>认可或修改后，主动保存才会成为模板的参考样例。</span><button className="button secondary" disabled={locked || previewing || previewStale || !trialOutput.trim()} onClick={saveTrialExample}>保存为参考样例</button></div>}
          <div className="skill-preview-actions"><span>{modelReady ? desktopMode ? "试用会调用当前文字服务，不保存历史或自动输入。" : "当前为浏览器预览，试用仅模拟交互；真实模型效果请在桌面应用中检查。" : "先设置文字服务；返回后可继续试用当前文字。"}</span>{modelReady ? <button className="button secondary" onClick={runPreview} disabled={previewing || locked || !sampleText.trim()}>{previewing ? <ArrowClockwise className="spin" size={17} /> : <Sparkle size={17} />}{previewing ? "正在试用" : "试用这段文字"}</button> : <button className="button secondary" onClick={onConfigureTextService} disabled={locked}>设置文字服务<ArrowRight size={17} /></button>}</div>
        </section>
      </div>
    </div>
  </section>;
}
