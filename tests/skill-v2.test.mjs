import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMessages, copyBuiltinAsCustom, BUILTIN_SKILLS } from "../src/text/builtinSkills.js";
import { validateCustomSkill, validateStoredSkills } from "../src/text/skillValidation.js";
import { cloneSkill, skillPreviewKey } from "../src/text/skillContract.js";
import { createPipeline } from "../src/dictation/pipeline.js";
import { DEFAULT_SETTINGS } from "../src/text/settingsMigration.js";

const template = (extra = {}) => ({ id: "custom.v2", schemaVersion: 2, name: "客户记录", instruction: "按需求和下一步整理", outputFormat: "plain", missingInfoPolicy: "omit", examples: [{ input: "蓝山周五确认", output: "下一步：蓝山周五确认。" }], ...extra });
const settings = { ...DEFAULT_SETTINGS, textEndpoint: "https://example.invalid/v1", textModel: "test-model", textFastModel: "test-model", textStreaming: false, actionSkillId: "custom.v2", vocabulary: "" };

test("trial freshness compares normalized drafts and invalidates real instruction changes", () => {
  const draft = template({ instruction: " 按需求和下一步整理\n", examples: [{ input: " 蓝山周五确认\n", output: " 下一步：蓝山周五确认。 " }] });
  const saved = validateCustomSkill(draft).skill;
  assert.equal(skillPreviewKey(draft, " 素材 "), skillPreviewKey(saved, "素材"));
  assert.notEqual(skillPreviewKey({ ...draft, instruction: "改为邮件" }, "素材"), skillPreviewKey(saved, "素材"));
});

test("v1 migration preserves facts, instructions, timestamps and mark policy; new templates omit", () => {
  const old = template({ schemaVersion: 1, examples: undefined, missingInfoPolicy: undefined, updatedAt: "2026-01-01T00:00:00Z" });
  const { skills, rejected } = validateStoredSkills([old]);
  assert.equal(rejected, 0); assert.equal(skills[0].missingInfoPolicy, "mark");
  assert.equal(skills[0].instruction, old.instruction); assert.equal(skills[0].updatedAt, old.updatedAt);
  assert.equal(skills[0].schemaVersion, 2); assert.equal(skills[0].revision, 1);
  assert.equal(validateCustomSkill({ name: "新模板", instruction: "简洁整理" }).skill.missingInfoPolicy, "omit");
  assert.equal(validateStoredSkills([{ ...old, schemaVersion: 99 }]).rejected, 1);
});

test("examples and policy survive JSON save/load; schema copying does not alias examples", () => {
  const saved = validateCustomSkill(template()).skill;
  assert.deepEqual(validateStoredSkills(JSON.parse(JSON.stringify([saved]))).skills[0], saved);
  const copy = copyBuiltinAsCustom(BUILTIN_SKILLS[0], "custom.copy");
  copy.examples[0].output = "修改副本";
  assert.notEqual(copy.examples[0].output, BUILTIN_SKILLS[0].examples[0].output);
  const clone = cloneSkill(saved); clone.examples[0].input = "后来编辑";
  assert.notEqual(saved.examples[0].input, clone.examples[0].input);
});

test("incomplete, excessive and oversized examples are refused; Unicode boundary agrees with Rust", () => {
  assert.ok(validateCustomSkill(template({ examples: [{ input: "输入", output: "" }] })).errors.length);
  assert.ok(validateCustomSkill(template({ examples: Array(4).fill({ input: "一", output: "二" }) })).errors.length);
  assert.ok(validateCustomSkill(template({ examples: [{ input: "字".repeat(2001), output: "二" }] })).errors.length);
  assert.ok(validateCustomSkill(template({ examples: Array(3).fill({ input: "字".repeat(2000), output: "字".repeat(2000) }) })).errors.length);
  assert.deepEqual(validateCustomSkill(template({ name: "😀".repeat(60) })).errors, []);
  assert.deepEqual(validateCustomSkill(template({ examples: [{ input: "", output: "" }] })).skill.examples, []);
  assert.ok(validateCustomSkill(template({ missingInfoPolicy: "guess" })).errors.length);
});

test("revision increments only when persisted template content changes", () => {
  const first = validateCustomSkill(template()).skill;
  assert.equal(validateCustomSkill(first, { existing: [first] }).skill.revision, 1);
  const second = validateCustomSkill({ ...first, missingInfoPolicy: "mark" }, { existing: [first] }).skill;
  assert.equal(second.revision, 2);
  assert.equal(validateStoredSkills([second]).skills[0].revision, 2);
});

test("runtime examples are role pairs; current material remains last and missing policy is independent", () => {
  const messages = buildMessages({ ...template(), rawText: "绿川项目尚未定日期" });
  assert.deepEqual(messages.map((m) => m.role), ["system", "user", "assistant", "user"]);
  assert.ok(messages[1].content.includes("蓝山周五确认"));
  assert.equal(messages[2].content, template().examples[0].output);
  assert.ok(messages.at(-1).content.includes("绿川项目尚未定日期"));
  assert.ok(!messages[0].content.includes("绿川项目尚未定日期"));
  assert.ok(messages[0].content.includes("没有内容的栏目省略"));
  assert.ok(buildMessages({ ...template({ missingInfoPolicy: "mark" }), rawText: "素材" })[0].content.includes("栏目缺少内容时写「待确认」"));
  for (const task of ["smart", "ask", "translate"]) assert.equal(buildMessages({ ...template(), task, rawText: "素材" }).length, 2);
  assert.throws(() => buildMessages({ ...template({ examples: [{ input: "只有输入", output: "" }] }), rawText: "素材" }));
});

test("trial and actual task send identical template messages; trial has no delivery side effects", async () => {
  const requests = [], effects = [];
  const pipeline = createPipeline({ invoke: async (command, payload) => {
    if (command === "process_text") { requests.push(payload.request); return { text: "成稿" }; }
    if (["copy_text", "save_history", "paste_text"].includes(command)) { effects.push(command); return { status: "copied", copied: true }; }
    return undefined;
  } });
  const skill = validateCustomSkill(template()).skill;
  assert.equal((await pipeline.preview({ settings, skill, rawText: "绿川项目尚未定日期" })).ok, true);
  assert.deepEqual(effects, []);
  assert.equal((await pipeline.retry({ intent: "skill", settings, customSkills: [skill], skillId: skill.id, rawText: "绿川项目尚未定日期" })).ok, true);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].messages, requests[1].messages);
});

test("recording freezes nested examples and instructions before later edits", async () => {
  const skill = validateCustomSkill(template()).skill; let sent;
  const pipeline = createPipeline({ invoke: async (command, payload) => {
    if (command === "process_text") { sent = payload.request; return { text: "成稿" }; }
    if (command === "copy_text") return { copied: true };
    return undefined;
  } });
  const snapshot = pipeline.begin({ intent: "skill", settings, customSkills: [skill] });
  skill.instruction = "后来改成邮件"; skill.examples[0].output = "后来篡改的示例";
  await pipeline.complete({ snapshot, audio: { nativeSessionId: "test-recording", transcript: "本次素材", durationMs: 1000, encodeMs: 0 } });
  assert.ok(sent.messages[0].content.includes("按需求和下一步整理"));
  assert.equal(sent.messages[2].content, "下一步：蓝山周五确认。");
});
