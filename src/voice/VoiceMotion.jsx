import { useEffect, useRef } from "react";
import { advanceEngine, createEngine, inkBeads } from "./motion.js";

export function VoiceMotion({ state, level }) {
  const canvasRef = useRef(null);
  const input = useRef({ mode: state, level });
  input.current = { mode: state, level };
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    const engine = createEngine();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame, previous;
    const draw = (now) => {
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(148 * dpr) || canvas.height !== Math.round(32 * dpr)) {
        canvas.width = Math.round(148 * dpr);
        canvas.height = Math.round(32 * dpr);
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, 148, 32);
      advanceEngine(engine, input.current, previous === undefined ? 0 : (now - previous) / 1000, reduced.matches);
      previous = now;
      if (input.current.mode !== "error") {
        for (const shape of inkBeads(engine)) {
          context.beginPath();
          context.ellipse(shape.cx, shape.cy, shape.rx, shape.ry, 0, 0, Math.PI * 2);
          context.fillStyle = shape.fill;
          context.fill();
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);
  return <canvas className="voice-motion" ref={canvasRef} aria-hidden="true" />;
}
