// SPDX-License-Identifier: GPL-3.0-only
// Adapted from Typefree HotWordsAutoLearner / MishearingCheck (kdsz001 and contributors).
// Upstream 9d16762c52906f054285b630935017a431e9e627. See THIRD_PARTY_NOTICES.md.
// Shared word-rule primitives stay available without loading the phonetic dictionary.
import { parseCorrections } from "../text/localText.js";

const han = /^[\u3400-\u9fff\uf900-\ufaff]$/u;
export const MAX_RULES = 500;
export const MAX_AUTO_HOTWORDS = 30;
export const MAX_ASR_HOTWORDS = 100;
export const normalizeWord = (value) => typeof value === "string" ? value.trim().toLowerCase() : "";
export const correctionKey = ({ variant, target }) => `${normalizeWord(variant)}\u0000${normalizeWord(target)}`;
export const hotwordKey = (target) => `hotword\u0000${normalizeWord(target)}`;
let entrySequence = 0;
export function createVocabularyEntryId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  // Local browser previews can run outside a secure context. This ID only
  // distinguishes mutations for safe undo; it is not a security credential.
  return `vocab-${Date.now().toString(36)}-${(++entrySequence).toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** A short lexical hint, never a sentence, URL, formula or bare number. */
export function validateVocabularyWord(value) {
  if (typeof value !== "string") return { valid: false, word: "", reason: "词条需要是文字" };
  const word = value.trim();
  let reason = "";
  if (!word) reason = "请输入正确词";
  else if (Array.from(word).length > 40 || word.length > 80) reason = "每个词条最多 40 个字符";
  else if (/[\p{Cc}\p{Cf}]/u.test(value)) reason = "词条不能包含换行或隐藏控制符";
  else if (!/\p{L}/u.test(word)) reason = "词条需要包含汉字或字母，不能只有数字或符号";
  else if (/^[=+@\-]/u.test(word) || /[=|;；!?！？。]/u.test(word)) reason = "请填写名称或短语，不要填写公式、规则或句子";
  else if (/https?:\/\/|www\.|@|[\\/]/iu.test(word)) reason = "网址、邮箱和路径不作为正确词提示";
  return { valid: !reason, word, reason };
}

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
export function getAsrVocabularySummary(manualVocabulary = "", learnedEntries = []) {
  const result = [], seen = new Set();
  let checked = 0;
  const add = (value) => {
    checked++;
    const { valid, word } = validateVocabularyWord(value);
    if (!valid) return;
    const key = word.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key); result.push(word);
  };
  if (typeof manualVocabulary === "string") {
    let start = 0;
    while (start < manualVocabulary.length && checked < 1000) {
      const newline = manualVocabulary.indexOf("\n", start);
      const end = newline < 0 ? manualVocabulary.length : newline;
      const line = manualVocabulary.slice(start, end).replace(/\r$/, "");
      add(line.split("=", 1)[0]);
      start = end + 1;
    }
  }
  if (Array.isArray(learnedEntries)) {
    // Explicitly maintained words have priority over automatic suggestions.
    // Keep stable insertion order within each group and bound untrusted input.
    const entries = learnedEntries.slice(0, Math.max(0, 1000 - checked));
    for (const automatic of [false, true]) {
      for (const entry of entries) {
        if ((entry?.source === "auto") === automatic) add(entry?.target);
      }
    }
  }
  return { words: result.slice(0, MAX_ASR_HOTWORDS), eligibleCount: result.length,
    omittedCount: Math.max(0, result.length - MAX_ASR_HOTWORDS), limit: MAX_ASR_HOTWORDS };
}

export function collectAsrHotWords(manualVocabulary = "", learnedEntries = []) {
  return getAsrVocabularySummary(manualVocabulary, learnedEntries).words;
}
