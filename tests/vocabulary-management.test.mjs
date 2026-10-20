import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyVocabulary, normalizeVocabulary, learnCorrections, dismissCorrection, undoAutoLearned, applyLearnedVocabulary } from "../src/vocabulary/learning.js";
import { MAX_RULES, MAX_AUTO_HOTWORDS, collectAsrHotWords, getAsrVocabularySummary } from "../src/vocabulary/rules.js";
import { upsertVocabularyWord, validateVocabularyWord, previewVocabularyCsv, importVocabularyEntries, exportVocabularyCsv, MAX_CSV_BYTES, MAX_CSV_ROWS } from "../src/vocabulary/management.js";

const NOW = Date.UTC(2026, 9, 20);
const learn = (state = emptyVocabulary(), more = {}) => learnCorrections(state, { original: "联系徐向", edited: "联系徐翔", now: NOW, ...more });
const word = (target, source = "manual") => ({ target, kind: "hotword", source });

test("直接添加正确词不建立替换，手动和导入来源重启保留", () => {
  let state = upsertVocabularyWord(emptyVocabulary(), "  WithType  ", { now: NOW });
  state = upsertVocabularyWord(state, "Acme, Inc.", { source: "import", now: NOW });
  const loaded = normalizeVocabulary(JSON.parse(JSON.stringify(state)), NOW);
  assert.deepEqual(loaded, state);
  assert.deepEqual(collectAsrHotWords("", loaded.entries), ["WithType", "Acme, Inc."]);
  assert.equal(applyLearnedVocabulary("with type", loaded.entries), "with type");
  assert.ok(loaded.entries.every((entry) => !entry.variant));
  assert.deepEqual(loaded.entries.map((entry) => entry.source), ["manual", "import"]);
});

test("正确词校验允许技术专名和短语，拒绝纯数字、公式、地址和控制符", () => {
  for (const target of ["C++", ".NET", "GPT-4", "张小明", "Acme, Inc.", 'Acme "Labs"']) assert.equal(validateVocabularyWord(target).valid, true, target);
  for (const target of ["", "12345", "=SUM(A1)", "+Acme", "@Acme", "https://example.com", "alice@acme.com", "/Users/name", "Bad\nWord", "\tAcme", "Bad\u200bWord", "词".repeat(41)]) assert.equal(validateVocabularyWord(target).valid, false, target);
  assert.throws(() => upsertVocabularyWord(emptyVocabulary(), "123"), /数字/);
});

test("编辑保留原来源追溯、升级为手动，过期编辑不会覆盖新内容", () => {
  const auto = learn().state;
  const original = structuredClone(auto.entries[0]);
  const edited = upsertVocabularyWord(auto, "徐翔明", { entry: original, now: NOW + 1 });
  assert.equal(edited.entries[0].source, "manual");
  assert.equal(edited.entries[0].originSource, "auto");
  assert.equal(edited.entries[0].id, original.id);
  assert.throws(() => upsertVocabularyWord(edited, "另一个词", { entry: original }), /发生变化/);
  assert.throws(() => upsertVocabularyWord(edited, "徐翔明"), /已在词库/);
});

test("自动学习30条配额不占用手动词容量，人工词与旧替换不会被自动词驱逐", () => {
  const manual = Array.from({ length: 300 }, (_, i) => word(`Project${i}`));
  const autos = Array.from({ length: MAX_AUTO_HOTWORDS + 1 }, (_, i) => ({ ...word(`term${i}`, "auto"), variant: `term${i}x` }));
  const state = normalizeVocabulary({ ...emptyVocabulary(), entries: [...autos, ...manual] }, NOW);
  assert.equal(state.entries.length, 330);
  assert.equal(state.entries.filter((entry) => entry.source === "auto").length, MAX_AUTO_HOTWORDS);
  const duplicate = normalizeVocabulary({ ...emptyVocabulary(), entries: [word("徐翔", "manual"), { ...word("徐翔", "auto"), variant: "徐向" }] }, NOW);
  assert.equal(duplicate.entries[0].source, "manual");
  const full = { ...emptyVocabulary(), entries: Array.from({ length: MAX_RULES }, (_, i) => word(`Word${i}`)) };
  assert.throws(() => upsertVocabularyWord(full, "NewWord"), /已达 500/);
});

test("撤销学习不记录忽略且允许以后再次学习，永久删除则阻止重新学习", () => {
  const first = learn();
  const undone = undoAutoLearned(first.state, first.undoToken);
  assert.deepEqual(undone.entries, []);
  assert.deepEqual(undone.dismissed, []);
  assert.equal(learn(undone).learned.length, 1);
  const deleted = dismissCorrection(first.state, first.state.entries[0]);
  assert.equal(learn(deleted).learned.length, 0);
  const restored = upsertVocabularyWord(deleted, "徐翔");
  assert.deepEqual(restored.dismissed, []);
});

test("旧撤销通知不会删除之后编辑或重新学习的词条", () => {
  const first = learn();
  const edited = upsertVocabularyWord(first.state, "徐翔明", { entry: first.state.entries[0], now: NOW + 1 });
  assert.deepEqual(undoAutoLearned(edited, first.undoToken), edited);
  const second = learn(undoAutoLearned(first.state, first.undoToken));
  assert.notEqual(second.state.entries[0].id, first.state.entries[0].id);
  assert.deepEqual(undoAutoLearned(second.state, first.undoToken), second.state);
  assert.deepEqual(undoAutoLearned(first.state, { entries: [{ ...first.state.entries[0], target: "别的词" }] }), first.state);
});

test("历史明确教学可记非近音正确词但不生成替换，也不学习数字日期或语法改动", () => {
  const taught = learnCorrections(emptyVocabulary(), { original: "Typeless", edited: "WithType", manual: true, asHotword: true, now: NOW });
  assert.equal(taught.state.entries[0].kind, "hotword");
  assert.equal(taught.state.entries[0].source, "manual");
  assert.equal(applyLearnedVocabulary("Typeless", taught.state.entries), "Typeless");
  for (const [original, edited] of [["共5次", "共4次"], ["周四", "周三"], ["三月", "四月"], ["他的", "她的"]]) assert.deepEqual(learnCorrections(emptyVocabulary(), { original, edited, manual: true, asHotword: true, now: NOW }).learned, []);
});

test("ASR请求预算与保存容量分开，手动规则、手动导入、自动按稳定顺序选词", () => {
  const entries = [{ ...word("AutoName", "auto"), variant: "AutoNane" }, ...Array.from({ length: 105 }, (_, i) => word(`Manual${i}`, i % 2 ? "import" : "manual"))];
  const result = getAsrVocabularySummary("Priority=误写\nmanual0", entries);
  assert.equal(result.limit, 100);
  assert.equal(result.words.length, 100);
  assert.equal(result.eligibleCount, 107);
  assert.equal(result.omittedCount, 7);
  assert.deepEqual(result.words.slice(0, 3), ["Priority", "manual0", "Manual1"]);
  assert.ok(!result.words.includes("AutoName"));
  assert.deepEqual(collectAsrHotWords("Priority=误写\nmanual0", entries), result.words);
});

test("CSV解析支持BOM、CRLF、逗号和转义引号，换行词条作为一行错误报告", () => {
  const preview = previewVocabularyCsv('\uFEFFtarget\r\n"Acme, Inc."\r\n"Acme ""Labs"""\r\n"Bad\nWord"\r\nWithType', emptyVocabulary());
  assert.equal(preview.validCount, 3);
  assert.equal(preview.invalidCount, 1);
  assert.equal(preview.rows.length, 4);
  assert.deepEqual(preview.entriesToAdd.map((entry) => entry.target), ["Acme, Inc.", 'Acme "Labs"', "WithType"]);
  assert.equal(preview.rows[2].line, 4);
  assert.equal(preview.rows[3].line, 6);
});

test("CSV预览对已有正确词和文件内词大小写去重，替换同目标保留独立提示", () => {
  const state = { ...emptyVocabulary(), entries: [word("WithType")] };
  const snapshot = structuredClone(state);
  const preview = previewVocabularyCsv("withtype\nNewWord\nnewword\nDeepSeek", state, "DEEPSEEK=误写");
  assert.equal(preview.validCount, 2);
  assert.equal(preview.duplicateCount, 2);
  assert.deepEqual(preview.entriesToAdd.map((entry) => entry.target), ["NewWord", "DeepSeek"]);
  assert.deepEqual(state, snapshot);
});

test("CSV两列错误与正确写法保持替换语义，冲突规则明确报错", () => {
  const preview = previewVocabularyCsv("misspelling,correction\nOpenWrt,OpenWiki\nOpenWrt,OpenWork", emptyVocabulary());
  assert.equal(preview.validCount, 1);
  assert.equal(preview.invalidCount, 1);
  const imported = importVocabularyEntries(emptyVocabulary(), preview.entriesToAdd, { now: NOW });
  assert.equal(applyLearnedVocabulary("OpenWrt", imported.entries), "OpenWiki");
  assert.equal(imported.entries[0].source, "import");
});

test("导入格式有错、未闭合引号、超文件和行数限制时不给出可导入列表", () => {
  for (const csv of ['"Unclosed', '"Closed"junk', "target,target\nA,B", "x".repeat(MAX_CSV_BYTES + 1), Array.from({ length: MAX_CSV_ROWS + 1 }, (_, i) => `Word${i}`).join("\n")]) {
    const preview = previewVocabularyCsv(csv, emptyVocabulary());
    assert.ok(preview.errors.length, csv.slice(0, 30));
    assert.equal(preview.canImport, false);
    assert.deepEqual(preview.entriesToAdd, []);
  }
  const invalid = previewVocabularyCsv("target\n123\n=SUM(A1)\nBad\u200bWord\n\"\nEdge\"\nGoodWord", emptyVocabulary());
  assert.equal(invalid.invalidCount, 4);
  assert.equal(invalid.validCount, 1);
});

test("CSV容量预览明确报告溢出，提交时再次检查容量避免旧预览丢数据", () => {
  const almost = { ...emptyVocabulary(), entries: Array.from({ length: MAX_RULES - 1 }, (_, i) => word(`Existing${i}`)) };
  const preview = previewVocabularyCsv("NewOne\nNewTwo", almost);
  assert.equal(preview.validCount, 1);
  assert.equal(preview.overflowCount, 1);
  const full = upsertVocabularyWord(almost, "ConcurrentWord");
  assert.throws(() => importVocabularyEntries(full, preview.entriesToAdd), /500/);
  assert.equal(full.entries.length, MAX_RULES);
});

test("CSV导出再导入保留正确词与旧替换语义，并追溯原来源", () => {
  const source = { ...emptyVocabulary(), entries: [word('Acme, "Inc."', "manual"), { variant: "+Acme", target: "Acme", source: "manual" }, { ...word("徐翔", "auto"), variant: "徐向" }] };
  const csv = exportVocabularyCsv(source);
  assert.ok(csv.startsWith("\uFEFFtarget,variant,kind,source,originSource"));
  assert.ok(csv.includes('"\'+Acme"'), "电子表格公式触发符必须加文本前缀");
  const preview = previewVocabularyCsv(csv, emptyVocabulary());
  assert.equal(preview.invalidCount, 0);
  assert.equal(preview.validCount, 3);
  const imported = importVocabularyEntries(emptyVocabulary(), preview.entriesToAdd, { now: NOW });
  assert.equal(imported.entries.find((entry) => entry.target === "徐翔").kind, "hotword");
  assert.equal(imported.entries.find((entry) => entry.target === "徐翔").originSource, "auto");
  assert.equal(applyLearnedVocabulary("+Acme", imported.entries), "Acme");
  assert.ok(imported.entries.every((entry) => entry.source === "import"));
  assert.deepEqual(previewVocabularyCsv(exportVocabularyCsv(imported), emptyVocabulary()).entriesToAdd.map(({ target, variant, kind, originSource }) => ({ target, variant, kind, originSource })), preview.entriesToAdd.map(({ target, variant, kind, originSource }) => ({ target, variant, kind, originSource })));
});

test("导入阶段拒绝绕过预览的无效条目，同时重复导入不会重置已有来源", () => {
  assert.throws(() => importVocabularyEntries(emptyVocabulary(), [word("123")]), /无效/);
  const state = upsertVocabularyWord(emptyVocabulary(), "WithType", { now: NOW });
  assert.deepEqual(importVocabularyEntries(state, [word("withtype", "import")]), state);
});

test("导出包含旧手动规则，手动映射优先，重复与被手动禁用的规则不重新激活", () => {
  const state = { ...emptyVocabulary(), entries: [word("WithType"), { variant: "Beta", target: "Other", source: "manual" }, { variant: "Alpha", target: "Gamma", source: "manual" }, { variant: "Delta", target: "Omega", source: "manual" }] };
  const csv = exportVocabularyCsv(state, { manualVocabulary: "Alpha=Beta|Beta\nWithType=with type" });
  const preview = previewVocabularyCsv(csv, emptyVocabulary());
  assert.equal(preview.invalidCount, 0);
  assert.deepEqual(preview.entriesToAdd.filter((entry) => !entry.kind).map(({ variant, target }) => ({ variant, target })), [{ variant: "with type", target: "WithType" }, { variant: "Beta", target: "Alpha" }, { variant: "Delta", target: "Omega" }]);
  const imported = importVocabularyEntries(emptyVocabulary(), preview.entriesToAdd);
  assert.equal(applyLearnedVocabulary("Beta Alpha Delta", imported.entries), "Alpha Alpha Omega");
  assert.ok(imported.entries.every((entry) => entry.kind === "hotword" || entry.originSource === "manual"));
});

test("导出不会按保存容量静默截断旧手动规则，重新导入明确报告超额", () => {
  const rules = Array.from({ length: MAX_RULES + 2 }, (_, i) => `Target${i}=Variant${i}`).join("\n");
  const csv = exportVocabularyCsv(emptyVocabulary(), { manualVocabulary: rules });
  assert.equal(csv.split("\r\n").length, MAX_RULES + 3);
  const preview = previewVocabularyCsv(csv, emptyVocabulary());
  assert.equal(preview.validCount, MAX_RULES);
  assert.equal(preview.overflowCount, 2);
});

test("CSV与手动同一替换判重复，交叉冲突明确报错而不是保存后静默无效", () => {
  const duplicate = previewVocabularyCsv("Beta,Alpha", emptyVocabulary(), "Alpha=Beta");
  assert.equal(duplicate.duplicateCount, 1);
  const conflict = previewVocabularyCsv("Alpha,Gamma\nGamma,Beta\nBeta,Delta", emptyVocabulary(), "Alpha=Beta");
  assert.equal(conflict.invalidCount, 3);
  assert.equal(conflict.validCount, 0);
  assert.ok(conflict.rows.every((row) => row.reason.includes("手动")));
  assert.throws(() => importVocabularyEntries(emptyVocabulary(), [{ variant: "Alpha", target: "Gamma", source: "import" }], { manualVocabulary: "Alpha=Beta" }), /无效/);
});

test("导入同目标替换保留手动正确词来源与编辑身份，新增数量真实且可往返", () => {
  const original = upsertVocabularyWord(emptyVocabulary(), "WithType", { now: NOW });
  const preview = previewVocabularyCsv("with type,WithType", original);
  const imported = importVocabularyEntries(original, preview.entriesToAdd, { now: NOW + 1 });
  assert.equal(imported.entries.length - original.entries.length, 1);
  assert.deepEqual(imported.entries.find((entry) => entry.kind === "hotword"), original.entries[0]);
  assert.equal(imported.entries.find((entry) => !entry.kind).source, "import");
  const restored = importVocabularyEntries(emptyVocabulary(), previewVocabularyCsv(exportVocabularyCsv(imported), emptyVocabulary()).entriesToAdd);
  assert.equal(restored.entries.length, 2);
  assert.equal(restored.entries.find((entry) => entry.kind === "hotword").originSource, "manual");
  assert.equal(applyLearnedVocabulary("with type", restored.entries), "WithType");
  assert.deepEqual(collectAsrHotWords("", restored.entries), ["WithType"]);
  const reverse = upsertVocabularyWord({ ...emptyVocabulary(), entries: [{ variant: "with type", target: "WithType", source: "import" }] }, "WithType");
  assert.equal(reverse.entries.length, 2);
});
