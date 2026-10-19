import { emptyVocabulary, normalizeDismissed } from "./rules.js";
const KEY = "typefree-windows.vocabulary";
const copy = (value) => structuredClone(value);

// Only the main window owns this queue. Failed writes keep the last persisted state.
export function createVocabularyStore(invoke, onChange) {
  let current = emptyVocabulary();
  let queue = Promise.resolve();
  const serial = (operation) => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };
  return {
    load: () => serial(async () => {
      const raw = await invoke("load_vocabulary", {}, () => JSON.parse(localStorage.getItem(KEY) || "null"));
      // First-run windows do not need the phonetic dictionary. Existing saved
      // rules still pass the full validation before dictation becomes ready.
      const hasRules = [raw?.entries, raw?.candidates].some((items) => Array.isArray(items) && items.length);
      current = hasRules ? copy((await import("./learning.js")).normalizeVocabulary(raw))
        : { ...emptyVocabulary(), dismissed: normalizeDismissed(raw?.dismissed) };
      onChange(copy(current));
      return copy(current);
    }),
    update: (transform) => serial(async () => {
      const transformed = await transform(copy(current));
      const { normalizeVocabulary } = await import("./learning.js");
      const next = copy(normalizeVocabulary(transformed));
      await invoke("save_vocabulary", { vocabulary: next }, () => localStorage.setItem(KEY, JSON.stringify(next)));
      current = next;
      onChange(copy(current));
      return copy(current);
    }),
  };
}
