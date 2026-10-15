import assert from "node:assert/strict";
import { test } from "node:test";
import { inkArrival } from "../src/ui/inkArrival.js";

test("a fixed paper sheet has finite, reproducible arrival times and an already-wet contact footprint", () => {
  const sample = () => inkArrival(65, 65, 32, 32, (x, y) => 1 + .2 * Math.sin(x / 7) * Math.cos(y / 5));
  const field = sample();
  assert.deepEqual(field, sample());
  assert.ok(field.every((value) => Number.isFinite(value) && value >= 0));
  assert.equal(field[32 * 65 + 32], 0);
  assert.equal(field[32 * 65 + 40], 0);
  assert.ok(field[0] > 0);
});

test("paper fibers carry ink outward while the contact footprint stays fixed", () => {
  const field = inkArrival(81, 81, 40, 40, () => 1);
  assert.ok(field[40 * 81 + 70] < field[70 * 81 + 40]);
  assert.ok(field[40 * 81 + 60] < field[40 * 81 + 70]);
  assert.ok(field[60 * 81 + 40] < field[70 * 81 + 40]);
  const early = new Set(Array.from(field, (cost, id) => cost <= 5 ? id : -1).filter((id) => id >= 0));
  const later = new Set(Array.from(field, (cost, id) => cost <= 10 ? id : -1).filter((id) => id >= 0));
  assert.ok(later.size > early.size);
  assert.ok([...early].every((id) => later.has(id)));
});

test("less absorbent paper delays the wet front without moving the source", () => {
  const fast = inkArrival(65, 65, 32, 32, () => 1);
  const slow = inkArrival(65, 65, 32, 32, (x) => x > 10 ? .35 : 1);
  assert.equal(fast[32 * 65 + 32], slow[32 * 65 + 32]);
  assert.ok(slow[32 * 65 + 60] > fast[32 * 65 + 60]);
  assert.equal(slow[32 * 65 + 4], fast[32 * 65 + 4]);
});
