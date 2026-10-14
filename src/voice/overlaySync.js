export function connectOverlay({ listen, invoke, onState, onLevel }) {
  let disposed = false;
  let receivedState = false;
  const unlisten = [];
  const ready = Promise.all([
    listen("dictation-state", (event) => {
      receivedState = true;
      if (!disposed) onState(event.payload || {});
    }),
    listen("dictation-level", (event) => { if (!disposed) onLevel(event.payload); }),
  ].map(async (registration) => {
    const release = await registration;
    if (disposed) release();
    else unlisten.push(release);
  })).then(async () => {
    if (disposed) return;
    const snapshot = await invoke("get_overlay_state", {});
    if (!disposed && !receivedState && snapshot) onState(snapshot);
  });
  return {
    ready,
    dispose() { disposed = true; for (const release of unlisten.splice(0)) release(); },
  };
}
