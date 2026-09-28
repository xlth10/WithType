import { test } from "node:test";
import assert from "node:assert/strict";
import { acquireMicrophone } from "../src/dictation/acquireMicrophone.js";
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function devices() {
  const counts = { stopped: 0, closed: 0 };
  const stream = { getTracks: () => [{ stop: () => counts.stopped++ }] };
  const context = { state: "running", close: async () => { counts.closed++; } };
  return { counts, stream, context };
}
test("取消后麦克风授权迟到，立刻释放流且不创建音频图", async () => {
  const { counts, stream } = devices();
  const pending = deferred(); let current = true;
  const task = acquireMicrophone({ getUserMedia: () => pending.promise, createContext: () => { throw Error("不应创建"); }, isCurrent: () => current });
  current = false; pending.resolve(stream);
  assert.equal(await task, null);
  assert.equal(counts.stopped, 1);
});
test("AudioContext 恢复期间取消，同时释放流和上下文", async () => {
  const { counts, stream, context } = devices();
  const pending = deferred(); let current = true;
  context.state = "suspended"; context.resume = () => pending.promise;
  const task = acquireMicrophone({ getUserMedia: async () => stream, createContext: () => context, isCurrent: () => current });
  await Promise.resolve(); current = false; pending.resolve();
  assert.equal(await task, null);
  assert.deepEqual(counts, { stopped: 1, closed: 1 });
});
test("设备初始化失败不泄漏已授权的麦克风", async () => {
  const { counts, stream } = devices();
  await assert.rejects(acquireMicrophone({ getUserMedia: async () => stream, createContext: () => { throw Error("设备失败"); }, isCurrent: () => true }), /设备失败/);
  assert.equal(counts.stopped, 1);
});
test("正常获取将资源交给录音器，暂不释放", async () => {
  const { counts, stream, context } = devices();
  assert.deepEqual(await acquireMicrophone({ getUserMedia: async () => stream, createContext: () => context, isCurrent: () => true }), { stream, context });
  assert.deepEqual(counts, { stopped: 0, closed: 0 });
});
