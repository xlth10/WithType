import { useEffect, useRef } from "react";
import { advanceEngine, createEngine, hudBeads, inkBeads } from "./motion.js";

/** The same ink geometry at every size, redrawn at the current display DPR. */
export function VoiceMotion({ state, level, width = 60, height = 20, feedback = false }) {
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
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      }
      context.setTransform(dpr * width / 60, 0, 0, dpr * height / 20, 0, 0);
      context.clearRect(0, 0, 60, 20);
      advanceEngine(engine, input.current, previous === undefined ? 0 : (now - previous) / 1000, reduced.matches);
      previous = now;
      const shapes = feedback ? hudBeads(engine) : ["error", "done"].includes(input.current.mode) ? [] : inkBeads(engine);
      for (const shape of shapes) {
        context.beginPath();
        if (shape.type === "half-disc") {
          const start = shape.side < 0 ? Math.PI / 2 : -Math.PI / 2;
          context.arc(shape.cx, shape.cy, shape.rx, start, start + Math.PI);
          context.closePath();
        } else {
          context.ellipse(shape.cx, shape.cy, shape.rx, shape.ry, 0, 0, Math.PI * 2);
        }
        if (shape.fill) { context.fillStyle = shape.fill; context.fill(); }
        if (shape.stroke) { context.strokeStyle = shape.stroke; context.lineWidth = shape.lineWidth; context.stroke(); }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [width, height, feedback]);
  return <canvas className="voice-motion" ref={canvasRef} style={{ width, height }} aria-hidden="true" />;
}
