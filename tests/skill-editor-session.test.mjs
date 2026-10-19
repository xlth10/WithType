import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILTIN_SKILLS } from "../src/text/builtinSkills.js";
import { createSkillEditorSession, skillEditorSessionReducer as reduce } from "../src/text/skillEditorSession.js";
import { scenarioFor } from "../src/text/skillScenarios.js";

const polish = BUILTIN_SKILLS.find((skill) => skill.id === "builtin.polish");

test("编辑会话从已选模板初始化，自定义模板标识也不会被首个内置模板覆盖", () => {
  assert.deepEqual(createSkillEditorSession(polish.id), {
    viewedId: polish.id, draft: null, sampleText: scenarioFor(polish).input,
    revision: 0, pendingOperation: null,
  });
  assert.equal(createSkillEditorSession("custom.saved").viewedId, "custom.saved");
  assert.equal(createSkillEditorSession().viewedId, BUILTIN_SKILLS[0].id);
});

test("同一会话中的草稿与试用文字相互独立，后续输入保留离开页面前已编辑的信息", () => {
  const original = createSkillEditorSession(polish.id);
  const draft = { id: "custom.draft", name: "", description: "", instruction: "", outputFormat: "plain" };
  let session = reduce(original, { type: "sample", value: "自己的未保存试用内容 42。" });
  session = reduce(session, { type: "edit", draft });
  session = reduce(session, { type: "draft-field", field: "name", value: "客户沟通记录" });
  session = reduce(session, { type: "draft-field", field: "instruction", value: "保留原意。" });

  // The parent window retains this session while the editor is unmounted.
  const resumed = reduce(session, { type: "draft-field", field: "description", value: "拜访后整理" });
  assert.equal(resumed.viewedId, polish.id);
  assert.equal(resumed.sampleText, "自己的未保存试用内容 42。");
  assert.deepEqual(resumed.draft, { ...draft, name: "客户沟通记录", instruction: "保留原意。", description: "拜访后整理" });
  assert.equal(draft.name, "");
  assert.equal(original.draft, null);
});

test("保存草稿后选中已保存模板并保留试用文字；显式换模板才换参考输入", () => {
  let session = createSkillEditorSession(polish.id);
  const custom = { id: "custom.saved", name: "自定义润色", instruction: "保留原意。", outputFormat: "plain" };
  session = reduce(session, { type: "edit", draft: custom });
  session = reduce(session, { type: "sample", value: "保留我正在试用的文字" });
  const operation = { kind: "save", revision: session.revision };
  session = reduce(session, { type: "operation-started", operation });
  session = reduce(session, { type: "operation-succeeded", operation, skill: custom });
  assert.equal(session.viewedId, custom.id);
  assert.equal(session.draft, null);
  assert.equal(session.sampleText, "保留我正在试用的文字");
  assert.equal(session.pendingOperation, null);

  const selected = reduce(session, { type: "select", skill: BUILTIN_SKILLS[0] });
  assert.equal(selected.viewedId, BUILTIN_SKILLS[0].id);
  assert.equal(selected.sampleText, scenarioFor(BUILTIN_SKILLS[0]).input);
});

test("明确取消编辑只清除草稿，保留当前查看的模板与试用文字", () => {
  let session = createSkillEditorSession(polish.id);
  session = reduce(session, { type: "edit", draft: { id: "custom.cancel", name: "待取消" } });
  session = reduce(session, { type: "sample", value: "继续试用这段话" });
  const canceled = reduce(session, { type: "edit", draft: null });
  assert.equal(canceled.draft, null);
  assert.equal(canceled.viewedId, polish.id);
  assert.equal(canceled.sampleText, "继续试用这段话");
  assert.equal(reduce(canceled, { type: "draft-field", field: "name", value: "延迟输入" }), canceled);
});

test("旧草稿 A 保存返回时不能清除用户后来新建的草稿 B", () => {
  const draftA = { id: "custom.a", name: "草稿 A", instruction: "原要求" };
  const draftB = { id: "custom.b", name: "草稿 B", instruction: "新的要求" };
  let session = reduce(createSkillEditorSession(polish.id), { type: "edit", draft: draftA });
  const operation = { kind: "save", revision: session.revision };
  session = reduce(session, { type: "operation-started", operation });
  session = reduce(session, { type: "edit", draft: null });
  session = reduce(session, { type: "edit", draft: draftB });

  const completed = reduce(session, { type: "operation-succeeded", operation, skill: draftA });
  assert.deepEqual(completed.draft, draftB);
  assert.equal(completed.viewedId, polish.id);
  assert.equal(completed.pendingOperation, null);
});

test("保存中继续修改同一草稿，旧响应只结束保存锁而不丢弃新版输入", () => {
  const submitted = { id: "custom.editing", name: "提交时名称", instruction: "提交时要求" };
  let session = reduce(createSkillEditorSession(polish.id), { type: "edit", draft: submitted });
  const operation = { kind: "save", revision: session.revision };
  session = reduce(session, { type: "operation-started", operation });
  session = reduce(session, { type: "draft-field", field: "instruction", value: "请求中补充的新要求" });
  session = reduce(session, { type: "sample", value: "继续编辑的试用内容" });

  const completed = reduce(session, { type: "operation-succeeded", operation, skill: submitted });
  assert.equal(completed.draft.id, submitted.id);
  assert.equal(completed.draft.instruction, "请求中补充的新要求");
  assert.equal(completed.sampleText, "继续编辑的试用内容");
  assert.equal(completed.pendingOperation, null);
});

test("旧删除请求完成不能覆盖请求中修改的试用文字或切换后的模板", () => {
  const viewedId = "custom.removing";
  const initial = createSkillEditorSession(viewedId);
  const operation = { kind: "remove", revision: initial.revision };
  const pending = reduce(initial, { type: "operation-started", operation });
  const editing = reduce(pending, { type: "sample", value: "删除过程中输入的重要文字" });
  const completed = reduce(editing, { type: "operation-succeeded", operation });
  assert.equal(completed.viewedId, viewedId);
  assert.equal(completed.sampleText, "删除过程中输入的重要文字");
  assert.equal(completed.pendingOperation, null);

  const switched = reduce(pending, { type: "select", skill: polish });
  const finishedElsewhere = reduce(switched, { type: "operation-succeeded", operation });
  assert.equal(finishedElsewhere.viewedId, polish.id);
  assert.equal(finishedElsewhere.sampleText, scenarioFor(polish).input);
});

test("没有后续编辑的删除完成后仍回到首个内置模板", () => {
  let session = createSkillEditorSession("custom.removing");
  const operation = { kind: "remove", revision: session.revision };
  session = reduce(session, { type: "operation-started", operation });
  session = reduce(session, { type: "operation-succeeded", operation });
  assert.equal(session.viewedId, BUILTIN_SKILLS[0].id);
  assert.equal(session.sampleText, scenarioFor(BUILTIN_SKILLS[0]).input);
  assert.equal(session.pendingOperation, null);
});

test("提交锁属于窗口会话，拒绝重叠操作且旧清理不能释放后一个操作的锁", () => {
  const initial = createSkillEditorSession(polish.id);
  const first = { kind: "save", revision: initial.revision };
  const second = { kind: "remove", revision: initial.revision };
  const pending = reduce(initial, { type: "operation-started", operation: first });
  assert.equal(pending.pendingOperation, first);
  assert.equal(reduce(pending, { type: "operation-started", operation: second }), pending);

  const failed = reduce(pending, { type: "operation-finished", operation: first });
  assert.equal(failed.pendingOperation, null);
  const next = reduce(failed, { type: "operation-started", operation: second });
  assert.equal(reduce(next, { type: "operation-finished", operation: first }), next);
  assert.equal(reduce(next, { type: "operation-succeeded", operation: first, skill: polish }), next);
});
