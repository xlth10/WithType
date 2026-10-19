// SPDX-License-Identifier: GPL-3.0-only
// Adapted from Typefree HotWordsAutoLearner / MishearingCheck (kdsz001 and contributors).
// Upstream 9d16762c52906f054285b630935017a431e9e627. See THIRD_PARTY_NOTICES.md.
// Shared word-rule primitives stay available without loading the phonetic dictionary.
import { parseCorrections } from "../text/localText.js";

const han = /^[\u3400-\u9fff\uf900-\ufaff]$/u;
export const MAX_RULES = 60;
export const MAX_AUTO_HOTWORDS = 30;
export const normalizeWord = (value) => value.trim().toLowerCase();
export const correctionKey = ({ variant, target }) => `${normalizeWord(variant)}\u0000${normalizeWord(target)}`;

export function validCorrectionStructure({ variant, target }) {
  if (typeof variant !== "string" || typeof target !== "string") return false;
  const lengths = [Array.from(variant).length, Array.from(target).length];
  if (normalizeWord(variant) === normalizeWord(target) || Math.min(...lengths) < 1 || Math.max(...lengths) > 12 || Math.max(...lengths) / Math.min(...lengths) > 5) return false;
  for (const text of [variant, target]) {
    if (/[。！？!?；;\n\r=|\u0000]/u.test(text) || (text.match(/[，,、：:]/g) || []).length >= 2) return false;
    if (!/[\p{L}]/u.test(text) || /^[A-Za-z0-9]$/.test(text)) return false;
  }
  return !(han.test(variant) && han.test(target));
}

export function emptyVocabulary() { return { version: 1, entries: [], candidates: [], dismissed: [] }; }

export function normalizeDismissed(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((s) => typeof s === "string" && s.length <= 100))].slice(0, 5000);
}

export function conflicts(pair, rules) {
  const variant = normalizeWord(pair.variant), target = normalizeWord(pair.target);
  return rules.some((r) => (normalizeWord(r.target) === variant && normalizeWord(r.target) !== target) || (normalizeWord(r.variant) === variant && normalizeWord(r.target) !== target) || normalizeWord(r.variant) === target);
}

/** Manual rules win; one-pass replacements prevent cascades and respect Latin word boundaries. */
export function applyLearnedVocabulary(text, entries = [], manualVocabulary = "") {
  const manual = parseCorrections(manualVocabulary);
  const rules = entries.filter((r) => r && r.kind !== "hotword" && validCorrectionStructure(r) && !conflicts(r, manual) && !manual.some((m) => normalizeWord(m.variant) === normalizeWord(r.variant))).sort((a, b) => b.variant.length - a.variant.length);
  if (!rules.length) return text;
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(rules.map((r) => `${/^[A-Za-z0-9]/.test(r.variant) ? "(?<![A-Za-z0-9_])" : ""}${escape(r.variant)}${/[A-Za-z0-9]$/.test(r.variant) ? "(?![A-Za-z0-9_])" : ""}`).join("|"), "giu");
  return text.replace(pattern, (match) => rules.find((r) => normalizeWord(r.variant) === normalizeWord(match))?.target || match);
}

/** A bounded ASR hint list. Targets are hints only; source variants never become replacements. */
export function collectAsrHotWords(manualVocabulary = "", learnedEntries = []) {
  const result = [], seen = new Set();
  let checked = 0;
  const add = (value) => {
    checked++;
    if (typeof value !== "string" || value.length > 80 || /[\p{Cc}\p{Cf}]/u.test(value)) return;
    const word = value.trim();
    if (!word || Array.from(word).length > 40) return;
    const key = word.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key); result.push(word);
  };
  if (typeof manualVocabulary === "string") {
    let start = 0;
    while (start < manualVocabulary.length && checked < 1000 && result.length < 100) {
      const newline = manualVocabulary.indexOf("\n", start);
      const end = newline < 0 ? manualVocabulary.length : newline;
      const line = manualVocabulary.slice(start, end).replace(/\r$/, "");
      add(line.split("=", 1)[0]);
      start = end + 1;
    }
  }
  if (Array.isArray(learnedEntries)) {
    for (let index = 0; index < learnedEntries.length && checked < 1000 && result.length < 100; index++) {
      add(learnedEntries[index]?.target);
    }
  }
  return result;
}
