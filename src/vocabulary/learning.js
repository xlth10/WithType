// SPDX-License-Identifier: GPL-3.0-only
// Adapted from Typefree HotWordsAutoLearner / MishearingCheck (kdsz001 and contributors).
// Upstream 9d16762c52906f054285b630935017a431e9e627. See THIRD_PARTY_NOTICES.md.
import { pinyin } from "pinyin-pro";
import { parseCorrections } from "../text/localText.js";
import { MAX_RULES, MAX_AUTO_HOTWORDS, normalizeWord as normalize, correctionKey, validCorrectionStructure, emptyVocabulary, normalizeDismissed, conflicts } from "./rules.js";
export { MAX_RULES, MAX_AUTO_HOTWORDS, correctionKey, emptyVocabulary, applyLearnedVocabulary, collectAsrHotWords } from "./rules.js";

const han = /^[\u3400-\u9fff\uf900-\ufaff]$/u;
const meaningful = ["他她它牠", "的得地", "在再", "那哪", "做作", "已以", "像象", "须需", "即既"];
const similar = [["zh", "z"], ["ch", "c"], ["sh", "s"], ["n", "l"], ["f", "h"], ["r", "l"]];
const initials = ["zh", "ch", "sh", ..."bpmfdtnlgkhjqxrzcs yw".replace(/ /g, "")];
const DAY = 86400000;

function soundUnits(text) {
  return (text.match(/[A-Za-z0-9]+|[\u3400-\u9fff\uf900-\ufaff]/gu) || []).map((char) => ({
    char, han: han.test(char), sound: han.test(char) ? pinyin(char, { toneType: "none" }).toLowerCase() : char.toLowerCase(),
  }));
}
function syllablesMatch(a, b) {
  if (a === b) return true;
  const split = (s) => { const i = initials.find((x) => s.startsWith(x) && s.length > x.length) || ""; return [i, s.slice(i.length).replace(/ng$|n$/, "")]; };
  const [ai, af] = split(a), [bi, bf] = split(b);
  return af === bf && (ai === bi || similar.some((group) => group.includes(ai) && group.includes(bi)));
}
function editDistance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++) next[j + 1] = a[i] === b[j] ? row[j] : 1 + Math.min(row[j], row[j + 1], next[j]);
    row = next;
  }
  return row[b.length];
}
export function soundsLike(variant, target) {
  const digits = (s) => (s.match(/[0-9０-９]/g) || []).join("");
  if (digits(variant) !== digits(target)) return false;
  const a = soundUnits(variant), b = soundUnits(target);
  if (!a.length || !b.length || normalize(variant) === normalize(target)) return false;
  if (a.every((x) => x.han) && b.every((x) => x.han)) {
    if (a.length !== b.length || a.length < 2) return false;
    return a.every((x, i) => x.char === b[i].char || (
      !meaningful.some((group) => group.includes(x.char) && group.includes(b[i].char)) && syllablesMatch(x.sound, b[i].sound)
    ));
  }
  const s = a.map((x) => x.sound).join(""), t = b.map((x) => x.sound).join("");
  return s !== t && editDistance(s, t) / Math.max(s.length, t.length) <= 0.5;
}
export function validCorrection({ variant, target }, soundCheck = true) {
  if (!validCorrectionStructure({ variant, target })) return false;
  return !soundCheck || soundsLike(variant, target);
}

function tokenize(text) {
  return Array.from(text.matchAll(/[A-Za-z0-9]+|[^\s]/gu), (m) => ({ text: m[0], start: m.index, end: m.index + m[0].length }));
}
/** LCS keeps independent corrections separate; pure additions/deletions never become rules. */
export function extractCorrections(original, edited, { manual = false } = {}) {
  if (typeof original !== "string" || typeof edited !== "string" || original === edited || original.length > 12000 || edited.length > 12000) return [];
  const a = tokenize(original), b = tokenize(edited);
  // Bound quadratic work. Long documents can still be corrected with a manual word entry.
  if (a.length > 512 || b.length > 512) return [];
  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
    dp[i][j] = a[i].text === b[j].text ? 1 + dp[i + 1][j + 1] : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const anchors = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i].text === b[j].text) { anchors.push([i++, j++]); }
    else if (dp[i + 1][j] > dp[i][j + 1]) i++;
    else j++;
  }
  anchors.push([a.length, b.length]);
  const result = new Map();
  let ai = 0, bi = 0;
  const span = (tokens, start, end, text) => text.slice(tokens[start].start, tokens[end - 1].end).trim();
  for (const [aj, bj] of anchors) {
    if (aj > ai && bj > bi) {
      let variant = span(a, ai, aj, original), target = span(b, bi, bj, edited);
      if (Math.max(Array.from(variant).length, Array.from(target).length) < 2) {
        if (ai > 0 && bi > 0 && a[ai - 1].text === b[bi - 1].text && /^[\p{L}\p{N}]+$/u.test(a[ai - 1].text)) {
          variant = a[ai - 1].text + variant; target = b[bi - 1].text + target;
        } else if (aj < a.length && bj < b.length && /^[\p{L}\p{N}]+$/u.test(a[aj].text)) {
          variant += a[aj].text; target += b[bj].text;
        }
      }
      const pair = { variant, target };
      if (validCorrection(pair, !manual)) result.set(correctionKey(pair), pair);
    }
    ai = aj + 1; bi = bj + 1;
  }
  return [...result.values()];
}

const targetKey = (target) => `hotword\u0000${normalize(target)}`;

export function normalizeVocabulary(raw, now = Date.now()) {
  if (!raw || typeof raw !== "object") return emptyVocabulary();
  const unique = (values, key = correctionKey) => [...new Map(values.map((x) => [key(x), x])).values()];
  const valid = (Array.isArray(raw.entries) ? raw.entries : []).filter((x) => x && validCorrection(x, x.source !== "manual"));
  // Preserve all pre-existing replacement semantics. Hotwords are separately
  // deduplicated by their correct target, and never displace a legacy rule.
  const replacements = unique(valid.filter((x) => x.kind !== "hotword")).slice(0, MAX_RULES);
  const replacementTargets = new Set(replacements.map((x) => normalize(x.target)));
  const hotwords = unique(valid.filter((x) => x.kind === "hotword" && !replacementTargets.has(normalize(x.target))), (x) => normalize(x.target))
    .slice(0, Math.min(MAX_AUTO_HOTWORDS, MAX_RULES - replacements.length));
  const entries = [...replacements, ...hotwords];
  // Legacy candidates remain visible until expiry or a new explicit correction.
  // Loading alone never promotes an old candidate or a deleted word.
  const candidates = unique((Array.isArray(raw.candidates) ? raw.candidates : []).filter((x) => x && validCorrection(x) && x.lastSeen >= now - 30 * DAY && x.lastSeen <= now && x.count === 1)).slice(-200);
  const dismissed = normalizeDismissed(raw.dismissed);
  return { version: 1, entries, candidates, dismissed };
}
export function learnCorrections(state, { original, edited, sessionId, manual = false, vocabulary = "", now = Date.now() }) {
  const next = normalizeVocabulary(state, now);
  const learned = [];
  const manualRules = parseCorrections(vocabulary);
  for (const pair of extractCorrections(original, edited, { manual })) {
    const key = correctionKey(pair);
    const wordKey = targetKey(pair.target);
    const replacements = [...manualRules, ...next.entries.filter((entry) => entry.kind !== "hotword")];
    if (replacements.some((entry) => correctionKey(entry) === key) || conflicts(pair, replacements)) continue;
    if (!manual && (next.dismissed.includes(key) || next.dismissed.includes(wordKey)
      || [...manualRules, ...next.entries].some((entry) => normalize(entry.target) === normalize(pair.target)))) continue;
    const retained = manual ? next.entries.filter((entry) => entry.kind !== "hotword" || normalize(entry.target) !== normalize(pair.target)) : next.entries;
    if (retained.length >= MAX_RULES || (!manual && retained.filter((entry) => entry.kind === "hotword").length >= MAX_AUTO_HOTWORDS)) continue;
    next.entries = [...retained, { ...pair, ...(!manual ? { kind: "hotword" } : {}), source: manual ? "manual" : "auto", learnedAt: now }];
    next.candidates = next.candidates.filter((candidate) => correctionKey(candidate) !== key);
    next.dismissed = next.dismissed.filter((dismissed) => dismissed !== key && dismissed !== wordKey);
    learned.push(pair);
  }
  return { state: next, learned };
}
export function dismissCorrection(state, pair) {
  const key = correctionKey(pair);
  const next = normalizeVocabulary(state);
  // A deleted hotword stays disabled even if a future recognizer mishears the
  // same target differently. Legacy dismissals retain their existing pair scope.
  const isHotword = pair.kind === "hotword" || next.entries.some((entry) => entry.kind === "hotword" && correctionKey(entry) === key);
  const keys = [key, ...(isHotword ? [targetKey(pair.target)] : [])];
  const dismissed = [...new Set([...next.dismissed, ...keys])];
  if (dismissed.length > 5000) throw new Error("忽略记录已满，请先导出并整理词库");
  next.entries = next.entries.filter((entry) => correctionKey(entry) !== key && !(isHotword && entry.kind === "hotword" && normalize(entry.target) === normalize(pair.target)));
  next.candidates = next.candidates.filter((entry) => correctionKey(entry) !== key);
  next.dismissed = dismissed;
  return next;
}
