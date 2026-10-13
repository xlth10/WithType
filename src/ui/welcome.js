import { BRAND } from "./brand.js";

export const WELCOME_TEXT_LIMIT = 40;

/** A short, single-line greeting. Empty or invalid preferences use the brand default. */
export function normalizeWelcomeText(value) {
  if (typeof value !== "string") return BRAND.welcome;
  const text = value.replace(/\s+/gu, " ").replace(/[\u0000-\u001f\u007f]/gu, "").trim();
  return Array.from(text).slice(0, WELCOME_TEXT_LIMIT).join("") || BRAND.welcome;
}

/** Keep the original size when it fits; shrink longer greetings without changing the camera. */
export function fitWelcomeFontSize(preferredSize, maxWidth, measureWidth) {
  const width = measureWidth(preferredSize);
  return width > maxWidth ? preferredSize * maxWidth / width : preferredSize;
}
