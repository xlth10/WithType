import assert from "node:assert/strict";
import { test } from "node:test";
import { createVocabularyStore } from "../src/vocabulary/store.js";
import { emptyVocabulary } from "../src/vocabulary/learning.js";

const FIRST = { variant: "徐向", target: "徐翔", source: "auto" };
const SECOND = { variant: "玉米", target: "域名", source: "auto" };
const defer = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

test("并发修改串行持久化，后一项基于前一项保存结果", async () => {
  const blocked = defer(), entered = defer(), persisted = [], changes = [];
  const store = createVocabularyStore(async (command, payload) => {
    if (command === "load_vocabulary") return emptyVocabulary();
    if (!persisted.length) { entered.resolve(); await blocked.promise; }
    persisted.push(payload.vocabulary);
  }, (state) => changes.push(state));
  await store.load();
  const first = store.update((state) => ({ ...state, entries: [FIRST] }));
  const second = store.update((state) => ({ ...state, entries: [...state.entries, SECOND] }));
  await entered.promise;
  assert.equal(changes.length, 1, "保存完成前不通知界面成功");
  blocked.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(persisted.map((state) => state.entries), [[FIRST], [FIRST, SECOND]]);
  assert.deepEqual(changes.at(-1).entries, [FIRST, SECOND]);
});

test("原地修改后的保存失败不污染内存，队列能继续", async () => {
  let fail = true;
  const changes = [];
  const store = createVocabularyStore(async (command) => {
    if (command === "load_vocabulary") return { ...emptyVocabulary(), entries: [FIRST] };
    if (fail) throw new Error("磁盘已满");
  }, (state) => changes.push(state));
  await store.load();
  await assert.rejects(store.update((state) => {
    state.entries[0].target = "徐相";
    state.entries.push(SECOND);
    return state;
  }), /磁盘已满/);
  assert.equal(changes.length, 1);
  fail = false;
  const recovered = await store.update((state) => state);
  assert.deepEqual(recovered.entries, [FIRST]);
});

test("load返回值、订阅快照和transform持有对象不能绕过持久化改写状态", async () => {
  let announced, retained;
  const raw = { ...emptyVocabulary(), entries: [FIRST] };
  const store = createVocabularyStore(async (command) => command === "load_vocabulary" ? raw : undefined, (state) => { announced = state; });
  const returned = await store.load();
  returned.entries[0].target = "返回值被改";
  announced.entries.push(SECOND);
  await store.update((state) => { retained = state; return state; });
  retained.entries[0].target = "闭包被改";
  const final = await store.update((state) => state);
  assert.deepEqual(final.entries, [FIRST]);
  assert.deepEqual(raw.entries, [FIRST]);
});

test("读取失败不清空已经成功载入的状态", async () => {
  let fail = false;
  const store = createVocabularyStore(async (command) => {
    if (command === "load_vocabulary") {
      if (fail) throw new Error("读取失败");
      return { ...emptyVocabulary(), entries: [FIRST] };
    }
  }, () => {});
  await store.load();
  fail = true;
  await assert.rejects(store.load(), /读取失败/);
  assert.deepEqual((await store.update((state) => state)).entries, [FIRST]);
});

test("异步学习占住队列，后续修改读取已保存快照", async () => {
  const started = defer(), finishLearning = defer(), changes = [], persisted = [];
  const store = createVocabularyStore(async (command, payload) => {
    if (command === "load_vocabulary") return null;
    persisted.push(structuredClone(payload.vocabulary));
  }, (state) => changes.push(state));
  await store.load();
  const learned = store.update(async (state) => {
    started.resolve();
    await finishLearning.promise;
    state.entries.push(FIRST);
    return state;
  });
  let secondStarted = false;
  const manual = store.update((state) => {
    secondStarted = true;
    assert.deepEqual(state.entries, [FIRST]);
    return { ...state, entries: [...state.entries, SECOND] };
  });
  await started.promise;
  assert.equal(secondStarted, false);
  assert.deepEqual(persisted, []);
  assert.deepEqual(changes, [emptyVocabulary()]);
  finishLearning.resolve();
  await Promise.all([learned, manual]);
  assert.deepEqual(persisted.map((state) => state.entries), [[FIRST], [FIRST, SECOND]]);
  assert.deepEqual(changes.at(-1).entries, [FIRST, SECOND]);
});

test("异步学习失败不泄漏修改，后续队列仍可保存", async () => {
  const changes = [], persisted = [];
  const store = createVocabularyStore(async (command, payload) => {
    if (command === "load_vocabulary") return { ...emptyVocabulary(), entries: [FIRST] };
    persisted.push(payload.vocabulary);
  }, (state) => changes.push(state));
  await store.load();
  const failed = store.update(async (state) => {
    state.entries[0].target = "损坏快照";
    await Promise.resolve();
    throw new Error("学习模块载入失败");
  });
  const recovered = store.update(async (state) => {
    await Promise.resolve();
    return { ...state, entries: [...state.entries, SECOND] };
  });
  await assert.rejects(failed, /学习模块载入失败/);
  assert.deepEqual((await recovered).entries, [FIRST, SECOND]);
  assert.equal(persisted.length, 1);
  assert.equal(changes.length, 2);
});

test("空词库仍保留归一化后的忽略记录", async () => {
  const store = createVocabularyStore(async () => ({
    entries: [], candidates: [], dismissed: ["徐向\u0000徐翔", null, "徐向\u0000徐翔", "x".repeat(101)],
  }), () => {});
  assert.deepEqual(await store.load(), { ...emptyVocabulary(), dismissed: ["徐向\u0000徐翔"] });
});

test("重启载入及保存保留热词类型、旧替换和旧候选，不隐式迁移含义", async () => {
  const hotword = { ...SECOND, kind: "hotword" };
  const candidate = { variant: "张伟", target: "张炜", count: 1, lastSeen: Date.now(), sessionId: "old-candidate" };
  const raw = { ...emptyVocabulary(), entries: [FIRST, hotword], candidates: [candidate] };
  const persisted = [];
  const store = createVocabularyStore(async (command, payload) => {
    if (command === "load_vocabulary") return structuredClone(raw);
    persisted.push(payload.vocabulary);
  }, () => {});
  assert.deepEqual(await store.load(), raw);
  const saved = await store.update((state) => state);
  assert.deepEqual(saved, raw);
  assert.deepEqual(persisted, [raw]);
  assert.equal(saved.entries[0].kind, undefined, "旧版缺kind的规则继续作为替换规则保存");
  assert.equal(saved.entries[1].kind, "hotword");
  assert.equal(saved.candidates.length, 1, "单纯重启和保存不会激活旧候选");
});
