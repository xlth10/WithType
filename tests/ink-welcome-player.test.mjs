import assert from "node:assert/strict";
import { test } from "node:test";
import { DURATION } from "../src/ui/inkWelcomeMotion.js";
import { createInkWelcomePlayer } from "../src/ui/inkWelcomePlayer.js";

function fixture({ reduced = false, startTime = 1000 } = {}) {
  let time = startTime;
  let nextId = 0;
  let reduce = reduced;
  const pending = new Map();
  const callbacks = new Map();
  const cancelled = [];
  const rendered = [];
  const finished = [];
  const player = createInkWelcomePlayer({
    renderer: { seek: (value) => rendered.push(value) },
    requestFrame(callback) {
      const id = nextId++;
      pending.set(id, callback);
      callbacks.set(id, callback);
      return id;
    },
    cancelFrame(id) { cancelled.push(id); pending.delete(id); },
    now: () => time,
    reducedMotion: () => reduce,
    onFinish: (elapsedMs) => finished.push(elapsedMs),
  });
  return {
    player, rendered, finished, pending, cancelled,
    setTime(value) { time = value; },
    setReduced(value) { reduce = value; },
    step(value) {
      time = value;
      const jobs = Array.from(pending);
      pending.clear();
      for (const [, callback] of jobs) callback();
    },
    late(id) { callbacks.get(id)(); },
  };
}

test("play uses absolute elapsed time through the final frame and reports actual duration", () => {
  const f = fixture();
  assert.equal(f.player.isPlaying(), false);
  f.player.play();
  assert.deepEqual(f.rendered, [0]);
  assert.equal(f.player.isPlaying(), true);
  f.step(1100);
  f.step(2400);
  assert.deepEqual(f.rendered, [0, .1, 1.4]);
  // A delayed frame ends the 3.6-second animation without accumulating frame deltas.
  f.step(4875);
  assert.equal(f.rendered.at(-1), DURATION);
  assert.deepEqual(f.finished, [3875]);
  assert.equal(f.player.isPlaying(), false);
  assert.equal(f.pending.size, 0);
});

test("replay cancels the prior frame, starts at zero and uses a new clock origin", () => {
  const f = fixture();
  f.player.play();
  f.step(1500);
  const oldFrame = [...f.pending.keys()][0];
  f.setTime(1700);
  f.player.play();
  assert.ok(f.cancelled.includes(oldFrame));
  assert.equal(f.rendered.at(-1), 0);
  const beforeLate = f.rendered.length;
  f.late(oldFrame);
  assert.equal(f.rendered.length, beforeLate);
  assert.equal(f.pending.size, 1);
  f.step(2000);
  assert.equal(f.rendered.at(-1), .3);
  f.step(5300);
  assert.deepEqual(f.finished, [3600]);
});

test("finish skips playback, reports its real elapsed time and ignores its late frame", () => {
  const f = fixture();
  f.player.play();
  const frame = [...f.pending.keys()][0];
  f.setTime(1450);
  f.player.finish();
  assert.deepEqual(f.rendered, [0, DURATION]);
  assert.deepEqual(f.finished, [450]);
  assert.equal(f.player.isPlaying(), false);
  assert.deepEqual(f.cancelled, [frame]);
  f.late(frame);
  assert.deepEqual(f.rendered, [0, DURATION]);
  assert.equal(f.pending.size, 0);
  f.player.finish();
  assert.deepEqual(f.finished, [450, 0]);
});

test("reduced motion renders the final state immediately without requesting a frame", () => {
  const f = fixture({ reduced: true });
  f.player.play();
  assert.deepEqual(f.rendered, [DURATION]);
  assert.deepEqual(f.finished, [0]);
  assert.equal(f.pending.size, 0);
  assert.equal(f.player.isPlaying(), false);
  f.setReduced(false);
  f.player.play();
  assert.equal(f.rendered.at(-1), 0);
  assert.equal(f.player.isPlaying(), true);
  f.setReduced(true);
  f.player.play();
  assert.equal(f.rendered.at(-1), DURATION);
  assert.equal(f.pending.size, 0);
  assert.deepEqual(f.finished, [0, 0]);
});

test("seek freezes a clamped frame without completion or a pending animation", () => {
  const f = fixture();
  f.player.play();
  const frame = [...f.pending.keys()][0];
  f.player.seek(1.3);
  assert.equal(f.rendered.at(-1), 1.3);
  assert.equal(f.player.isPlaying(), false);
  assert.equal(f.pending.size, 0);
  f.late(frame);
  assert.equal(f.rendered.at(-1), 1.3);
  f.player.seek(-2);
  assert.equal(f.rendered.at(-1), 0);
  f.player.seek(DURATION + 5);
  assert.equal(f.rendered.at(-1), DURATION);
  assert.deepEqual(f.finished, []);
  f.setTime(9000);
  f.player.play();
  assert.equal(f.rendered.at(-1), 0);
  f.step(9300);
  assert.equal(f.rendered.at(-1), .3);
});

test("dispose only cancels and cannot be revived by late frames or later API calls", () => {
  const f = fixture();
  f.player.play();
  const frame = [...f.pending.keys()][0];
  f.player.dispose();
  f.player.dispose();
  f.late(frame);
  f.player.play();
  f.player.seek(2);
  f.player.finish();
  assert.deepEqual(f.cancelled, [frame]);
  assert.deepEqual(f.rendered, [0]);
  assert.deepEqual(f.finished, []);
  assert.equal(f.player.isPlaying(), false);
  assert.equal(f.pending.size, 0);
});

test("a backwards test clock never produces a negative animation time or elapsed report", () => {
  const f = fixture();
  f.player.play();
  f.step(900);
  assert.equal(f.rendered.at(-1), 0);
  f.player.finish();
  assert.deepEqual(f.finished, [0]);
});
