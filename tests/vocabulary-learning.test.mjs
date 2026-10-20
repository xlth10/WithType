import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_RULES, MAX_AUTO_HOTWORDS, applyLearnedVocabulary, collectAsrHotWords, correctionKey, dismissCorrection, emptyVocabulary,
  extractCorrections, learnCorrections, normalizeVocabulary, soundsLike, validCorrection,
} from "../src/vocabulary/learning.js";

const DAY = 86400000;
const NOW = Date.UTC(2026, 8, 28);
const PAIR = { variant: "徐向", target: "徐翔" };
const observe = (state, sessionId, extra = {}) => learnCorrections(state, {
  original: "明天联系徐向开会。", edited: "明天联系徐翔开会。", sessionId, now: NOW, ...extra,
});

test("一次有效纠正积累正确热词，重复任务和重复事件都幂等且不做强制替换", () => {
  const initial = emptyVocabulary();
  const first = observe(initial, "session-1");
  assert.deepEqual(first.learned, [PAIR]);
  assert.match(first.state.entries[0].id, /^[\da-f-]{36}$/i);
  assert.deepEqual(first.state.entries.map(({ id, ...entry }) => entry), [{ ...PAIR, kind: "hotword", source: "auto", learnedAt: NOW }]);
  assert.deepEqual(first.undoToken.entries, first.state.entries);
  assert.deepEqual(first.state.candidates, []);
  assert.deepEqual(observe(first.state, "session-1"), { state: first.state, learned: [] });
  assert.deepEqual(observe(first.state, "session-2"), { state: first.state, learned: [] });
  assert.equal(applyLearnedVocabulary("联系徐向开会", first.state.entries), "联系徐向开会");
  assert.deepEqual(collectAsrHotWords("", first.state.entries), ["徐翔"]);
  assert.deepEqual(initial, emptyVocabulary(), "学习不能修改调用方的原快照");
});

test("旧候选只在载入时保留；新的有效纠正直接记正确词，不继续两次确认门槛", () => {
  const candidate = { ...PAIR, count: 1, lastSeen: NOW, sessionId: "session-old" };
  const state = { ...emptyVocabulary(), candidates: [candidate] };
  assert.deepEqual(normalizeVocabulary(state, NOW).candidates, [candidate]);
  assert.deepEqual(normalizeVocabulary(state, NOW + 30 * DAY + 1).candidates, []);
  const result = observe(state, "session-new");
  assert.deepEqual(result.learned, [PAIR]);
  assert.equal(result.state.entries[0].kind, "hotword");
  assert.deepEqual(result.state.candidates, []);
});

test("载入丢弃过期、未来时间与不安全候选", () => {
  const valid = { ...PAIR, count: 1, lastSeen: NOW, sessionId: "ok" };
  const state = normalizeVocabulary({ candidates: [
    { ...valid, variant: "玉米", target: "域名", lastSeen: NOW - 30 * DAY - 1 },
    { ...valid, lastSeen: NOW + 1 },
    { ...valid, variant: "周四", target: "周三" },
    valid,
  ] }, NOW);
  assert.deepEqual(state.candidates, [valid]);
});

test("近音专名可学，数字改动、语义同音字和改写内容不可自动学", () => {
  for (const [variant, target] of [["玉米", "域名"], ["徐向", "徐翔"], ["OpenWrt", "OpenWiki"]]) {
    assert.equal(soundsLike(variant, target), true, `${variant} → ${target}`);
  }
  for (const [variant, target] of [["共5次", "共4次"], ["版本１", "版本２"], ["他的", "她的"], ["在见", "再见"], ["周四", "周三"], ["测试一下", "要求变更"]]) {
    assert.equal(soundsLike(variant, target), false, `${variant} → ${target}`);
    assert.deepEqual(extractCorrections(variant, target), []);
  }
});

test("LCS分开多个短术语，单字变更扩展到共同上下文", () => {
  assert.deepEqual(extractCorrections("请联系徐向和张伟。", "请联系徐翔和张炜。"), [
    PAIR, { variant: "张伟", target: "张炜" },
  ]);
  assert.deepEqual(extractCorrections("向明明天来。", "翔明明天来。"), [{ variant: "向明", target: "翔明" }]);
});

test("纯增加、纯删除、标点与超长文档不产生全局规则", () => {
  for (const [original, edited] of [["明天开会", "明天上午开会"], ["明天上午开会", "明天开会"], ["好的。", "好的！"], ["", "徐翔"], ["徐向", ""], ["徐向".repeat(300), "徐翔".repeat(300)]]) {
    assert.deepEqual(extractCorrections(original, edited), []);
  }
  for (const pair of [{ variant: "a", target: "alpha" }, { variant: "向", target: "翔" }, { variant: "a sentence!", target: "a sentence?" }, { variant: "徐向".repeat(7), target: "徐翔".repeat(7) }]) {
    assert.equal(validCorrection(pair, false), false);
  }
});

test("明确手动纠正可直接学非近音词，但仍限制为短术语", () => {
  assert.equal(learnCorrections(emptyVocabulary(), { original: "周四", edited: "周三", sessionId: "manual", now: NOW }).learned.length, 0);
  const result = learnCorrections(emptyVocabulary(), { original: "周四", edited: "周三", manual: true, sessionId: "manual", now: NOW });
  assert.deepEqual(result.learned, [{ variant: "周四", target: "周三" }]);
  assert.equal(result.state.entries[0].source, "manual");
});

test("手动词典优先，已有同一规则或冲突规则不自动学习", () => {
  for (const vocabulary of ["徐翔=徐向", "徐相=徐向", "徐向=徐象"]) {
    const result = observe(emptyVocabulary(), "session-1", { vocabulary });
    assert.deepEqual(result.state.candidates, [], vocabulary);
    assert.deepEqual(result.learned, [], vocabulary);
  }
  const state = { ...emptyVocabulary(), entries: [{ variant: "徐向", target: "徐相", source: "manual" }] };
  assert.deepEqual(observe(state, "session-1").state.candidates, []);
});

test("删除已学词后再次纠正不自动学回，明确手动恢复仍有效", () => {
  const learned = observe(observe(emptyVocabulary(), "session-1").state, "session-2").state;
  const dismissed = dismissCorrection(learned, PAIR);
  assert.deepEqual(dismissed.entries, []);
  assert.ok(dismissed.dismissed.includes(correctionKey(PAIR)));
  const first = observe(dismissed, "session-3");
  const second = observe(first.state, "session-4");
  assert.deepEqual(second.state.entries, []);
  assert.deepEqual(second.state.candidates, []);
  const restored = observe(second.state, "manual", { manual: true });
  assert.deepEqual(restored.learned, [PAIR]);
  assert.deepEqual(restored.state.dismissed, []);
});

test("词库容量有界，满额时保留已有规则", () => {
  const entries = Array.from({ length: MAX_RULES }, (_, i) => ({ variant: `older${i}`, target: `chosen${i}`, source: "manual" }));
  const state = { ...emptyVocabulary(), entries };
  const result = observe(state, "manual", { manual: true });
  assert.deepEqual(result.learned, []);
  assert.deepEqual(result.state.entries, entries);
});

test("英文自动规则遵守词边界、忽略大小写，不替换标识符中间", () => {
  const entries = [{ variant: "OpenWrt", target: "OpenWiki" }];
  assert.equal(applyLearnedVocabulary("openwrt，OPENWRT /myOpenWrt OpenWrt2 _OpenWrt OpenWrt_x", entries), "OpenWiki，OpenWiki /myOpenWrt OpenWrt2 _OpenWrt OpenWrt_x");
});

test("替换按长词优先且一次完成，不级联套用另一条自动规则", () => {
  const rules = [
    { variant: "徐向", target: "徐翔" }, { variant: "徐向明", target: "徐向鸣" },
    { variant: "徐翔", target: "徐相" },
  ];
  assert.equal(applyLearnedVocabulary("徐向明和徐向", rules), "徐向鸣和徐翔");
  assert.equal(applyLearnedVocabulary("徐向", rules, "徐相=徐向"), "徐向", "手动词典冲突应留给手动替换阶段");
  assert.equal(applyLearnedVocabulary("A+B", [{ variant: "A+B", target: "AB" }]), "AB", "词条作为字面值，不能被当作正则");
});

test("新自动词条按正确目标去重，原误识别来源不建立替换冲突", () => {
  const first = observe(emptyVocabulary(), "first").state;
  const duplicate = learnCorrections(first, { original: "徐相", edited: "徐翔", sessionId: "second", now: NOW });
  assert.deepEqual(duplicate.learned, []);
  assert.equal(duplicate.state.entries.length, 1);
  const anotherName = learnCorrections(first, { original: "徐翔", edited: "徐相", sessionId: "third", now: NOW });
  assert.deepEqual(anotherName.learned, [{ variant: "徐翔", target: "徐相" }]);
  assert.equal(anotherName.state.entries.length, 2);
  assert.equal(applyLearnedVocabulary("徐向和徐翔", anotherName.state.entries), "徐向和徐翔");
});

test("删除正确词后不同误识别也不会重新学回，显式教学可恢复为手动替换", () => {
  const first = observe(emptyVocabulary(), "first").state;
  const dismissed = dismissCorrection(first, PAIR);
  const anotherVariant = learnCorrections(dismissed, { original: "徐相", edited: "徐翔", sessionId: "second", now: NOW });
  assert.deepEqual(anotherVariant.state.entries, []);
  const manual = observe(dismissed, "manual", { manual: true });
  assert.equal(manual.state.entries[0].source, "manual");
  assert.equal(manual.state.entries[0].kind, undefined);
  assert.deepEqual(manual.state.dismissed, []);
  assert.equal(applyLearnedVocabulary("徐向", manual.state.entries), "徐翔");
});

test("显式历史纠正把现有热词升级为替换，载入不改变旧规则含义", () => {
  const first = observe(emptyVocabulary(), "first").state;
  const manual = observe(first, "manual", { manual: true });
  assert.equal(manual.state.entries.length, 1);
  assert.equal(manual.state.entries[0].kind, undefined);
  assert.equal(manual.state.entries[0].source, "manual");
  const legacy = { ...PAIR, source: "auto" };
  const old = normalizeVocabulary({ ...emptyVocabulary(), entries: [legacy] }, NOW);
  assert.deepEqual(old.entries, [legacy]);
  assert.equal(applyLearnedVocabulary("徐向", old.entries), "徐翔");
});

test("自动正确词最多30，整体500且优先保留旧替换，不驱逐已有词", () => {
  const hotwords = Array.from({ length: MAX_AUTO_HOTWORDS + 1 }, (_, i) => ({ variant: `term${i}x`, target: `term${i}`, kind: "hotword", source: "auto" }));
  const normalized = normalizeVocabulary({ ...emptyVocabulary(), entries: hotwords }, NOW);
  assert.equal(normalized.entries.length, MAX_AUTO_HOTWORDS);
  assert.deepEqual(observe(normalized, "new").learned, []);
  const replacements = Array.from({ length: 40 }, (_, i) => ({ variant: `old${i}`, target: `keep${i}`, source: "manual" }));
  const mixed = normalizeVocabulary({ ...emptyVocabulary(), entries: [...hotwords, ...replacements] }, NOW);
  assert.equal(mixed.entries.length, 70);
  assert.deepEqual(mixed.entries.slice(0, 40), replacements);
  assert.equal(mixed.entries.filter((entry) => entry.kind === "hotword").length, 30);
  const full = normalizeVocabulary({ ...emptyVocabulary(), entries: [...Array.from({ length: MAX_RULES }, (_, i) => ({ target: `Manual${i}`, source: "manual", kind: "hotword" })), ...hotwords] }, NOW);
  assert.equal(full.entries.length, MAX_RULES);
  assert.ok(full.entries.every((entry) => entry.source === "manual"));
});

test("ASR提示只收正确词、大小写去重、控制符拒绝且每项最多40个字符", () => {
  const words = collectAsrHotWords("Qwen3=快问三|千问三\r\n徐翔=徐向\n", [
    { variant: "Qwen", target: "qwen3" }, { target: "DeepSeek" },
    { target: "bad\nword" }, { target: "bad\tword" }, { target: "bad\u200bword" },
    { target: "词".repeat(40) }, { target: "词".repeat(41) }, { target: null },
  ]);
  assert.deepEqual(words, ["Qwen3", "徐翔", "DeepSeek", "词".repeat(40)]);
  assert.ok(!words.includes("徐向"));
  assert.deepEqual(collectAsrHotWords(null, null), []);
});

test("ASR提示总量100且检查最多1000项，后续条目不会被访问", () => {
  const many = Array.from({ length: 101 }, (_, i) => ({ target: `Word${i}` }));
  assert.equal(collectAsrHotWords("", many).length, 100);
  const bounded = Array.from({ length: 1001 }, (_, i) => Object.defineProperty({}, "target", {
    get() { if (i === 1000) throw new Error("不应检查第1001项"); return i === 999 ? "LastAllowed" : ""; },
  }));
  assert.deepEqual(collectAsrHotWords("", bounded), ["LastAllowed"]);
  const forbidden = [Object.defineProperty({}, "target", { get() { throw new Error("手动词条已用完检查预算"); } })];
  assert.deepEqual(collectAsrHotWords("=\n".repeat(1000), forbidden), []);
});
