const LANGUAGE_NAMES = {
  英文: "英文", 英语: "英文",
  日文: "日文", 日语: "日文",
  韩文: "韩文", 韩语: "韩文",
  中文: "中文", 汉语: "中文",
  法文: "法文", 法语: "法文",
  德文: "德文", 德语: "德文",
  西班牙文: "西班牙文", 西班牙语: "西班牙文",
};

const TAIL = /(?:[，,。.!！?？；;]\s*)?(?:请\s*)?(?:用|翻译成|翻译为|译成)\s*(西班牙文|西班牙语|英文|英语|日文|日语|韩文|韩语|中文|汉语|法文|法语|德文|德语)\s*[。.!！?？]*$/u;
const PREFIX = /^(?:请\s*)?(?:(?:把|将)\s*(?:以下|下面|这段)?\s*(?:内容|文字)?\s*)?(?:翻译成|译成|翻译为)\s*(西班牙文|西班牙语|英文|英语|日文|日语|韩文|韩语|中文|汉语|法文|法语|德文|德语)\s*[：:，,]\s*/u;
const PREFIX_USING = /^(?:请\s*)?(?:用|以)\s*(西班牙文|西班牙语|英文|英语|日文|日语|韩文|韩语|中文|汉语|法文|法语|德文|德语)\s*(?:翻译)?\s*[：:，,]\s*/u;
const NEGATED = /(?:不要|不用|不需要|无需|不能|不必|不会|没有|不是|别|不|没)\s*$/u;
const FILLER = /(?:可以吗|好吗|好么|行吗|谢谢|一下|就行|please|吧|呗|哦|啊|呀|哈|说)\s*[。.!！?？]*$/iu;

function meaningful(text) { return (text.match(/[\p{L}\p{N}]/gu) || []).length >= 3; }
function trimEdges(text) { return text.replace(/^[\s，,。.!！?？；;：:]+|[\s，,。.!！?？；;：:]+$/gu, "").trim(); }

/** Only explicit boundary commands change the output language. */
export function parseOutputLanguage(text) {
  const input = trimEdges(String(text || ""));
  const prefix = PREFIX.exec(input) || PREFIX_USING.exec(input);
  if (prefix) {
    const body = trimEdges(input.slice(prefix[0].length));
    return meaningful(body) ? { body, language: LANGUAGE_NAMES[prefix[1]] } : null;
  }
  const withoutFillers = trimEdges(input.replace(FILLER, ""));
  for (const candidate of [input, withoutFillers]) {
    const tail = TAIL.exec(candidate);
    if (!tail) continue;
    const body = trimEdges(candidate.slice(0, tail.index));
    if (NEGATED.test(body) || !meaningful(body)) return null;
    return { body, language: LANGUAGE_NAMES[tail[1]] };
  }
  return null;
}

export function translationInstruction(language = "英文") {
  const target = Object.values(LANGUAGE_NAMES).includes(language) ? language : "英文";
  return `把口述内容译成自然的${target}；保留原意、专有名词、数字和否定。只输出译文。`;
}
