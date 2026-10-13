// WithType's entrance timeline, expressed with standard interpolation and
// oscillator equations. This module has no animation-library dependency.
export const DURATION = 3.6;

export function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function lerp(start, end, fraction) {
  return start + (end - start) * fraction;
}

export function seg(time, start, end) {
  if (start === end) return time < end ? 0 : 1;
  return clamp((time - start) / (end - start));
}

export function sineInOut(fraction) {
  return (1 - Math.cos(Math.PI * fraction)) / 2;
}

export function cubicOut(fraction) {
  return 1 - (1 - fraction) ** 3;
}

export function cubicInOut(fraction) {
  return fraction <= 0.5 ? 4 * fraction ** 3 : 1 - 4 * (1 - fraction) ** 3;
}

/** Standard xorshift32 (13, 17, 5): the seed fixes the paper's fiber pattern. */
export function rng(seed = 1) {
  let state = Number(seed) >>> 0;
  if (state === 0) state = 1;
  return () => {
    state = (state ^ (state << 13)) >>> 0;
    state = (state ^ (state >>> 17)) >>> 0;
    state = (state ^ (state << 5)) >>> 0;
    return state / 0x100000000;
  };
}

// [time, vertical offset from viewport center, zoom, arrival interpolation]
const CAMERA_KEYS = Object.freeze([
  [0, -24, 2, cubicInOut],
  [0.14, -24, 2, cubicInOut],
  [0.62, 0, 2.10, sineInOut],
  [0.84, 1, 2.12, cubicOut],
  [1.10, 1, 2.12, cubicInOut],
  [1.76, 0, 1.60, cubicOut],
  [2.70, 0, 1.60, cubicInOut],
  [DURATION, 0, 1, sineInOut],
]);

/** A centered camera; zoom interpolates geometrically for constant scale ratios. */
export function cameraAt(time, width, height) {
  const t = clamp(time, 0, DURATION);
  let destination = 1;
  while (destination < CAMERA_KEYS.length - 1 && t > CAMERA_KEYS[destination][0]) destination += 1;
  const before = CAMERA_KEYS[destination - 1];
  const after = CAMERA_KEYS[destination];
  const progress = after[3](seg(t, before[0], after[0]));
  return {
    x: width / 2,
    y: height / 2 + lerp(before[1], after[1], progress),
    zoom: Math.exp(lerp(Math.log(before[2]), Math.log(after[2]), progress)),
    rot: 0,
  };
}

/** CSS/Canvas affine matrix: the camera's focus maps to the viewport center. */
export function view(camera, { W, H }) {
  const angle = camera.rot ?? 0;
  const horizontal = camera.zoom * Math.cos(angle);
  const vertical = camera.zoom * Math.sin(angle);
  return [
    horizontal,
    vertical,
    -vertical,
    horizontal,
    W / 2 - horizontal * camera.x + vertical * camera.y,
    H / 2 - vertical * camera.x - horizontal * camera.y,
  ];
}

/** From rest above the paper to contact, using a quadratic acceleration curve. */
export function dropAt(time, dropHeight) {
  const progress = seg(time, 0.14, 0.70);
  return { x: 0, y: -dropHeight * (1 - progress ** 2) };
}

export function liquidAt(time, textWidth, fontSize) {
  const spread = cubicOut(seg(time, 0.70, 1.30));
  return {
    spread,
    rx: lerp(11, textWidth * 0.53, spread),
    ry: lerp(4, fontSize * 0.56, spread),
    morph: sineInOut(seg(time, 1.16, 2)),
  };
}

/** A damped contact oscillation deforms the bead, starting at its original size. */
export function impactAt(time) {
  const elapsed = Math.max(0, time - 0.70);
  const displacement = Math.exp(-17 * elapsed) * Math.sin(24 * elapsed);
  return { sx: 1 + 0.20 * displacement, sy: 1 - 0.25 * displacement };
}
