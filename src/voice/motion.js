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
  for (let index = 0; index < steps; index += 1) {
    const energyTarget = input.mode === "recording" ? clamp(input.level) : 0;
    spring(engine, "energy", "energyVelocity", energyTarget, energyTarget > engine.energy ? 0.16 : 0.31, step);
    spring(engine, "processing", "processingVelocity", input.mode === "processing" ? 1 : 0, 0.33, step);
    spring(engine, "done", "doneVelocity", input.mode === "done" ? 1 : 0, 0.25, step);
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

