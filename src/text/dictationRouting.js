import { effectiveTextLength } from "./localText.js";

// Signals only select the editor; they never delete or rewrite the transcript.
// Ordinary negation and quoted corrections remain text for the editor to interpret.
export function hasExplicitCorrection(text) {
  const value = String(text || "");
  return [
    /不对(?:[，,、。\s]|改|是|应|[0-9零一二三四五六七八九十周])|说错了|口误|改(?:成|为|到)|更正(?:为|一下)/u,
    /不是[^。！？!?\n]{1,18}(?:而是|[，,]\s*是)/u,
    /(?:前面|刚才|之前|上面|以上)[^。！？!?\n]{0,20}(?:作废|撤回|取消(?!后|前)|改|不要了|不用了|删掉|删除|忽略)/u,
    /(?:这段|那段)(?:内容|话|文字)?(?:都|全部|先)?(?:不要了|不用了|作废|撤回|删掉|删除|取消(?:掉|了)?(?:[，。！？!?]|$))/u,
    /(?:只保留|仅保留)(?:最后|后面|刚才)/u,
    /\b(?:sorry[,]?\s+i\s+meant|i\s+mean|make\s+that|scratch\s+that)\b/iu,
  ].some((signal) => signal.test(value));
}

export function needsSmartEditing(text, directLimit = 15) {
  return effectiveTextLength(text) > directLimit || hasExplicitCorrection(text);
}
