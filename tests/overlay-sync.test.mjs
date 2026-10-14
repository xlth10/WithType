import assert from "node:assert/strict";
import { test } from "node:test";
import { connectOverlay } from "../src/voice/overlaySync.js";

test("HUD subscribes before recovering a state emitted while its page was loading", async () => {
  const order = [], states = [];
  const connection = connectOverlay({
    listen: async (_event, _handler) => { order.push("listen"); return () => {}; },
    invoke: async () => { order.push("snapshot"); return { state: "recording", intent: "dictation", phase: "record", countdown: 42 }; },
    onState: (state) => states.push(state),
    onLevel: () => {},
  });
  await connection.ready;
  assert.equal(order.at(-1), "snapshot");
  assert.equal(order.filter((step) => step === "listen").length, 2);
  assert.deepEqual(states, [{ state: "recording", intent: "dictation", phase: "record", countdown: 42 }]);
  connection.dispose();
});

test("a live HUD event wins over an older snapshot that arrives later", async () => {
  let update, resolveSnapshot;
  const states = [];
  const connection = connectOverlay({
    listen: async (event, handler) => { if (event === "dictation-state") update = handler; return () => {}; },
    invoke: () => new Promise((resolve) => { resolveSnapshot = resolve; }),
    onState: (state) => states.push(state.state),
    onLevel: () => {},
  });
  await new Promise((resolve) => setImmediate(resolve));
  update({ payload: { state: "processing" } });
  resolveSnapshot({ state: "recording" });
  await connection.ready;
  assert.deepEqual(states, ["processing"]);
  connection.dispose();
});

test("unmount during listener registration releases listeners and prevents late updates", async () => {
  const registrations = [], states = [], released = [];
  const connection = connectOverlay({
    listen: (event) => new Promise((resolve) => registrations.push(() => resolve(() => released.push(event)))),
    invoke: async () => { throw new Error("disposed HUD must not request a snapshot"); },
    onState: (state) => states.push(state),
    onLevel: () => {},
  });
  connection.dispose();
  for (const register of registrations) register();
  await connection.ready;
  assert.deepEqual(states, []);
  assert.deepEqual(released.sort(), ["dictation-level", "dictation-state"]);
});
