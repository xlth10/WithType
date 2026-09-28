import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_RULES, applyLearnedVocabulary, correctionKey, dismissCorrection, emptyVocabulary,
  extractCorrections, learnCorrections, normalizeVocabulary, soundsLike, validCorrection,
} from "../src/vocabulary/learning.js";

const DAY = 86400000;
const NOW = Date.UTC(2026, 8, 28);
const PAIR = { variant: "徐向", target: "徐翔" };
const observe = (state, sessionId, extra = {}) => learnCorrections(state, {
  original: "明天联系徐向开会。", edited: "明天联系徐翔开会。", sessionId, now: NOW, ...extra,
});

test("同一纠正需两个独立口述任务，重复事件不能提前生效", () => {
  const initial = emptyVocabulary();
  const first = observe(initial, "session-1");
  assert.deepEqual(first.learned, []);
  assert.equal(first.state.candidates.length, 1);
  const repeated = observe(first.state, "session-1");
  assert.deepEqual(repeated, first);
  const second = observe(repeated.state, "session-2");
  assert.deepEqual(second.learned, [PAIR]);
  assert.deepEqual(second.state.entries, [{ ...PAIR, source: "auto", learnedAt: NOW }]);
  assert.deepEqual(second.state.candidates, []);
  assert.deepEqual(initial, emptyVocabulary(), "学习不能修改调用方的原快照");
});

test("候选在30天内可确认，超时重新累计", () => {
  const first = observe(emptyVocabulary(), "session-1").state;
  assert.equal(observe(first, "session-2", { now: NOW + 30 * DAY }).learned.length, 1);
  const expired = observe(first, "session-2", { now: NOW + 30 * DAY + 1 });
  assert.equal(expired.learned.length, 0);
  assert.equal(expired.state.candidates[0].sessionId, "session-2");
  assert.equal(expired.state.candidates[0].lastSeen, NOW + 30 * DAY + 1);
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

test("手动词典优先，已有同一规则或冲突规则不再累计自动候选", () => {
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
