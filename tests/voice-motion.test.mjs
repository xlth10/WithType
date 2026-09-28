import assert from "node:assert/strict";
import { test } from "node:test";
import { advanceEngine, createEngine, inkBeads } from "../src/voice/motion.js";

test("静音与底噪保持紧凑墨点，不产生待机波浪", () => {
  const engine = createEngine();
  const still = inkBeads(engine);
  for (let i = 0; i < 300; i++) advanceEngine(engine, { mode: "recording", level: i % 2 ? 0 : 0.02 }, 1 / 60);
  assert.deepEqual(inkBeads(engine), still);
});

test("不同帧率、说话和停顿时侧珠均不超过中心85%与60%", () => {
  const engine = createEngine();
  let audible = false;
  for (let i = 0; i < 800; i++) {
    advanceEngine(engine, { mode: "recording", level: i % 100 < 25 ? 0.8 : 0 }, [1 / 120, 1 / 30, 0.4][i % 3]);
    const [center, leftInner, leftOuter, rightInner, rightOuter] = inkBeads(engine);
    audible ||= center.ry > 6;
    for (const inner of [leftInner, rightInner]) assert.ok(inner.ry <= center.ry * 0.85);
    for (const outer of [leftOuter, rightOuter]) assert.ok(outer.ry <= center.ry * 0.6);
    assert.ok(center.ry <= 7.8 && center.ry >= 5);
  }
  assert.equal(audible, true, "有声输入必须可见");
});

test("减少动态效果停止装饰性相位，同时保留麦克风电平反馈", () => {
  const engine = createEngine();
  for (let i = 0; i < 120; i++) advanceEngine(engine, { mode: "recording", level: 0.5 }, 1 / 60, true);
  assert.equal(engine.phase, 0);
  assert.ok(inkBeads(engine)[0].ry > 6);
  for (let i = 0; i < 180; i++) advanceEngine(engine, { mode: "processing", level: 0 }, 1 / 60, true);
  const settled = inkBeads(engine);
  for (let i = 0; i < 180; i++) advanceEngine(engine, { mode: "processing", level: 0 }, 1 / 60, true);
  assert.deepEqual(inkBeads(engine), settled);
});
