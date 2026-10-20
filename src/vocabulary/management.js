import { parseCorrections } from "../text/localText.js";
import { normalizeVocabulary } from "./learning.js";
import { MAX_RULES, correctionKey, hotwordKey, createVocabularyEntryId, normalizeWord, validCorrectionStructure, validateVocabularyWord, conflicts } from "./rules.js";

export { validateVocabularyWord } from "./rules.js";
export const MAX_CSV_BYTES = 1024 * 1024;
export const MAX_CSV_ROWS = 1000;

const sources = new Set(["manual", "auto", "import"]);
const sameEntry = (a, b) => b?.id ? a.id === b.id && JSON.stringify(a) === JSON.stringify(b) : a.kind === b?.kind && correctionKey(a) === correctionKey(b) && a.learnedAt === b.learnedAt;
const releaseDismissal = (state, target) => {
  const key = normalizeWord(target);
  state.dismissed = state.dismissed.filter((item) => item !== hotwordKey(target) && !item.endsWith(`\u0000${key}`));
};

/** Add a correct word, or explicitly edit a current correct-word entry. */
export function upsertVocabularyWord(state, target, { entry, source = "manual", now = Date.now() } = {}) {
  if (!["manual", "import"].includes(source)) throw new Error("正确词需要来自手动添加或导入");
  const next = normalizeVocabulary(state, now);
  const validated = validateVocabularyWord(target);
  if (!validated.valid) throw new Error(validated.reason);
  const index = entry ? next.entries.findIndex((item) => sameEntry(item, entry)) : -1;
  if (entry && index < 0) throw new Error("这条词条已发生变化，请刷新后再编辑");
  if (entry && next.entries[index].kind !== "hotword") throw new Error("旧版替换规则请在替换规则中编辑");
  if (next.entries.some((item, i) => i !== index && item.kind === "hotword" && normalizeWord(item.target) === normalizeWord(validated.word))) throw new Error("这个正确词已在词库中");
  if (index < 0 && next.entries.length >= MAX_RULES) throw new Error(`词库已达 ${MAX_RULES} 条，请先删除不需要的词条`);
  const previous = index >= 0 ? next.entries[index] : null;
  if (previous?.target === validated.word) return next;
  const updated = { ...(previous || {}), id: previous?.id || createVocabularyEntryId(), target: validated.word,
    kind: "hotword", source: sources.has(source) ? source : "manual", learnedAt: previous?.learnedAt ?? now, updatedAt: now,
    ...(previous ? { originSource: previous.originSource || previous.source || "manual" } : {}) };
  if (index < 0) next.entries.push(updated); else next.entries[index] = updated;
  releaseDismissal(next, validated.word);
  return next;
}

/** Small RFC 4180 parser with strict quoting and explicit resource bounds. */
function parseCsv(text) {
  if (typeof text !== "string") return { rows: [], errors: ["CSV 内容无效"] };
  if (new TextEncoder().encode(text).length > MAX_CSV_BYTES) return { rows: [], errors: ["CSV 文件不能超过 1 MB"] };
  text = text.replace(/^\uFEFF/, "");
  const rows = [], errors = [];
  let cells = [], cell = "", quoted = false, closed = false, line = 1, rowLine = 1;
  const finishCell = () => { cells.push(cell); cell = ""; closed = false; };
  const finishRow = () => { finishCell(); if (cells.some((value) => value.trim())) rows.push({ line: rowLine, cells }); cells = []; rowLine = line + 1; };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } }
      else { cell += char; if (char === "\n") line++; }
    } else if (char === '"') {
      if (cell || closed) { errors.push(`第 ${line} 行的引号格式不正确`); break; }
      quoted = true;
    } else if (char === ",") finishCell();
    else if (char === "\r" || char === "\n") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      finishRow(); line++;
    } else if (closed) { errors.push(`第 ${line} 行的闭合引号后有多余内容`); break; }
    else cell += char;
    if (cells.length > 8 || rows.length > MAX_CSV_ROWS + 1) { errors.push(`CSV 最多导入 ${MAX_CSV_ROWS} 行，每行最多 8 列`); break; }
  }
  if (quoted) errors.push(`第 ${rowLine} 行的引号未闭合`);
  if (!errors.length && (cell || cells.length || closed)) finishRow();
  return { rows, errors };
}

const unguardFormula = (value) => /^'\s*[=+\-@]/u.test(value) ? value.slice(1) : value;
const csvCell = (value) => {
  let text = String(value ?? "");
  // Quoting alone does not stop spreadsheet formula execution.
  if (/^[\s]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};
const entryIdentity = (entry) => entry.kind === "hotword" ? hotwordKey(entry.target) : `replacement\u0000${correctionKey(entry)}`;

/** Preview is pure. Invalid and overflowing rows are never silently imported. */
export function previewVocabularyCsv(text, state, manualVocabulary = "") {
  const parsed = parseCsv(text), current = normalizeVocabulary(state);
  const result = { rows: [], validCount: 0, duplicateCount: 0, invalidCount: 0, overflowCount: 0, entriesToAdd: [], errors: [...parsed.errors], canImport: false };
  if (parsed.errors.length) return result;
  const rows = [...parsed.rows];
  let columns = null;
  const labels = rows[0]?.cells.map((value) => value.trim().toLowerCase()) || [];
  if (labels.includes("target") || labels.includes("正确词") || labels.includes("正确写法")) {
    columns = labels; rows.shift();
    if (new Set(columns).size !== columns.length) result.errors.push("CSV 表头不能包含重复列");
  } else if (labels.length === 1 && ["word", "词条"].includes(labels[0])) { columns = ["target"]; rows.shift(); }
  else if (labels.length === 2 && ["misspelling", "错误写法", "误写"].includes(labels[0]) && ["correction", "正确写法", "正确词"].includes(labels[1])) { columns = ["variant", "target"]; rows.shift(); }
  if (rows.length > MAX_CSV_ROWS) result.errors.push(`CSV 最多导入 ${MAX_CSV_ROWS} 行`);
  if (result.errors.length) return result;
  const manualRules = parseCorrections(manualVocabulary);
  const seen = new Set([...current.entries, ...manualRules].map(entryIdentity));
  // A maintained correct word and a replacement have independent ownership:
  // importing a replacement must not erase an editable manually saved hint.
  const targets = new Set(current.entries.filter((entry) => entry.kind === "hotword").map((entry) => normalizeWord(entry.target)));
  const variants = new Map([...current.entries.filter((entry) => entry.kind !== "hotword"), ...manualRules].map((entry) => [normalizeWord(entry.variant), normalizeWord(entry.target)]));
  for (const row of rows) {
    let target = "", variant = "", kind = "hotword", originSource = "";
    const cells = row.cells.map(unguardFormula);
    const value = (...names) => cells[columns.findIndex((column) => names.includes(column))] || "";
    if (columns) { target = value("target", "正确词", "正确写法"); variant = value("variant", "错误写法", "误写"); kind = value("kind").trim() || (variant ? "replacement" : "hotword"); originSource = (value("originsource") || value("source")).trim(); }
    else if (cells.length === 1) target = cells[0];
    else if (cells.length === 2) { [variant, target] = cells; kind = variant ? "replacement" : "hotword"; }
    const item = { line: row.line, target, variant, kind, source: "import", status: "add", reason: "" };
    if ((columns && cells.length !== columns.length) || (!columns && ![1, 2].includes(cells.length))) { item.status = "invalid"; item.reason = "列数不正确：使用单列正确词，或两列误写、正确词"; }
    else if (!["hotword", "replacement"].includes(kind)) { item.status = "invalid"; item.reason = "词条类型无效"; }
    else if (!validateVocabularyWord(target).valid || (kind === "replacement" && !validCorrectionStructure({ variant, target }))) { item.status = "invalid"; item.reason = validateVocabularyWord(target).reason || "替换规则需要两个不同的短词，每项最多 12 个字符"; }
    else if (kind === "hotword" && variant) { item.status = "invalid"; item.reason = "正确词提示不应包含误写；请改为 replacement 或清空 variant"; }
    target = target.trim(); variant = variant.trim();
    item.target = target; item.variant = variant;
    const entry = { target, ...(kind === "hotword" ? { kind: "hotword" } : { variant }), source: "import", ...(sources.has(originSource) ? { originSource } : {}) };
    const identity = entryIdentity(entry);
    if (item.status === "add" && (seen.has(identity) || (kind === "hotword" && targets.has(normalizeWord(target))))) { item.status = "duplicate"; item.reason = "词库或本次文件中已存在"; }
    if (item.status === "add" && kind === "replacement" && conflicts(entry, manualRules)) { item.status = "invalid"; item.reason = "与优先级更高的手动规则冲突，请先调整明确替换规则"; }
    if (item.status === "add" && kind === "replacement" && variants.has(normalizeWord(variant)) && variants.get(normalizeWord(variant)) !== normalizeWord(target)) { item.status = "invalid"; item.reason = "同一误写已有其他正确写法"; }
    if (item.status === "add" && current.entries.length + result.entriesToAdd.length >= MAX_RULES) { item.status = "overflow"; item.reason = `词库最多保存 ${MAX_RULES} 条`; }
    if (item.status === "add") {
      result.validCount++; result.entriesToAdd.push(entry); seen.add(identity);
      if (kind === "hotword") targets.add(normalizeWord(target));
      if (kind === "replacement") variants.set(normalizeWord(variant), normalizeWord(target));
    } else if (item.status === "duplicate") result.duplicateCount++;
    else if (item.status === "overflow") result.overflowCount++;
    else result.invalidCount++;
    result.rows.push(item);
  }
  result.canImport = result.entriesToAdd.length > 0 && !result.errors.length;
  return result;
}

/** Revalidate against the latest store snapshot so stale previews cannot overwrite. */
export function importVocabularyEntries(state, entries, { now = Date.now(), manualVocabulary = "" } = {}) {
  if (!Array.isArray(entries) || entries.length > MAX_CSV_ROWS) throw new Error("导入词条数量无效");
  const csv = ["target,variant,kind,source,originSource", ...entries.map((entry) => [entry.target, entry.kind === "hotword" ? "" : entry.variant, entry.kind === "hotword" ? "hotword" : "replacement", entry.source, entry.originSource].map(csvCell).join(","))].join("\r\n");
  const preview = previewVocabularyCsv(csv, state, manualVocabulary);
  if (preview.errors.length || preview.invalidCount || preview.overflowCount) throw new Error(preview.errors[0] || (preview.overflowCount ? `词库最多保存 ${MAX_RULES} 条，请减少导入数量` : "导入内容有无效词条，请重新预览"));
  const next = normalizeVocabulary(state, now);
  for (const entry of preview.entriesToAdd) {
    next.entries.push({ ...entry, id: createVocabularyEntryId(), learnedAt: now });
    releaseDismissal(next, entry.target);
  }
  return normalizeVocabulary(next, now);
}

/** CSV retains hint/replacement semantics and the original source as provenance. */
export function exportVocabularyCsv(state, { manualVocabulary = "" } = {}) {
  const manualRules = [];
  const manualVariants = new Set();
  for (const rule of parseCorrections(manualVocabulary)) {
    // The first explicit mapping owns this spelling, matching legacy priority.
    const variant = normalizeWord(rule.variant);
    if (!manualVariants.has(variant)) { manualVariants.add(variant); manualRules.push({ ...rule, source: "manual" }); }
  }
  const entries = [...manualRules], seen = new Set(manualRules.map(entryIdentity));
  for (const entry of normalizeVocabulary(state).entries) {
    const key = entryIdentity(entry);
    if (seen.has(key)) continue;
    if (entry.kind !== "hotword" && (manualVariants.has(normalizeWord(entry.variant)) || conflicts(entry, manualRules))) continue;
    seen.add(key); entries.push(entry);
  }
  return "\uFEFF" + ["target,variant,kind,source,originSource", ...entries.map((entry) => [entry.target, entry.kind === "hotword" ? "" : entry.variant, entry.kind === "hotword" ? "hotword" : "replacement", entry.source || "", entry.originSource || ""].map(csvCell).join(","))].join("\r\n");
}
