// Preserve every UTF-16 unit; prefer sentence boundaries without splitting surrogate pairs.
export const TEXT_CHUNK_LIMIT = 12000;
export function referenceTail(text, limit = 500) {
  let start = Math.max(0, text.length - limit);
  const code = text.charCodeAt(start);
  if (code >= 0xDC00 && code <= 0xDFFF) start += 1;
  return text.slice(start);
}
export function splitText(text, limit = TEXT_CHUNK_LIMIT) {
  if (!Number.isInteger(limit) || limit < 2) throw new RangeError("Text chunk limit must be at least two UTF-16 units");
  const chunks = [];
  for (let rest = String(text || ""); rest;) {
    if (rest.length <= limit) { chunks.push(rest); break; }
    let end = limit;
    if (/[\uD800-\uDBFF]/u.test(rest[end - 1])) end -= 1;
    const candidate = rest.slice(0, end);
    const boundaries = [...candidate.matchAll(/[。！？!?][”’」』"']*\s*|\.\s+|\n+/gu)];
    const boundary = boundaries.at(-1) || [...candidate.matchAll(/\s+/gu)].at(-1);
    if (boundary && boundary.index + boundary[0].length >= limit / 2) end = boundary.index + boundary[0].length;
    chunks.push(rest.slice(0, end));
    rest = rest.slice(end);
  }
  return chunks;
}

// Leave the last sentence uncommitted so an adjacent ASR result can complete it.
export function stablePrefix(text) {
  const ends = [...text.matchAll(/[。！？!?][”’」』"']*\s*|\.\s+|\n+/gu)];
  const boundary = ends.at(-2);
  return boundary ? text.slice(0, boundary.index + boundary[0].length) : "";
}
