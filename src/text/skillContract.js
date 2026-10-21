// Shared template contract; schema migration never rewrites user instructions.
export const SKILL_SCHEMA_VERSION = 2;
export const SKILL_LIMITS = Object.freeze({ name: 60, description: 200, instruction: 4000, customCount: 30, examples: 3, exampleText: 2000, examplesTotal: 8000 });
export const OUTPUT_FORMATS = ["plain", "markdown"];
export const MISSING_INFO_POLICIES = ["omit", "mark"];
export const characterCount = (text) => Array.from(text).length;

export function missingInfoPolicyFor(source = {}) {
  if (MISSING_INFO_POLICIES.includes(source.missingInfoPolicy)) return source.missingInfoPolicy;
  return Number(source.schemaVersion ?? SKILL_SCHEMA_VERSION) < 2 ? "mark" : "omit";
}

export function normalizeExamples(value = []) {
  const errors = [];
  const examples = [];
  if (!Array.isArray(value)) return { examples, errors: ["参考样例必须是输入与期望结果的列表"] };
  if (value.length > SKILL_LIMITS.examples) errors.push(`参考样例最多 ${SKILL_LIMITS.examples} 组`);
  for (const [index, item] of value.entries()) {
    if (!item || typeof item.input !== "string" || typeof item.output !== "string") {
      errors.push(`样例 ${index + 1} 请填写原始口述和期望结果`); continue;
    }
    const input = item.input.trim(), output = item.output.trim();
    if (!input && !output) continue;
    if (!input || !output) errors.push(`样例 ${index + 1} 请同时填写原始口述和期望结果`);
    if (characterCount(input) > SKILL_LIMITS.exampleText || characterCount(output) > SKILL_LIMITS.exampleText) errors.push(`样例 ${index + 1} 每项不能超过 ${SKILL_LIMITS.exampleText} 个字符`);
    examples.push({ input, output });
  }
  if (examples.reduce((sum, e) => sum + characterCount(e.input) + characterCount(e.output), 0) > SKILL_LIMITS.examplesTotal) errors.push(`参考样例合计不能超过 ${SKILL_LIMITS.examplesTotal} 个字符`);
  return { examples, errors };
}

export function cloneSkill(skill) {
  return skill ? { ...skill, ...(Array.isArray(skill.examples) ? { examples: skill.examples.map((e) => ({ ...e })) } : {}) } : null;
}

// Compare the same normalized content that validation sends to the compiler.
export function skillPreviewKey(skill, input) {
  return JSON.stringify([skill.id, String(skill.instruction || "").trim(), skill.outputFormat || "plain", missingInfoPolicyFor(skill), normalizeExamples(skill.examples).examples, String(input).trim()]);
}

export function sameSkillContent(a, b) {
  return ["name", "description", "instruction", "outputFormat", "enabled"].every((key) => a[key] === b[key])
    && missingInfoPolicyFor(a) === missingInfoPolicyFor(b)
    && JSON.stringify(a.examples || []) === JSON.stringify(b.examples || []);
}
