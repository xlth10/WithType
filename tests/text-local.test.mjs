// 本地文字纯函数测试：词典替换与轻度清理。
//
// 这两个函数跑在「不访问任何网络」的路径上（原文/术语纠正/轻度清理三种模式），
// 所以它们的行为必须完全确定：断言值全部来自实际运行结果，不是按词表推测的。
// 这里也刻意锁住「不许误伤」的一面——否定词和数字不能被清理规则吃掉。

import assert from "node:assert/strict";
import { test } from "node:test";

import { applyVocabulary, lightlyCleanText, parseCorrections } from "../src/text/localText.js";

test("parseCorrections 解析「目标=变体|变体」并跳过不成对的行", () => {
  const parsed = parseCorrections("VibeVoice=外部语音|vibe voice\nQwen3=快问三|千问三");
  assert.deepEqual(parsed, [
    { target: "VibeVoice", variant: "vibe voice" },
    { target: "VibeVoice", variant: "外部语音" },
    { target: "Qwen3", variant: "快问三" },
    { target: "Qwen3", variant: "千问三" },
  ]);
});

test("parseCorrections 按变体长度降序，长变体先替换", () => {
  // 长变体排在前面是为了避免短变体先吃掉长变体的一部分。
  const parsed = parseCorrections("A=A\nB=\n=x\nC=c1|c2|c3long");
  assert.deepEqual(parsed, [
    { target: "C", variant: "c3long" },
    { target: "C", variant: "c1" },
    { target: "C", variant: "c2" },
  ]);
});

test("parseCorrections 对非字符串输入返回空数组", () => {
  assert.deepEqual(parseCorrections(null), []);
  assert.deepEqual(parseCorrections(undefined), []);
  assert.deepEqual(parseCorrections(42), []);
  assert.deepEqual(parseCorrections(""), []);
});

test("applyVocabulary 替换所有出现位置", () => {
  const output = applyVocabulary("外部语音和vibe voice都要", "VibeVoice=外部语音|vibe voice");
  assert.equal(output, "VibeVoice和VibeVoice都要");
});

test("applyVocabulary 对非字符串输入返回空串", () => {
  assert.equal(applyVocabulary(null, "A=a"), "");
  assert.equal(applyVocabulary(123, "A=a"), "");
});

test("applyVocabulary 空词典时原文不变", () => {
  assert.equal(applyVocabulary("原样返回", ""), "原样返回");
});

test("lightlyCleanText 去掉句首的语气词并合并空白", () => {
  assert.equal(
    lightlyCleanText("嗯，那个，昨天跟客户对了一下，然后呢，性能那块还没定。"),
    "，昨天跟客户对了一下，性能那块还没定。",
  );
});

test("lightlyCleanText 只在语气词后紧跟边界字符时才删除", () => {
  // 「就是说」「那个」后面接的是实词，属于正常语句内容，不能删。
  assert.equal(lightlyCleanText("就是说先跑通登录和导出这两块"), "就是说先跑通登录和导出这两块");
  assert.equal(lightlyCleanText("那个问题我们下周再说"), "那个问题我们下周再说");
});

test("lightlyCleanText 处理空格分隔的语气词与连续语气词", () => {
  assert.equal(lightlyCleanText("呃 我觉得 不行"), "我觉得 不行");
  assert.equal(lightlyCleanText("嗯嗯嗯，好的"), "，好的");
});

test("lightlyCleanText 不破坏否定词与数字", () => {
  // 这一组是回归护栏：整理可以，但不能把意思改掉。
  assert.equal(lightlyCleanText("没有说不出 100 块"), "没有说不出 100 块");
  assert.equal(lightlyCleanText("他没有说不去"), "他没有说不去");
  assert.equal(lightlyCleanText("这个 方案 没有 问题。"), "这个 方案 没有 问题。");
});

test("lightlyCleanText 规整标点周围的空白与重复标点", () => {
  assert.equal(lightlyCleanText("他说：  完成度 30%  。。"), "他说： 完成度 30%。");
  assert.equal(lightlyCleanText("今天  开会  说了 三件事"), "今天 开会 说了 三件事");
});

test("lightlyCleanText 保留前导逗号与实词前的空格", () => {
  // 已知行为：删除语气词后可能留下前导标点，这里如实锁定，不做「顺手美化」。
  assert.equal(lightlyCleanText("那个，我们下周 再说。"), "，我们下周 再说。");
});

test("lightlyCleanText 对非字符串输入返回空串", () => {
  assert.equal(lightlyCleanText(null), "");
  assert.equal(lightlyCleanText(undefined), "");
});