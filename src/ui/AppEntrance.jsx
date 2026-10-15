import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { BRAND } from "./brand.js";
import { normalizeWelcomeText } from "./welcome.js";
import { createInkWelcome, DURATION } from "./inkWelcome.js";
import { createInkWelcomePlayer } from "./inkWelcomePlayer.js";
import "./ink-welcome.css";

function previewMode() {
  if (!import.meta.env.DEV || window.__TAURI_INTERNALS__) return {};
  const value = new URLSearchParams(location.search).get("opening");
  if (value === "reduced") return { reduced: true };
  return value !== null && /^\d+$/.test(value) ? { frame: Math.min(DURATION, Number(value) / 1000) } : {};
}

/** The approved paper/ink renderer, with desktop lifecycle and saved greeting readiness. */
export function AppEntrance({ children, welcomeText = BRAND.welcome, ready = true, replayToken = 0, disabled = false }) {
  const worldRef = useRef(null), uiRef = useRef(null), paperRef = useRef(null), inkRef = useRef(null), fibersRef = useRef(null);
  const runtimeRef = useRef(null);
  const preferences = useRef(null);
  preferences.current = { ready, disabled, welcomeText: normalizeWelcomeText(welcomeText), replayToken };
  const mode = useRef(previewMode()).current;

  useEffect(() => {
    const world = worldRef.current, ui = uiRef.current;
    const renderer = createInkWelcome({ world, ui, paper: paperRef.current, ink: inkRef.current, fibers: fibersRef.current });
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let disposed = false, fontsReady = false, initialized = false, skipped = false, queuedReplay = false;
    let lastReplay = preferences.current.replayToken, stopNativeListener;
    const player = createInkWelcomePlayer({
      renderer,
      reducedMotion: () => mode.reduced || reduced.matches,
      onFinish: (elapsed) => { world.dataset.playbackMs = elapsed.toFixed(1); },
    });
    const finish = () => { skipped = true; queuedReplay = false; player.finish(); };
    const prepare = () => {
      renderer.prepare(preferences.current.welcomeText);
      world.dataset.ready = "true";
    };
    const replay = () => {
      if (disposed || preferences.current.disabled) return;
      if (!fontsReady || !preferences.current.ready) { queuedReplay = true; return; }
      skipped = false; prepare(); initialized = true; player.play();
    };
    const synchronize = () => {
      if (disposed) return;
      if (preferences.current.disabled) { finish(); return; }
      const requested = lastReplay !== preferences.current.replayToken;
      lastReplay = preferences.current.replayToken;
      if (!fontsReady || !preferences.current.ready) { queuedReplay ||= requested; return; }
      if (!initialized) {
        initialized = true; prepare();
        if (skipped || mode.reduced || reduced.matches) player.finish();
        else if (mode.frame !== undefined && !requested && !queuedReplay) player.seek(mode.frame);
        else player.play();
        queuedReplay = false;
      } else if (requested || queuedReplay) {
        queuedReplay = false; replay();
      }
    };
    const pointer = () => { if (world.dataset.finished !== "true") finish(); };
    const keyboard = (event) => {
      if (world.dataset.finished === "true") return;
      finish();
      if (event.key === "Tab") { event.preventDefault(); ui.querySelector("button")?.focus(); }
    };
    const visibility = () => { if (document.hidden && player.isPlaying()) finish(); };
    const preferenceChanged = () => { if (reduced.matches) finish(); };
    const resize = () => {
      if (!initialized) return;
      const previous = renderer.snapshot();
      if (previous.width === world.clientWidth && previous.height === world.clientHeight) return;
      const time = previous.time;
      prepare();
      if (player.isPlaying()) finish(); else renderer.seek(time);
    };
    runtimeRef.current = { synchronize };
    window.addEventListener("pointerdown", pointer, true);
    window.addEventListener("keydown", keyboard, true);
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", visibility);
    reduced.addEventListener("change", preferenceChanged);
    if (mode.reduced || reduced.matches) finish();
    document.fonts.load('420 30px "Typefree UI"').then(() => document.fonts.ready).then(() => {
      if (disposed) return;
      world.dataset.fontStatus = document.fonts.check('420 30px "Typefree UI"') ? "bundled" : "fallback";
      fontsReady = true; synchronize();
    }).catch(() => {
      if (disposed) return;
      world.dataset.fontStatus = "fallback"; fontsReady = true; synchronize();
    });
    if (window.__TAURI_INTERNALS__) {
      listen("main-window-opening", replay).then((off) => {
        if (disposed) off(); else stopNativeListener = off;
      }).catch(() => {});
    }
    return () => {
      disposed = true; runtimeRef.current = null;
      window.removeEventListener("pointerdown", pointer, true);
      window.removeEventListener("keydown", keyboard, true);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", visibility);
      reduced.removeEventListener("change", preferenceChanged);
      stopNativeListener?.(); player.dispose(); renderer.destroy();
    };
  }, [mode]);

  useEffect(() => { runtimeRef.current?.synchronize(); }, [ready, welcomeText, replayToken, disabled]);

  return <div className="ink-entry-shell">
    <div className="ink-entry-world" ref={worldRef} data-finished="false">
      <div className="ink-entry-ui" ref={uiRef} inert>{children}</div>
      <div className="ink-entry-paper" ref={paperRef} aria-hidden="true"><canvas ref={fibersRef} /></div>
      <canvas className="ink-entry-ink" ref={inkRef} aria-hidden="true" />
    </div>
  </div>;
}
