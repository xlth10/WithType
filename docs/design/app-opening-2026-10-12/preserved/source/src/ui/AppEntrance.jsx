import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { BRAND } from "./brand.js";

const DURATION_MS = 1400;

// A development-only freeze frame for reviewing the same production keyframes.
function previewFrame() {
  if (!import.meta.env.DEV || window.__TAURI_INTERNALS__) return null;
  const value = new URLSearchParams(window.location.search).get("opening");
  if (value === null || !/^\d+$/.test(value)) return null;
  return Math.min(DURATION_MS, Number(value));
}

/** Paper opens around the ink; input and app hydration remain independent. */
export function AppEntrance({ children }) {
  const frame = useRef(previewFrame()).current;
  const reducedPreview = useRef(import.meta.env.DEV && !window.__TAURI_INTERNALS__ && new URLSearchParams(window.location.search).get("opening") === "reduced").current;
  const [opening, setOpening] = useState(() => !reducedPreview && !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const playing = useRef(opening);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let disposed = false;
    let timer;
    const finish = () => {
      clearTimeout(timer);
      playing.current = false;
      if (!disposed) setOpening(false);
    };
    const play = () => {
      if (disposed || reducedPreview || reduced.matches || playing.current || frame !== null) return;
      playing.current = true;
      setOpening(true);
      timer = setTimeout(finish, DURATION_MS);
    };
    if (playing.current && frame === null) timer = setTimeout(finish, DURATION_MS);

    const preferenceChanged = () => { if (reduced.matches) finish(); };
    const visibilityChanged = () => { if (document.hidden) finish(); };
    window.addEventListener("pointerdown", finish, true);
    window.addEventListener("keydown", finish, true);
    document.addEventListener("visibilitychange", visibilityChanged);
    reduced.addEventListener("change", preferenceChanged);
    const listening = window.__TAURI_INTERNALS__ ? listen("main-window-opening", play) : null;

    return () => {
      disposed = true;
      clearTimeout(timer);
      window.removeEventListener("pointerdown", finish, true);
      window.removeEventListener("keydown", finish, true);
      document.removeEventListener("visibilitychange", visibilityChanged);
      reduced.removeEventListener("change", preferenceChanged);
      if (listening) listening.then((off) => off()).catch(() => {});
    };
  }, [frame, reducedPreview]);

  return <div
    className={`app-entry${opening ? " is-entering" : ""}${opening && frame !== null ? " is-preview-frame" : ""}`}
    style={{ "--entry-duration": `${DURATION_MS}ms`, ...(frame === null ? {} : { "--entry-frame-delay": `${-frame}ms` }) }}
  >
    {children}
    {opening && <div className="entry-art" aria-hidden="true">
      <div className="entry-paper">
        <div className="entry-paper-wing entry-paper-left" />
        <div className="entry-paper-wing entry-paper-right" />
        <svg className="entry-paper-grain" width="100%" height="100%" focusable="false">
          <defs><pattern id="entry-fibers" width="72" height="72" patternUnits="userSpaceOnUse">
            <g stroke="#9a998b" strokeWidth=".65" fill="none">
              <path d="M6 12q8-3 14-2M44 8l9 2M26 31q7 3 14 1M55 42l8-3M9 57l11 3M37 65q7-2 12-1" />
              <path d="M15 26l2 5M49 52l3 6M62 19l-1 4" strokeWidth=".4" />
            </g>
            <g fill="#b1ad98"><circle cx="8" cy="36" r=".6" /><circle cx="33" cy="16" r=".4" /><circle cx="65" cy="59" r=".5" /></g>
          </pattern></defs>
          <rect width="100%" height="100%" fill="url(#entry-fibers)" />
        </svg>
        <div className="entry-paper-seam" />
      </div>
      <div className="entry-mark">
        <svg viewBox="0 0 240 156" width="240" height="156" focusable="false">
          <defs>
            <radialGradient id="entry-wet-ink"><stop stopColor="#57594d" stopOpacity=".2" /><stop offset=".45" stopColor="#67685b" stopOpacity=".08" /><stop offset="1" stopColor="#67685b" stopOpacity="0" /></radialGradient>
            <filter id="entry-soft-ink" x="-50%" y="-100%" width="200%" height="300%"><feGaussianBlur stdDeviation="1.4" /></filter>
          </defs>
          <g className="entry-bloom entry-bloom-first"><ellipse cx="120" cy="94" rx="42" ry="13" fill="url(#entry-wet-ink)" /><path d="M101 93q9-5 19-4q13-1 21 5q-7 6-21 4q-12 3-19-5" fill="#515447" opacity=".07" filter="url(#entry-soft-ink)" /></g>
          <g className="entry-bloom entry-bloom-second"><ellipse cx="120" cy="94" rx="57" ry="15" fill="url(#entry-wet-ink)" /></g>
          <path className="entry-paper-wave" d="M12 96Q65 85 120 94Q175 85 228 96" fill="none" stroke="#929383" strokeWidth=".8" />
          <ellipse className="entry-shadow entry-shadow-main" cx="120" cy="95" rx="21" ry="3" fill="currentColor" />
          <ellipse className="entry-shadow entry-shadow-side" cx="82" cy="97" rx="10" ry="1.7" fill="currentColor" />
          <ellipse className="entry-shadow entry-shadow-side" cx="158" cy="97" rx="10" ry="1.7" fill="currentColor" />
          <path className="entry-ink-tether" d="M115 92Q117 75 120 67Q123 75 125 92Q120 88 115 92" fill="currentColor" />
          <circle className="entry-bead entry-bead-outer entry-bead-left" cx="54" cy="93" r="2.8" fill="currentColor" />
          <circle className="entry-bead entry-bead-side entry-bead-left" cx="82" cy="88" r="7" fill="currentColor" />
          <circle className="entry-bead entry-bead-main" cx="120" cy="82" r="12" fill="currentColor" />
          <circle className="entry-bead entry-bead-side entry-bead-right" cx="158" cy="88" r="7" fill="currentColor" />
          <circle className="entry-bead entry-bead-outer entry-bead-right" cx="186" cy="93" r="2.8" fill="currentColor" />
        </svg>
      </div>
      <p className="entry-welcome" lang="en">{BRAND.welcome}</p>
    </div>}
  </div>;
}
