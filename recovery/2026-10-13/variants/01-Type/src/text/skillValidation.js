// 自定义写法的校验与归一化。
// Rust 侧 skills.rs 有一份等价实现（保存前必须再校验一次）；
// 这里的一份用于界面即时反馈和浏览器预览。

import { OUTPUT_FORMATS, SKILL_LIMITS, SKILL_SCHEMA_VERSION } from "./builtinSkills.js";

/** 生成自定义写法的 id。非安全上下文（无 crypto.randomUUID）时退回时间戳+随机串。 */
export function createSkillId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `custom.${crypto.randomUUID()}`;
  }
  return `custom.${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 校验并归一化一个自定义写法。
 * 返回 { skill, errors }：errors 非空时 skill 不应被保存。
 */
export function validateCustomSkill(input, { existing = [], now = new Date().toISOString() } = {}) {
  const source = input && typeof input === "object" ? input : {};
  const errors = [];
  const name = typeof source.name === "string" ? source.name.trim() : "";
  const description = typeof source.description === "string" ? source.description.trim() : "";
  const instruction = typeof source.instruction === "string" ? source.instruction.trim() : "";
  const outputFormat = OUTPUT_FORMATS.includes(source.outputFormat) ? source.outputFormat : "plain";
  const id = typeof source.id === "string" && source.id.trim() ? source.id.trim() : createSkillId();

  if (!name) errors.push("请填写写法名称");
  else if (name.length > SKILL_LIMITS.name) errors.push(`名称不能超过 ${SKILL_LIMITS.name} 个字符`);

  if (description.length > SKILL_LIMITS.description) {
    errors.push(`说明不能超过 ${SKILL_LIMITS.description} 个字符`);
  }
  if (!instruction) errors.push("请填写整理要求");
  else if (instruction.length > SKILL_LIMITS.instruction) {
    errors.push(`整理要求不能超过 ${SKILL_LIMITS.instruction} 个字符`);
  }

  const duplicated = existing.some((item) => item.id !== id && item.name.trim() === name);
  if (name && duplicated) errors.push("已有同名写法，请换一个名称");

  if (!existing.some((item) => item.id === id) && existing.length >= SKILL_LIMITS.customCount) {
    errors.push(`自定义写法最多 ${SKILL_LIMITS.customCount} 个`);
  }

  if (!id.startsWith("custom.")) errors.push("写法标识无效，请重新创建");

  return {
    skill: {
      id,
      source: "custom",
      schemaVersion: SKILL_SCHEMA_VERSION,
      name,
      description,
      instruction,
      outputFormat,
      enabled: source.enabled !== false,
      updatedAt: now,
    },
    errors,
  };
}

/**
 * 校验并归一化从 skills.json 读到的整个列表。
 * 单条不合格就丢弃那一条，不影响其余可用 Skill。
 * 返回 { skills, rejected }，rejected 为被丢弃的条数，便于提示用户。
 *
 * 保留原文件里的 updatedAt：界面上的「更新于」要显示这条 Skill 真正被改过的时间，
 * 若在这里统一改写成「本次加载时刻」，每次重启都会看起来刚刚被编辑过。
 */
export function validateStoredSkills(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const skills = [];
  let rejected = 0;
  for (const item of list) {
    const stored = item && typeof item === "object" ? item.updatedAt : null;
    const parsed = typeof stored === "string" ? Date.parse(stored) : Number.NaN;
    const now = Number.isFinite(parsed) ? stored : new Date().toISOString();
    const { skill, errors } = validateCustomSkill(item, { existing: skills, now });
    if (errors.length) {
      rejected += 1;
      continue;
    }
    skills.push(skill);
  }
  return { skills, rejected };
}