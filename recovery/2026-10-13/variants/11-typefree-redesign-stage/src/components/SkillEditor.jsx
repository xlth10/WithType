import { useMemo, useRef, useState } from "react";
import { ArrowClockwise, ArrowRight, Check, Copy, FloppyDisk, Keyboard, Microphone, Plus, Sparkle, Stop, Trash, WarningCircle, X } from "@phosphor-icons/react";
import { BUILTIN_SKILLS, SKILL_LIMITS, copyBuiltinAsCustom } from "../text/builtinSkills.js";
import { createSkillId, validateCustomSkill } from "../text/skillValidation.js";
import { scenarioFor } from "../text/skillScenarios.js";
import { displayShortcut } from "../shortcuts/capture.js";

const EMPTY = { id: "", name: "", description: "", instruction: "", outputFormat: "plain" };
function Field({ label, hint, children }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

/** Select a scenario, try its output, then use it once or bind an explicit entry. */
export function SkillEditor({ customSkills, selectedSkillId, dailySkillId, onSelect, onSelectDaily, onRun, onSaveCustomSkills, pipeline, settings, onNotice, busy = false, running = false, onDeliveryChange }) {
  const [viewedId, setViewedId] = useState(selectedSkillId || BUILTIN_SKILLS[0].id);
  const [draft, setDraft] = useState(null);
  const [errors, setErrors] = useState([]);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sampleText, setSampleText] = useState(scenarioFor(BUILTIN_SKILLS.find((s) => s.id === viewedId)).input);
  const previewGeneration = useRef(0);
  const allSkills = useMemo(() => [...BUILTIN_SKILLS, ...customSkills.filter((s) => s.enabled !== false)], [customSkills]);
  const selected = allSkills.find((skill) => skill.id === viewedId) || allSkills[0];
  const scenario = scenarioFor(selected);
  const modelReady = Boolean(settings.textEndpoint && settings.textModel);
  const locked = busy || saving;

  const select = (skill) => {
    previewGeneration.current += 1;
    setViewedId(skill.id); setSampleText(scenarioFor(skill).input); setPreview(null); setErrors([]); setPreviewing(false);
  };
  const edit = (skill) => {
    previewGeneration.current += 1;
    setDraft(skill); setErrors([]); setPreview(null); setPreviewing(false);
  };
  const save = async () => {
    const { skill, errors: found } = validateCustomSkill(draft, { existing: customSkills });
    setErrors(found);
    if (found.length) return;
    setSaving(true);
    try {
      const next = customSkills.some((s) => s.id === skill.id) ? customSkills.map((s) => s.id === skill.id ? skill : s) : [...customSkills, skill];
      await onSaveCustomSkills(next);
      setDraft(null); setViewedId(skill.id); setPreview(null);
      onNotice({ text: `技能「${skill.name}」已保存，可以试用或绑定`, ok: true });
    } catch (error) { setErrors([String(error?.message || error)]); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    if (!window.confirm(`删除技能「${selected.name}」？绑定的入口会恢复默认。`)) return;
    setSaving(true);
    try {
      await onSaveCustomSkills(customSkills.filter((s) => s.id !== selected.id));
      select(BUILTIN_SKILLS[0]);
      onNotice({ text: "技能已删除", ok: true });
    } catch (error) { setErrors([String(error?.message || error)]); }
    finally { setSaving(false); }
  };
  const runPreview = async () => {
    let skill = selected;
    if (draft) {
      const validated = validateCustomSkill(draft, { existing: customSkills });
      setErrors(validated.errors);
      if (validated.errors.length) return;
      skill = validated.skill;
    }
    const generation = ++previewGeneration.current;
    setPreviewing(true); setPreview(null);
    try {
      const result = await pipeline.preview({ settings, skill, rawText: sampleText });
      if (generation === previewGeneration.current) setPreview(result);
    } catch (error) {
      if (generation === previewGeneration.current) setPreview({ ok: false, error: String(error?.message || error) });
    } finally { if (generation === previewGeneration.current) setPreviewing(false); }
  };

  return <section className="page-content skills-page">
    <header className="page-heading"><div><span className="eyebrow">把话整理成你需要的样子</span><h1>选个场景，再开口。</h1><p>技能是一种固定写法。先看看效果，再决定用一次，还是留给快捷键。</p></div><button className="button secondary" onClick={() => edit({ ...EMPTY, id: createSkillId() })} disabled={locked || Boolean(draft)}><Plus size={17} />新建技能</button></header>
    <div className="skill-layout">
      <aside className="skill-list panel" aria-label="技能场景">
        <div className="skill-list-heading">常用场景 <span>{allSkills.length}</span></div>
        {allSkills.map((skill) => <button key={skill.id} className={`skill-item ${selected?.id === skill.id && !draft ? "selected" : ""}`} onClick={() => select(skill)} disabled={locked || Boolean(draft)}>
          <span className="skill-item-head"><strong>{skill.name}</strong><span className="skill-category">{scenarioFor(skill).category}</span></span>
          <small>{scenarioFor(skill).when}</small>
          {(skill.id === selectedSkillId || skill.id === dailySkillId) && <span className="skill-binding-label"><Check size={12} />{skill.id === selectedSkillId ? "动作快捷键" : "日常口述"}</span>}
        </button>)}
      </aside>
      <div className="skill-detail">
        {draft ? <section className="panel form-panel skill-editor-panel">
          <div className="panel-title"><div className="icon-tile"><Sparkle size={22} /></div><div><h2>{customSkills.some((s) => s.id === draft.id) ? "编辑技能" : "创建一种写法"}</h2><p>写清使用场景、输出结构和需要保留的信息。</p></div></div>
          <div className="form-grid">
            <Field label="技能名称" hint={`最多 ${SKILL_LIMITS.name} 字`}><input value={draft.name} placeholder="例如：客户沟通记录" onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
            <Field label="什么时候使用" hint="一句话说明适用场景"><input value={draft.description} placeholder="例如：拜访客户后，快速整理需求和下一步" onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
            <Field label="输出格式"><select value={draft.outputFormat} onChange={(e) => setDraft({ ...draft, outputFormat: e.target.value })}><option value="plain">纯文本 · 适合邮件和聊天</option><option value="markdown">Markdown · 适合笔记和文档</option></select></Field>
            <Field label="整理要求" hint="例如：分为需求、已确认事项、待办三部分；缺失信息写待确认。"><textarea rows={7} value={draft.instruction} placeholder="描述要输出什么、如何组织，以及哪些信息必须保留…" onChange={(e) => setDraft({ ...draft, instruction: e.target.value })} /></Field>
          </div>
          <div className="form-actions"><button className="button secondary" disabled={saving} onClick={() => { edit(null); }}><X size={17} />取消编辑</button><button className="button primary" onClick={save} disabled={locked}><FloppyDisk size={17} />{saving ? "保存中…" : "保存技能"}</button></div>
        </section> : <section className="panel form-panel skill-scenario">
          <div className="panel-title"><div className="icon-tile"><Sparkle size={22} /></div><div><span className="skill-category">{scenario.category} · {selected.source === "builtin" ? "内置写法" : "我的写法"}</span><h2>{selected.name}</h2></div></div>
          <p className="scenario-description">{scenario.when}</p><p className="scenario-cue">{scenario.cue}</p>
          <div className="skill-run-row"><button className="button primary" disabled={locked && !running} onClick={() => onRun(selected.id)}>{running ? <Stop size={17} weight="fill" /> : <Microphone size={17} weight="fill" />}{running ? "结束并整理" : "用这个技能说一段"}</button><span>本次先在卡片查看，不改变你的绑定。</span></div>
          <details className="skill-binding-options"><summary>常用入口与整理规则{(selected.id === selectedSkillId || selected.id === dailySkillId) && " · 已绑定"}</summary>
          <div className="skill-delivery" role="group" aria-label="技能结果去向"><span>动作快捷键完成后</span><button aria-pressed={settings.skillDelivery !== "card"} onClick={() => onDeliveryChange("paste")} disabled={locked}>输入光标处</button><button aria-pressed={settings.skillDelivery === "card"} onClick={() => onDeliveryChange("card")} disabled={locked}>先在卡片查看</button></div>
          <div className="skill-bindings">
            <button disabled={locked} className={selected.id === selectedSkillId ? "bound" : ""} onClick={() => onSelect(selected.id)}><Keyboard size={18} /><span><strong>{selected.id === selectedSkillId ? "已绑定动作快捷键" : "绑定动作快捷键"}</strong><small>{displayShortcut(settings.actionShortcut)} · 普通口述不受影响</small></span>{selected.id === selectedSkillId ? <Check size={17} /> : <ArrowRight size={17} />}</button>
            <button disabled={locked} className={selected.id === dailySkillId ? "bound" : ""} onClick={() => onSelectDaily(selected.id === dailySkillId ? "" : selected.id)}><Microphone size={18} /><span><strong>{selected.id === dailySkillId ? "日常口述正在使用 · 点击恢复智能整理" : "设为日常口述写法"}</strong><small>{displayShortcut(settings.shortcut)} · 持续生效，直到切换模式</small></span>{selected.id === dailySkillId ? <Check size={17} /> : <ArrowRight size={17} />}</button>
          </div>
          <details className="skill-rules"><summary>查看整理规则</summary><pre className="skill-instruction">{selected.instruction}</pre></details>
          <div className="form-actions">{selected.source === "builtin" ? <button className="button secondary" disabled={locked} onClick={() => edit(copyBuiltinAsCustom(selected, createSkillId()))}><Copy size={17} />复制并调整</button> : <><button className="button secondary" disabled={locked} onClick={() => edit({ ...selected })}>编辑写法</button><button className="button quiet" disabled={locked} onClick={remove}><Trash size={16} />删除</button></>}</div>
          </details>
        </section>}
        {errors.length > 0 && <ul className="error-list" role="alert">{errors.map((message) => <li key={message}><WarningCircle size={15} />{message}</li>)}</ul>}
        <section className="panel form-panel skill-tryout">
          <div className="panel-title"><div><h2>先试一段文字</h2><p>静态示例帮助理解写法；试用会调用你配置的文字模型。</p></div><span className="skill-category">{(draft?.outputFormat || selected.outputFormat) === "markdown" ? "Markdown" : "纯文本"}</span></div>
          <label className="field"><span>你说的内容</span><textarea rows={4} value={sampleText} onChange={(e) => setSampleText(e.target.value)} aria-label="技能试用文字" /></label>
          <div className={`preview-box ${preview && !preview.ok ? "error" : ""}`} aria-live="polite"><span className="preview-label">{previewing ? "正在整理…" : preview ? preview.ok ? "本次试用结果 · 未输入任何窗口" : "试用没有完成" : "输出示例 · 静态参考"}</span><p>{preview ? preview.ok ? preview.text : preview.error : !draft && scenario.output ? scenario.output : "点击试用，看看这段内容会如何整理。"}</p></div>
          <div className="skill-preview-actions"><span>{modelReady ? "使用当前文字模型；不会保存历史或自动输入。" : "先在“文字模型”填写服务地址和模型名称。"}</span><button className="button secondary" onClick={runPreview} disabled={!modelReady || previewing || locked || !sampleText.trim()}>{previewing ? <ArrowClockwise className="spin" size={17} /> : <Sparkle size={17} />}{previewing ? "正在试用" : "试用这段文字"}</button></div>
        </section>
      </div>
    </div>
  </section>;
}
