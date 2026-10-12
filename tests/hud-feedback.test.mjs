import assert from "node:assert/strict";
import { test } from "node:test";
import { advanceEngine, createEngine, hudBeads } from "../src/voice/motion.js";

const settle = (engine, mode, reduced = false) => {
  for (let i = 0; i < 240; i++) advanceEngine(engine, { mode, level: 0.65 }, 1 / 60, reduced);
  return hudBeads(engine);
};

function checkSymmetry(shapes) {
  for (const shape of shapes) {
    assert.ok([shape.cx, shape.cy, shape.rx, shape.ry, shape.fillOpacity, shape.strokeOpacity].every(Number.isFinite));
    assert.ok(shape.fillOpacity >= 0 && shape.fillOpacity <= 1);
    assert.ok(shape.strokeOpacity >= 0 && shape.strokeOpacity <= 1);
    const margin = shape.strokeOpacity > 0 ? shape.lineWidth / 2 : 0;
    assert.ok(shape.cy - shape.ry - margin >= 0);
    assert.ok(shape.cy + shape.ry + margin <= 20);
    assert.ok(shape.cx - shape.rx - margin >= 0 && shape.cx + shape.rx + margin <= 60);
    const mirror = shapes.find((other) => Math.abs(shape.cx + other.cx - 60) < 1e-8 &&
      other.cy === shape.cy && other.rx === shape.rx && other.ry === shape.ry &&
      other.fillOpacity === shape.fillOpacity && other.strokeOpacity === shape.strokeOpacity &&
      other.fill === shape.fill && other.stroke === shape.stroke);
    assert.ok(mirror, `Missing mirrored bead at ${shape.cx}`);
  }
}

test("HUD 全状态及打断过渡保持左右镜像、边界内绘制和可见主墨珠", () => {
  const engine = createEngine();
  for (let cycle = 0; cycle < 3; cycle++) {
    for (const mode of ["idle", "recording", "processing", "done", "recording", "error", "idle"]) {
      for (let i = 0; i < 100; i++) {
        advanceEngine(engine, { mode, level: i % 20 < 10 ? 0.85 : 0 }, [1 / 120, 1 / 30, 0.4][i % 3]);
        const shapes = hudBeads(engine);
        assert.ok(shapes.some((s) => Math.max(s.fillOpacity, s.strokeOpacity) > 0.1 && s.rx >= 4));
        checkSymmetry(shapes);
      }
    }
  }
});

test("HUD 处理中五珠轻跃，静音录音不会伪装成处理动画", () => {
  const engine = createEngine();
  for (let i = 0; i < 240; i++) advanceEngine(engine, { mode: "recording", level: 0 }, 1 / 60);
  const quiet = hudBeads(engine);
  assert.equal(quiet.length, 1);
  for (let i = 0; i < 60; i++) advanceEngine(engine, { mode: "recording", level: 0 }, 1 / 60);
  assert.deepEqual(hudBeads(engine), quiet);
  const working = settle(engine, "processing");
  assert.equal(working.length, 5);
  for (let i = 0; i < 20; i++) advanceEngine(engine, { mode: "processing", level: 0 }, 1 / 60);
  assert.notDeepEqual(hudBeads(engine), working);
});

test("HUD 完成落墨稍展，失败退成空珠，不依赖文字或额外配色区分", () => {
  const done = settle(createEngine(), "done", true);
  const error = settle(createEngine(), "error", true);
  assert.equal(done.length, 3);
  assert.ok(done[0].rx > done[0].ry * 1.2 && done[0].rx < done[0].ry * 1.5);
  assert.ok(done.every((s) => s.fillOpacity > 0 && s.strokeOpacity === 0));
  assert.equal(error.length, 5);
  assert.ok(error.every((s) => s.fillOpacity === 0 && s.strokeOpacity > 0 && s.rx === s.ry));
  assert.ok([...done, ...error].every((s) => s.fill === "#41433f" && s.stroke === "#41433f"));
  checkSymmetry(done); checkSymmetry(error);
});

test("HUD 减少动态效果保留不同状态的静态形态和录音电平反馈", () => {
  for (const mode of ["processing", "done", "error"]) {
    const engine = createEngine();
    const still = settle(engine, mode, true);
    for (let i = 0; i < 120; i++) advanceEngine(engine, { mode, level: 0 }, 1 / 60, true);
    assert.deepEqual(hudBeads(engine), still);
    assert.equal(engine.phase, 0);
  }
  const engine = createEngine();
  const quietRadius = hudBeads(engine)[0].ry;
  assert.ok(settle(engine, "recording", true)[0].ry > quietRadius);
});

test("HUD 被新状态打断时从当前墨珠形态继续，不在重定向当帧替换符号", () => {
  const engine = createEngine();
  for (const mode of ["recording", "processing", "done", "error", "recording"]) {
    const before = hudBeads(engine);
    advanceEngine(engine, { mode, level: 0.7 }, 0);
    assert.deepEqual(hudBeads(engine), before);
    for (let i = 0; i < 7; i++) advanceEngine(engine, { mode, level: 0.7 }, 1 / 60);
  }
});
