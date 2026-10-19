import { DURATION, clamp } from "./inkWelcomeMotion.js";

/** Drive a deterministic renderer from elapsed wall time, with interruptible playback. */
export function createInkWelcomePlayer({
  renderer,
  requestFrame = callback => globalThis.requestAnimationFrame(callback),
  cancelFrame = id => globalThis.cancelAnimationFrame(id),
  now = () => performance.now(),
  reducedMotion = () => false,
  onFinish = () => {},
}) {
  let frameId = null;
  let generation = 0;
  let playing = false;
  let disposed = false;
  let startedAt = 0;

  const stop = () => {
    generation += 1;
    playing = false;
    if (frameId !== null) cancelFrame(frameId);
    frameId = null;
  };

  const finish = () => {
    if (disposed) return;
    const elapsedMs = playing ? Math.max(0, now() - startedAt) : 0;
    stop();
    renderer.seek(DURATION);
    onFinish(elapsedMs);
  };

  const play = () => {
    if (disposed) return;
    stop();
    if (reducedMotion()) {
      finish();
      return;
    }
    startedAt = now();
    playing = true;
    const token = generation;
    renderer.seek(0);
    const tick = () => {
      if (disposed || !playing || token !== generation) return;
      frameId = null;
      const elapsed = Math.max(0, now() - startedAt) / 1000;
      if (elapsed >= DURATION) {
        finish();
        return;
      }
      renderer.seek(clamp(elapsed, 0, DURATION));
      if (!disposed && playing && token === generation) frameId = requestFrame(tick);
    };
    if (!disposed && playing && token === generation) frameId = requestFrame(tick);
  };

  return {
    play,
    seek(time) {
      if (disposed) return;
      stop();
      renderer.seek(clamp(time, 0, DURATION));
    },
    finish,
    isPlaying: () => playing,
    dispose() {
      if (disposed) return;
      stop();
      disposed = true;
    },
  };
}
