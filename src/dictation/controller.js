// Readiness/command transport for the native supervisor. It owns no recording or UI state.
export function createVoiceController({ invoke, listen, onStatus = () => {}, onAction = () => {}, onInterrupt = () => {}, onError = () => {} }) {
  let disposed = false, resourcesReady = false, subscribed = false, ready = false, generation = null;
  let allowReady = true, phase = "starting", registering = false;
  const subscriptions = [], tasks = new Map();
  let initialization;

  async function announce() {
    if (disposed || !subscribed || !resourcesReady || !allowReady || registering || ready || generation === null) return;
    const token = generation;
    registering = true;
    try {
      const status = await invoke("voice_controller_ready", { generation: token });
      if (!disposed && token === generation && allowReady) { ready = true; phase = "ready"; onStatus(status); }
    } catch (error) { if (!disposed && token === generation && allowReady) onError(error); }
    finally {
      registering = false;
      if (!disposed && token !== generation) void announce();
    }
  }
  function apply(status, reset = false) {
    if (disposed || !status || (generation !== null && status.generation < generation)) return;
    if (reset) {
      ready = false;
      tasks.clear();
      onInterrupt(status);
    }
    generation = status.generation;
    phase = status.phase;
    allowReady = !["suspended", "failed", "stopped"].includes(phase) && (!reset || phase !== "recovering");
    onStatus(status);
    void announce();
  }
  async function handleAction({ payload }) {
    if (disposed || !ready || payload?.generation !== generation) return;
    const token = generation;
    try {
      const accepted = await invoke("claim_voice_action", { generation: token, id: payload.id });
      if (accepted && !disposed && ready && token === generation) await onAction(payload);
    } catch (error) { if (!disposed) onError(error); }
  }
  async function start() {
    try {
      // All listeners must be installed before the backend can deliver an action.
      const handlers = [
        ["voice-action", handleAction],
        ["voice-controller-reset", ({ payload }) => apply(payload, true)],
        ["voice-controller-ping", async ({ payload }) => {
          if (disposed) return;
          if (generation !== null && payload > generation) apply(await invoke("get_voice_controller", {}), true);
          if (!disposed && payload === generation) await invoke("voice_controller_pong", { generation });
        }],
        ["voice-controller-status", ({ payload }) => {
          if (disposed || generation !== payload?.generation) return;
          // Recovery itself may already have published before its reset event arrives.
          if (["suspended", "failed", "stopped", "recovering"].includes(payload.phase)) { ready = false; allowReady = false; }
          if (payload.phase === "ready" && resourcesReady && subscribed && allowReady) ready = true;
          phase = payload.phase;
          onStatus(payload);
        }],
      ];
      await Promise.all(handlers.map(async ([event, handler]) => {
        const off = await listen(event, (data) => Promise.resolve(handler(data)).catch((error) => { if (!disposed) onError(error); }));
        if (disposed) off(); else subscriptions.push(off);
      }));
      if (disposed) return;
      subscribed = true;
      apply(await invoke("get_voice_controller", {}));
      await announce();
    } catch (error) { if (!disposed) onError(error); }
  }
  return {
    start() { return initialization ||= start(); },
    setResourcesReady(value) { resourcesReady = value; if (value) void announce(); },
    async trackTask(taskId) {
      await initialization;
      if (disposed || !ready) throw new Error("语音输入正在准备或恢复，请稍后重试");
      const token = generation;
      await invoke("track_voice_task", { generation: token, taskId });
      if (disposed || !ready || token !== generation) throw new Error("语音任务已中断");
      tasks.set(taskId, token);
    },
    async finishTask(taskId) {
      const token = tasks.get(taskId);
      tasks.delete(taskId);
      if (token !== undefined) await invoke("finish_voice_task", { generation: token, taskId });
    },
    async withDialog(callback) {
      await initialization;
      if (disposed || !ready) throw new Error("语音输入尚未就绪，请稍后重试");
      const token = generation;
      await invoke("voice_controller_dialog", { generation: token, active: true });
      try { return !disposed && ready && token === generation ? callback() : false; }
      finally { await invoke("voice_controller_dialog", { generation: token, active: false }).catch(() => {}); }
    },
    async fail(message) {
      await initialization;
      if (disposed) return;
      const status = generation === null ? await invoke("get_voice_controller", {}) : { generation };
      if (!disposed) await invoke("voice_controller_unavailable", { generation: status.generation, message });
    },
    dispose() { disposed = true; ready = false; subscriptions.splice(0).forEach((off) => off()); },
  };
}
