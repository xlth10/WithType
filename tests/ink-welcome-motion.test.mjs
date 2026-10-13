import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DURATION, clamp, lerp, seg, sineInOut, cubicOut, cubicInOut,
  rng, cameraAt, view, dropAt, liquidAt, impactAt,
} from "../src/ui/inkWelcomeMotion.js";

function close(actual, expected, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
}

test("timeline progress saturates before and after each phase", () => {
  assert.equal(DURATION, 3.6);
  assert.equal(seg(-1, 0.14, 0.70), 0);
  assert.equal(seg(0.14, 0.14, 0.70), 0);
  close(seg(0.42, 0.14, 0.70), 0.5);
  assert.equal(seg(0.70, 0.14, 0.70), 1);
  assert.equal(seg(10, 0.14, 0.70), 1);
  assert.equal(seg(0.69, 0.70, 0.70), 0);
  assert.equal(seg(0.70, 0.70, 0.70), 1);
  assert.equal(clamp(7, 0, DURATION), DURATION);
  assert.equal(lerp(10, 30, 0.25), 15);
});

test("easing curves are monotone and have exact endpoints", () => {
  for (const easing of [sineInOut, cubicOut, cubicInOut]) {
    assert.equal(easing(0), 0);
    assert.equal(easing(1), 1);
    let last = 0;
    for (let i = 1; i <= 1000; i += 1) {
      const current = easing(i / 1000);
      assert.ok(current >= last && current <= 1);
      last = current;
    }
  }
  close(sineInOut(0.5), 0.5);
  assert.equal(cubicInOut(0.5), 0.5);
  assert.equal(cubicOut(0.5), 0.875);
});

test("fixed paper seed reproduces the approved fiber sequence", () => {
  const expected = [
    0.14484561909921467, 0.4853403316810727, 0.11713790567591786,
    0.7903731211554259, 0.6804238520562649, 0.40546107827685773,
    0.15462858602404594, 0.5871171972248703,
  ];
  const generate = rng(2317);
  assert.deepEqual(expected.map(() => generate()), expected);
  const a = rng(2317), b = rng(2317), zero = rng(0), one = rng(1);
  for (let i = 0; i < 1000; i += 1) {
    const value = a();
    assert.equal(value, b());
    assert.ok(value >= 0 && value < 1);
    assert.equal(zero(), one());
  }
  assert.notEqual(rng(2317)(), rng(2318)());
});

test("bead holds at the approved height, accelerates down, and stays on paper after contact", () => {
  const height = 170;
  assert.deepEqual(dropAt(0, height), { x: 0, y: -height });
  assert.deepEqual(dropAt(0.14, height), { x: 0, y: -height });
  close(dropAt(0.42, height).y, -127.5);
  close(dropAt(0.70, height).y, 0);
  close(dropAt(10, height).y, 0);
  const positions = [0.14, 0.28, 0.42, 0.56, 0.70].map((t) => dropAt(t, height).y);
  const travel = positions.slice(1).map((position, index) => position - positions[index]);
  for (let i = 1; i < travel.length; i += 1) assert.ok(travel[i] > travel[i - 1]);
  for (const height of [102, 170]) close(dropAt(0.42, height).y / height, -0.75);
});

test("camera hits every approved keyframe in each window size", () => {
  const keys = [[0, -24, 2], [0.14, -24, 2], [0.62, 0, 2.10], [0.84, 1, 2.12], [1.10, 1, 2.12], [1.76, 0, 1.60], [2.70, 0, 1.60], [3.6, 0, 1]];
  for (const [W, H] of [[1060, 720], [640, 480], [1920, 1080]]) {
    for (const [time, offset, zoom] of keys) {
      const camera = cameraAt(time, W, H);
      assert.equal(camera.x, W / 2);
      close(camera.y, H / 2 + offset);
      close(camera.zoom, zoom);
      assert.equal(camera.rot, 0);
    }
    assert.deepEqual(cameraAt(-1, W, H), cameraAt(0, W, H));
    assert.deepEqual(cameraAt(20, W, H), cameraAt(DURATION, W, H));
  }
});

test("camera preserves a true still welcome and ends without a residual transform", () => {
  const W = 1060, H = 720;
  const still = cameraAt(2, W, H);
  const liquid = liquidAt(2, 200, 30);
  for (let time = 2; time <= 2.70; time += 0.01) {
    assert.deepEqual(cameraAt(time, W, H), still);
    assert.deepEqual(liquidAt(time, 200, 30), liquid);
  }
  const matrix = view(cameraAt(DURATION, W, H), { W, H });
  [1, 0, 0, 1, 0, 0].forEach((expected, index) => close(matrix[index], expected));
});

test("camera midpoint follows the approved arrival curve and geometric zoom", () => {
  const camera = cameraAt(0.38, 1060, 720);
  close(camera.y, 348);
  close(camera.zoom, Math.sqrt(2 * 2.10));
  const departure = cameraAt(3.15, 1060, 720);
  close(departure.zoom, Math.sqrt(1.60));
  close(departure.y, 360);
});

test("the affine view maps the focus to center without changing logical dimensions", () => {
  for (const [W, H] of [[1060, 720], [640, 480]]) {
    for (const time of [0, 0.62, 1.3, 2.2, 3.15, DURATION]) {
      const camera = cameraAt(time, W, H);
      const [a, b, c, d, e, f] = view(camera, { W, H });
      close(a * camera.x + c * camera.y + e, W / 2);
      close(b * camera.x + d * camera.y + f, H / 2);
      close(a * d - b * c, camera.zoom ** 2);
    }
  }
});

test("wet ink spreads before letters form and keeps the final glyph footprint", () => {
  const initial = liquidAt(0.70, 200, 30);
  assert.deepEqual(initial, { spread: 0, rx: 11, ry: 4, morph: 0 });
  const wet = liquidAt(1.16, 200, 30);
  assert.ok(wet.spread > 0.98);
  assert.equal(wet.morph, 0);
  const forming = liquidAt(1.58, 200, 30);
  close(forming.morph, 0.5);
  const final = liquidAt(2, 200, 30);
  assert.equal(final.spread, 1);
  assert.equal(final.morph, 1);
  close(final.rx, 106);
  close(final.ry, 16.8);
  assert.deepEqual(liquidAt(10, 200, 30), final);
});

test("contact squash starts undeformed, expands horizontally, and settles", () => {
  assert.deepEqual(impactAt(0), { sx: 1, sy: 1 });
  assert.deepEqual(impactAt(0.70), { sx: 1, sy: 1 });
  const contact = impactAt(0.74);
  assert.ok(contact.sx > 1 && contact.sy < 1);
  const recovered = impactAt(2);
  close(recovered.sx, 1, 1e-9);
  close(recovered.sy, 1, 1e-9);
  for (let time = 0.70; time <= DURATION; time += 0.005) {
    const { sx, sy } = impactAt(time);
    assert.ok(sx >= 0.8 && sx <= 1.2 && sy >= 0.75 && sy <= 1.25);
  }
});

test("revisiting a time is deterministic and phase boundaries are continuous", () => {
  const times = [0, 0.14, 0.62, 0.70, 0.84, 1.10, 1.16, 1.30, 1.76, 2, 2.70, DURATION];
  const sample = (time) => ({ camera: cameraAt(time, 1060, 720), drop: dropAt(time, 170), liquid: liquidAt(time, 200, 30), impact: impactAt(time) });
  const before = times.map(sample);
  for (const time of [...times].reverse()) sample(time);
  assert.deepEqual(times.map(sample), before);
  for (const time of times) {
    const left = sample(time - 1e-7), right = sample(time + 1e-7);
    for (const group of ["camera", "drop", "liquid", "impact"]) {
      for (const key of Object.keys(left[group])) close(left[group][key], right[group][key], 0.0002);
    }
  }
});
