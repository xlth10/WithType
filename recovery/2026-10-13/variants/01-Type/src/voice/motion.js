// D「墨珠」动效来自 vibevoice-windows/prototype/voice-motion/motion-core.mjs。
// 仅保留生产使用的电平引擎和墨珠几何；参见 THIRD_PARTY_NOTICES.md。
const PAPER = "#fbfbfa";
const INK = "#41433f";
const SOFT_INK = "#777a74";
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

function mixColor(from, to, amount) {
  const t = clamp(amount);
  const a = [1, 3, 5].map((index) => parseInt(from.slice(index, index + 2), 16));
  const b = [1, 3, 5].map((index) => parseInt(to.slice(index, index + 2), 16));
  return `#${a.map((value, index) => Math.round(value + (b[index] - value) * t).toString(16).padStart(2, "0")).join("")}`;
}

export function createEngine() {
  return {
    energy: 0, energyVelocity: 0, processing: 0, processingVelocity: 0, done: 0, doneVelocity: 0,
    error: 0, errorVelocity: 0, reducedMotion: false,
    phase: 0, mode: "idle", sampleClock: 0, sampleTargets: [0, 0, 0],
    sampleValues: [0, 0, 0], sampleVelocities: [0, 0, 0],
  };
}

function spring(engine, valueKey, velocityKey, target, response, dt) {
  // Critically damped spring: every new input retargets from the visible value
  // and keeps its current velocity rather than restarting a keyframe.
  const omega = (2 * Math.PI) / response;
  engine[velocityKey] += (omega * omega * (target - engine[valueKey]) - 2 * omega * engine[velocityKey]) * dt;
  engine[valueKey] += engine[velocityKey] * dt;
  engine[valueKey] = clamp(engine[valueKey]);
}

function springSample(engine, index, target, dt) {
  const response = target > engine.sampleValues[index] ? 0.1 : 0.2;
  const omega = (2 * Math.PI) / response;
  engine.sampleVelocities[index] += (omega * omega * (target - engine.sampleValues[index]) - 2 * omega * engine.sampleVelocities[index]) * dt;
  engine.sampleValues[index] = clamp(engine.sampleValues[index] + engine.sampleVelocities[index] * dt);
}

export function advanceEngine(engine, input, elapsed, reducedMotion = false) {
  const dt = clamp(elapsed, 0, 0.1);
  const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
  const step = dt / steps;
  if (engine.mode !== "recording" && input.mode === "recording") engine.sampleClock = 0.055;
  engine.mode = input.mode;
  engine.reducedMotion = reducedMotion;
  for (let index = 0; index < steps; index += 1) {
    const energyTarget = input.mode === "recording" ? clamp(input.level) : 0;
    spring(engine, "energy", "energyVelocity", energyTarget, energyTarget > engine.energy ? 0.16 : 0.31, step);
    spring(engine, "processing", "processingVelocity", input.mode === "processing" ? 1 : 0, 0.33, step);
    spring(engine, "done", "doneVelocity", input.mode === "done" ? 1 : 0, 0.25, step);
    spring(engine, "error", "errorVelocity", input.mode === "error" ? 1 : 0, 0.22, step);
    if (input.mode === "recording") {
      // A visual sample is a short-time energy window, never an individual PCM sample.
      engine.sampleClock += step;
      if (engine.sampleClock >= 0.055) {
        engine.sampleClock -= 0.055;
        // A soft gate holds back room noise, then a compressed curve gives
        // quiet speech useful visual range without making loud speech enormous.
        const onset = clamp((energyTarget - 0.025) / 0.045);
        const gate = onset * onset * (3 - 2 * onset);
        const sample = gate * Math.sqrt(clamp((energyTarget - 0.025) / 0.65));
        engine.sampleTargets = [sample, engine.sampleTargets[0], engine.sampleTargets[1]];
      }
    } else {
      engine.sampleClock = 0;
      engine.sampleTargets = [0, 0, 0];
    }
    for (let sampleIndex = 0; sampleIndex < 3; sampleIndex += 1) {
      springSample(engine, sampleIndex, engine.sampleTargets[sampleIndex], step);
    }
    if (!reducedMotion && input.mode !== "idle" && input.mode !== "done") {
      engine.phase += step * (input.mode === "recording" ? 2.15 + engine.energy * 1.15 : 1.45);
    }
  }
}

export function inkBeads(engine) {
  // Canvas is 60×20; the ink itself spans 55.4×15.6 around (cx, cy), so this
  // leaves ~2px of breathing room on each side. 平移这两个常量时，
  // VoiceMotion.jsx 的 60/20 与 styles.css / tauri.conf.json 的窗口尺寸必须同步，
  // 否则墨迹会被白框裁掉。
  const cx = 30, cy = 10;
  const [current, recent, older] = engine.sampleValues;
  // All beads hear the current frame; the side pairs retain different amounts
  // of recent history, so a soft syllable never leaves only the centre moving.
  const inner = 0.72 * current + 0.28 * recent;
  const outer = 0.42 * current + 0.58 * older;
  const working = engine.processing * (1 - engine.done);
  const visible = clamp(Math.max(current, inner, outer) * 3);
  const centerRadius = 5 + current * 2.8;
  // Cap against the centre's *presented* size on every frame, including
  // pauses where the history-driven side beads may still hold energy.
  const innerRadiusY = Math.min(1.6 + inner * 9, centerRadius * 0.85);
  const outerRadiusY = Math.min(1.1 + outer * 6.2, centerRadius * 0.6);
  const commands = [
    { type: "ellipse", cx, cy, rx: centerRadius, ry: centerRadius,
      fill: mixColor(PAPER, INK, (0.84 + 0.08 * current) * (1 - engine.done)) },
  ];
  for (const side of [-1, 1]) {
    const innerStrength = (visible * (0.24 + 0.67 * inner) + working * (0.22 + 0.12 * Math.sin(engine.phase * 1.5 + side))) * (1 - engine.done);
    commands.push({ type: "ellipse", cx: cx + side * 14, cy, rx: 1.4 + inner * 2.1, ry: innerRadiusY,
      fill: mixColor(PAPER, INK, innerStrength) });
    commands.push({ type: "ellipse", cx: cx + side * 25, cy, rx: 1.1 + outer * 1.6, ry: outerRadiusY,
      fill: mixColor(PAPER, SOFT_INK, visible * (0.18 + 0.58 * outer) * (1 - engine.done)) });
  }
  return commands;
}


/** HUD feedback stays on the same five mirrored ink beads through every state. */
export function hudBeads(engine) {
  const base = inkBeads(engine);
  const current = engine.sampleValues[0];
  const visible = clamp(Math.max(...engine.sampleValues) * 3);
  const p = engine.reducedMotion ? Number(engine.mode === "processing") : engine.processing;
  const d = engine.reducedMotion ? Number(engine.mode === "done") : engine.done;
  const e = engine.reducedMotion ? Number(engine.mode === "error") : engine.error;
  const blend = (a, b, t) => a + (b - a) * t;
  const phase = engine.phase * 2.6;
  const hop = (offset) => engine.reducedMotion ? 0 : Math.max(0, Math.sin(phase - offset)) ** 2;
  const shapes = [];

  for (let index = 0; index < 5; index += 1) {
    const rank = index === 0 ? 0 : index % 2 === 1 ? 1 : 2;
    const side = index === 0 ? 0 : index < 3 ? -1 : 1;
    const source = base[rank];
    const lift = hop(rank * 0.6);
    const workingRadius = [4.7, 3.05, 1.8][rank];
    const workingDistance = [0, 13.5, 24][rank];
    const landingDistance = [0, 13.5, 21][rank];
    const restDistance = [0, 14, 25][rank];
    const recordingStrength = rank === 0 ? 0.86 + current * 0.05 : visible * (rank === 1 ? 0.3 + current * 0.6 : 0.18 + current * 0.46);

    // Carry the presented geometry through state changes; no symbol replacement.
    let distance = blend(Math.abs(source.cx - 30), workingDistance, p);
    let cy = blend(10, 10.5 - lift * [2.1, 1.5, 0.8][rank], p);
    let rx = blend(source.rx, workingRadius + (1 - lift) * [0.3, 0.12, 0.06][rank], p);
    let ry = blend(source.ry, workingRadius - (1 - lift) * [0.2, 0.08, 0.04][rank], p);
    let strength = blend(recordingStrength, [0.92, 0.72, 0.42][rank], p);

    // A brief landing compression relaxes into a rounded bead and two traces.
    distance = blend(distance, landingDistance, d);
    const impact = engine.reducedMotion ? 0 : Math.sin(Math.PI * d) ** 2;
    cy = blend(cy, rank === 0 ? 10.7 : 11, d);
    rx = blend(rx, [6.4, 2, 1.1][rank], d) + (rank === 0 ? impact * 0.8 : 0);
    ry = blend(ry, [4.9, 1.55, 0.7][rank], d) - (rank === 0 ? impact * 0.6 : 0);
    strength = blend(strength, [0.94, 0.48, 0][rank], d);

    // On failure the ink withdraws into still, hollow beads, in the same palette.
    distance = blend(distance, restDistance, e);
    cy = blend(cy, 10, e);
    rx = blend(rx, [5.2, 3.2, 1.6][rank], e);
    ry = blend(ry, [5.2, 3.2, 1.6][rank], e);
    const fillOpacity = strength * (1 - e);
    const strokeOpacity = [0.88, 0.68, 0.42][rank] * e;
    if (fillOpacity < 0.005 && strokeOpacity < 0.005) continue;
    shapes.push({ type: "ellipse", cx: 30 + side * distance, cy, rx, ry,
      fill: INK, fillOpacity, stroke: INK, strokeOpacity, lineWidth: [0.85, 0.75, 0.65][rank] });
  }
  return shapes;
}
