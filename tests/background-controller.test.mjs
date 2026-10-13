import test from "node:test";
import assert from "node:assert/strict";
import { createVoiceController } from "../src/dictation/controller.js";
import { createPipeline } from "../src/dictation/pipeline.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture(overrides = {}) {
  const listeners = new Map(), calls = [], actions = [], interruptions = [], errors = [];
  let status = { generation: 1, phase: "starting", message: "" };
  const controller = createVoiceController({
    invoke: async (name, args) => {
      calls.push({ name, args });
      if (overrides[name]) return overrides[name](args);
      if (name === "get_voice_controller") return status;
      if (name === "voice_controller_ready") return { ...status, phase: "ready" };
      if (name === "claim_voice_action") return true;
    },
    listen: async (name, callback) => { listeners.set(name, callback); return () => listeners.delete(name); },
    onAction: (action) => actions.push(action), onInterrupt: (state) => interruptions.push(state),
    onError: (error) => errors.push(error),
  });
  return { controller, calls, actions, interruptions, errors, listeners,
    async emit(name, payload) { await listeners.get(name)?.({ payload }); },
    setStatus(next) { status = next; },
    async ready() { controller.setResourcesReady(true); await controller.start(); await tick(); },
  };
}

test("controller waits for subscriptions and all resources before announcing readiness", async () => {
  const f = fixture(); await f.controller.start();
  assert.equal(f.listeners.size, 4);
  assert.equal(f.calls.some((call) => call.name === "voice_controller_ready"), false);
  await assert.rejects(f.controller.trackTask("task-a"), /准备/);
  f.controller.setResourcesReady(true); await tick();
  await f.controller.trackTask("task-a");
  assert.equal(f.calls.filter((call) => call.name === "voice_controller_ready").length, 1);
  f.controller.dispose(); assert.equal(f.listeners.size, 0);
});

test("an action is executed only after native claim, and denied claims have no effect", async () => {
  const claim = deferred(); const f = fixture({ claim_voice_action: () => claim.promise }); await f.ready();
  const pending = f.emit("voice-action", { generation: 1, id: 7, action: "toggle-dictation" });
  assert.equal(f.actions.length, 0); claim.resolve(false); await pending; assert.equal(f.actions.length, 0);
});

test("reset during a delayed claim invalidates that command without replay", async () => {
  const claim = deferred(); const f = fixture({ claim_voice_action: () => claim.promise }); await f.ready();
  const pending = f.emit("voice-action", { generation: 1, id: 7, action: "insert-result", text: "旧结果" });
  await f.emit("voice-controller-reset", { generation: 2, phase: "recovering" });
  claim.resolve(true); await pending;
  assert.equal(f.actions.length, 0); assert.equal(f.interruptions.length, 1);
  assert.equal(f.calls.filter((call) => call.name === "voice_controller_ready").length, 1, "old document must await reload");
});

test("sleep pauses the controller and a responsive document can rebind after unlock", async () => {
  const f = fixture(); await f.ready();
  await f.emit("voice-controller-reset", { generation: 2, phase: "suspended" });
  await assert.rejects(f.controller.trackTask("late"), /准备/);
  f.setStatus({ generation: 3, phase: "starting" });
  await f.emit("voice-controller-reset", { generation: 3, phase: "starting" }); await tick();
  await f.controller.trackTask("fresh");
  assert.equal(f.calls.at(-1).args.generation, 3);
  await f.emit("voice-action", { generation: 1, id: 1, action: "toggle-dictation" });
  assert.equal(f.actions.length, 0);
});

test("a late boot snapshot cannot roll back a received generation", async () => {
  const boot = deferred(); const f = fixture({ get_voice_controller: () => boot.promise });
  const started = f.controller.start(); await tick();
  await f.emit("voice-controller-reset", { generation: 3, phase: "suspended" });
  boot.resolve({ generation: 1, phase: "starting" }); await started;
  f.controller.setResourcesReady(true); await tick();
  assert.equal(f.calls.some((call) => call.name === "voice_controller_ready"), false);
  await f.emit("voice-controller-ping", 3);
  assert.equal(f.calls.at(-1).args.generation, 3);
});

test("disposing during subscription installation cleans up every late listener", async () => {
  const listener = deferred(); let cleaned = 0;
  const controller = createVoiceController({ invoke: async () => ({ generation: 1, phase: "starting" }),
    listen: async () => { await listener.promise; return () => cleaned++; } });
  const started = controller.start(); controller.dispose(); listener.resolve(); await started;
  assert.equal(cleaned, 4);
});

test("blocking confirmation holds supervision and always releases it when the callback fails", async () => {
  const f = fixture(); await f.ready();
  await assert.rejects(f.controller.withDialog(() => { throw new Error("dialog failed"); }), /dialog failed/);
  assert.deepEqual(f.calls.filter((call) => call.name === "voice_controller_dialog").map((call) => call.args), [
    { generation: 1, active: true }, { generation: 1, active: false },
  ]);
});

test("cancel while task registration is pending releases the lease without ASR or delivery", async () => {
  const lease = deferred(), calls = [], finished = [];
  const p = createPipeline({ invoke: async (name) => { calls.push(name); }, onTaskStart: () => lease.promise, onTaskEnd: (id) => finished.push(id) });
  const snapshot = p.begin({ intent: "dictation", settings: {} });
  const result = p.complete({ snapshot, audio: {} });
  p.cancel({ preserveAudio: true }); lease.resolve();
  assert.equal((await result).stale, true); await tick();
  assert.deepEqual(finished, [snapshot.requestId]);
  assert.equal(calls.includes("transcribe_audio"), false); assert.equal(calls.includes("paste_text"), false);
  assert.equal(calls.includes("cancel_audio_session"), false, "recovery must retain native audio");
});

test("failed native registration clears the current retry so another task can start", async () => {
  const p = createPipeline({ invoke: async () => {}, onTaskStart: async () => { throw new Error("恢复中"); } });
  await assert.rejects(p.retryAudio({ audioSessionId: "saved-a", intent: "dictation", settings: {} }), /恢复中/);
  assert.equal(p.current(), null);
});

test("lifecycle interruption invalidates a skill preview that was already in flight", async () => {
  const response = deferred(), started = deferred(), finished = [], calls = [];
  const p = createPipeline({
    invoke: async (name, args) => {
      calls.push({ name, args });
      if (name === "process_text") { started.resolve(); return response.promise; }
    },
    onTaskEnd: (id) => finished.push(id),
  });
  const pending = p.preview({ settings: { textEndpoint: "https://example.test/v1", textModel: "model" },
    skill: { id: "test", instruction: "整理", outputFormat: "plain" }, rawText: "测试" });
  await started.promise;
  p.cancel({ preserveAudio: true }); response.resolve({ text: "过期结果" });
  assert.equal((await pending).stale, true); await tick();
  assert.equal(finished.length, 1);
  assert.ok(calls.some((call) => call.name === "cancel_text_request"));
  assert.equal(calls.some((call) => call.name === "copy_text" || call.name === "paste_text"), false);
});
