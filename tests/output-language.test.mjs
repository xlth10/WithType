import assert from "node:assert/strict";
import { test } from "node:test";
import { parseOutputLanguage } from "../src/text/outputLanguage.js";

test("只识别末尾明确的语言口令", () => {
  assert.deepEqual(parseOutputLanguage("明天开会，用英文。"), { body: "明天开会", language: "英文" });
  assert.deepEqual(parseOutputLanguage("请把文件发给小王，翻译成西班牙语"), { body: "请把文件发给小王", language: "西班牙文" });
  assert.deepEqual(parseOutputLanguage("翻译成日语：明天上午开会"), { body: "明天上午开会", language: "日文" });
  assert.deepEqual(parseOutputLanguage("请用英文翻译：下周发送报告"), { body: "下周发送报告", language: "英文" });
  assert.equal(parseOutputLanguage("用英文写的报告已经发出"), null);
  assert.equal(parseOutputLanguage("用英文"), null);
  assert.equal(parseOutputLanguage("这段话不要翻译成英文"), null);
  assert.deepEqual(parseOutputLanguage("明天开会，用英文吧。"), { body: "明天开会", language: "英文" });
  assert.deepEqual(parseOutputLanguage("用英文，明天上午开会"), { body: "明天上午开会", language: "英文" });
  assert.equal(parseOutputLanguage("好，用英文"), null);
});
