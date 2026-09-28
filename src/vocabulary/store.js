import { emptyVocabulary, normalizeVocabulary } from "./learning.js";
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
      current = copy(normalizeVocabulary(raw));
      onChange(copy(current));
      return copy(current);
    }),
    update: (transform) => serial(async () => {
      const next = copy(normalizeVocabulary(transform(copy(current))));
      await invoke("save_vocabulary", { vocabulary: next }, () => localStorage.setItem(KEY, JSON.stringify(next)));
      current = next;
      onChange(copy(current));
      return copy(current);
    }),
  };
}
