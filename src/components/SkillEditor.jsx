// 自定义 Skill 编辑器。
//
// 这里只改「输出文本怎么组织」：名称、说明、整理要求、输出格式。
// Skill 拿不到密钥、拿不到活动窗口，也不能触发任何本地动作——它们只是会被拼进
// system 消息的一段文字，且拼装时上层固定约束永远排在它前面（见 text/builtinSkills.js）。
//
// 预览按钮走 pipeline.preview：它不发历史、不自动粘贴，只把结果还给界面。
// 保存前的校验失败时保留草稿，不清空用户刚写的内容。

import { useMemo, useState } from "react";
import {
  ArrowClockwise,
  BookOpenText,
  Check,
  Copy,
  FloppyDisk,
  Plus,
  Sparkle,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { BUILTIN_SKILLS, SKILL_LIMITS, copyBuiltinAsCustom } from "../text/builtinSkills.js";
import { createSkillId, validateCustomSkill } from "../text/skillValidation.js";

const SAMPLE_TEXT =
  "嗯，那个，昨天跟客户对了一下，他们希望在月底之前拿到一个能用的版本，就是说先跑通登录和导出这两块，然后呢，性能那块还没定，说是要再确认一下并发量到底是多少。";

const EMPTY_DRAFT = {
  id: "",
  name: "",
  description: "",
  instruction: "",
  outputFormat: "plain",
};

function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function SkillEditor({ customSkills, selectedSkillId, onSelect, onSaveCustomSkills, pipeline, settings, onNotice, busy = false }) {
  const [viewedSkillId, setViewedSkillId] = useState(selectedSkillId || BUILTIN_SKILLS[0].id);
  const [draft, setDraft] = useState(null);
  const [errors, setErrors] = useState([]);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [sampleText, setSampleText] = useState(SAMPLE_TEXT);

  const allSkills = useMemo(() => [...BUILTIN_SKILLS, ...customSkills], [customSkills]);
  const selected = allSkills.find((skill) => skill.id === viewedSkillId) || null;

  const beginNew = () => {
    setDraft({ ...EMPTY_DRAFT, id: createSkillId() });
    setErrors([]);
    setPreview(null);
  };

  const beginEdit = (skill) => {
    setDraft({ ...skill });
    setErrors([]);
    setPreview(null);
  };

  const beginCopyFromBuiltin = (skill) => {
    // 内置 Skill 不可直接修改，只能复制一份再改；这样升级应用时内置内容仍能整体更新。
    setDraft(copyBuiltinAsCustom(skill, createSkillId()));
    setErrors([]);
    setPreview(null);
  };

  const save = async () => {
    if (!draft) return;
    const { skill, errors: found } = validateCustomSkill(draft, { existing: customSkills });
    setErrors(found);
    if (found.length) {
      // 校验失败保留草稿，不清空输入。
      return;
    }
    const next = customSkills.some((item) => item.id === skill.id)
      ? customSkills.map((item) => (item.id === skill.id ? skill : item))
      : [...customSkills, skill];
    try {
      const saved = await onSaveCustomSkills(next);
      setDraft(null);
      setViewedSkillId(skill.id);
      setErrors([]);
      setPreview(null);
      onNotice({ text: `技能「${skill.name}」已保存`, ok: true });
      return saved;
    } catch (error) {
      setErrors([String(error && error.message ? error.message : error)]);
    }
  };

  const remove = async (skill) => {
    const next = customSkills.filter((item) => item.id !== skill.id);
    try {
      await onSaveCustomSkills(next);
    } catch (error) {
      // 磁盘保存失败时保留条目，让用户能重试而不是以为已删掉。
      setErrors([String(error && error.message ? error.message : error)]);
      return;
    }
    if (draft && draft.id === skill.id) setDraft(null);
    setViewedSkillId(BUILTIN_SKILLS[0].id);
    onNotice({ text: `已删除技能「${skill.name}」`, ok: true });
  };

  const runPreview = async () => {
    if (!draft) return;
    const { skill, errors: found } = validateCustomSkill(draft, { existing: customSkills });
    setErrors(found);
    if (found.length) return;
    setPreviewing(true);
    setPreview(null);
    try {
      // pipeline.preview 只返回文本：不写历史、不粘贴、也不占用当前录音任务以外的状态。
      const result = await pipeline.preview({ settings, skill, rawText: sampleText });
      setPreview(result);
    } catch (error) {
      setPreview({ ok: false, error: String(error && error.message ? error.message : error) });
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <section className="page-content">
      <header className="page-heading">
        <div>
          <span className="eyebrow">常用写法</span>
          <h1>把写法留在手边。</h1>
          <p>一个技能，一种固定的整理方式。把常用的那个交给第三个快捷键；普通口述不受影响。</p>
        </div>
        <button className="button secondary" onClick={beginNew} disabled={busy}><Plus size={17} />新建技能</button>
      </header>

      <div className="skill-layout">
        <div className="skill-list panel">
          {allSkills.map((skill) => (
            <button
              key={skill.id}
              className={`skill-item ${viewedSkillId === skill.id ? "selected" : ""}`}
              onClick={() => setViewedSkillId(skill.id)}
            >
              <span className="skill-item-head">
                <strong>{skill.name}</strong>
                <em className={`skill-tag ${skill.source}`}>{skill.source === "builtin" ? "内置" : "自定义"}</em>
              </span>
              <small>{skill.description || "（无说明）"}</small>
            </button>
          ))}
        </div>

        <div className="skill-detail">
          {!selected && <div className="panel form-panel"><p className="empty-text">左侧选择一个技能查看详情。</p></div>}

          {selected && !draft && (
            <div className="panel form-panel">
              <div className="panel-title">
                <div className="icon-tile"><Sparkle size={22} /></div>
                <div>
                  <h2>{selected.name}</h2>
                  <p>{selected.source === "builtin" ? "内置技能，随应用更新" : `自定义 · 更新于 ${selected.updatedAt}`}</p>
                </div>
              </div>
              <pre className="skill-instruction">{selected.instruction}</pre>
              <div className="form-actions">
                <button className="button secondary" onClick={() => onSelect(selected.id)} disabled={busy || selectedSkillId === selected.id}>
                  <Check size={17} />{selectedSkillId === selected.id ? "已设为第三个入口" : "设为第三个入口"}
                </button>
                {selected.source === "builtin" ? (
                  <button className="button secondary" onClick={() => beginCopyFromBuiltin(selected)} disabled={busy}>
                    <Copy size={17} />复制为自定义
                  </button>
                ) : (
                  <>
                    <button className="button secondary" onClick={() => remove(selected)} disabled={busy}><Trash size={17} />删除</button>
                    <button className="button primary" onClick={() => beginEdit(selected)} disabled={busy}>编辑</button>
                  </>
                )}
              </div>
            </div>
          )}

          {draft && (
            <div className="panel form-panel">
              <div className="panel-title">
                <div className="icon-tile"><BookOpenText size={22} /></div>
                <div>
                  <h2>{customSkills.some((item) => item.id === draft.id) ? "编辑技能" : "新建技能"}</h2>
                  <p>整理要求只影响输出文本的组织方式，无法访问密钥或执行任何操作。</p>
                </div>
              </div>
              <div className="form-grid">
                <Field label="名称" hint={`最多 ${SKILL_LIMITS.name} 个字符`}>
                  <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
                </Field>
                <Field label="说明" hint={`最多 ${SKILL_LIMITS.description} 个字符`}>
                  <input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
                </Field>
                <Field label="输出格式">
                  <select value={draft.outputFormat} onChange={(event) => setDraft({ ...draft, outputFormat: event.target.value })}>
                    <option value="plain">纯文本</option>
                    <option value="markdown">Markdown</option>
                  </select>
                </Field>
                <Field label="整理要求" hint={`最多 ${SKILL_LIMITS.instruction} 个字符，用自然语言描述要输出哪几部分`}>
                  <textarea rows={10} value={draft.instruction} onChange={(event) => setDraft({ ...draft, instruction: event.target.value })} />
                </Field>
                <Field label="预览用样例文字" hint="仅用于本次预览，不会写进历史，也不会粘贴到任何窗口">
                  <textarea rows={4} value={sampleText} onChange={(event) => setSampleText(event.target.value)} />
                </Field>
              </div>

              {errors.length > 0 && (
                <ul className="error-list">
                  {errors.map((message) => <li key={message}><WarningCircle size={14} weight="fill" />{message}</li>)}
                </ul>
              )}

              {preview && (
                <div className={`preview-box ${preview.ok ? "" : "error"}`}>
                  <span className="preview-label">
                    {preview.ok ? (preview.stale ? "预览已过期，请重新生成" : "预览结果（未上屏）") : "预览失败"}
                  </span>
                  <p>{preview.ok ? preview.text : preview.error}</p>
                </div>
              )}

              <div className="form-actions">
                <button className="button secondary" onClick={() => { setDraft(null); setErrors([]); setPreview(null); }} disabled={busy}>
                  <X size={17} />取消
                </button>
                <button className="button secondary" onClick={runPreview} disabled={previewing || busy}>
                  {previewing ? <ArrowClockwise className="spin" size={17} /> : <Sparkle size={17} />}
                  {previewing ? "正在预览" : "预览"}
                </button>
                <button className="button primary" onClick={save} disabled={busy}><FloppyDisk size={17} />保存</button>
              </div>
            </div>
          )}

          {selected && selected.source === "builtin" && !draft && (
            <div className="note-card">
              <Check size={22} weight="bold" />
              <div>
                <strong>内置技能不可直接编辑</strong>
                <p>升级应用时它们会被整体更新。需要调整就「复制为自定义」，改动只影响你的副本。</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
