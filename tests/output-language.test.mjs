import assert from "node:assert/strict";
import { test } from "node:test";
import { parseOutputLanguage } from "../src/text/outputLanguage.js";

test("只识别末尾明确的语言口令", () => {
  assert.deepEqual(parseOutputLanguage("明天开会，用英文。"), { body: "明天开会", language: "英文" });
  assert.deepEqual(parseOutputLanguage("请把文件发给小王，翻译成西班牙语"), { body: "请把文件发给小王", language: "西班牙文" });
  assert.equal(parseOutputLanguage("用英文写的报告已经发出"), null);
  assert.equal(parseOutputLanguage("用英文"), null);
});
