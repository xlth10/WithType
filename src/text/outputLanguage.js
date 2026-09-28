const LANGUAGE_NAMES = {
  英文: "英文", 英语: "英文",
  日文: "日文", 日语: "日文",
  韩文: "韩文", 韩语: "韩文",
  中文: "中文", 汉语: "中文",
  法文: "法文", 法语: "法文",
  德文: "德文", 德语: "德文",
  西班牙文: "西班牙文", 西班牙语: "西班牙文",
};

const TAIL = /(?:[，,。.!！?？；;]\s*)?(?:请\s*)?(?:用|翻译成|译成)\s*(西班牙文|西班牙语|英文|英语|日文|日语|韩文|韩语|中文|汉语|法文|法语|德文|德语)\s*[。.!！?？]*$/u;

/** Only a final, explicit language command changes the output language. */
export function parseOutputLanguage(text) {
  const input = String(text || "").trim();
  const match = TAIL.exec(input);
  if (!match) return null;
  const body = input.slice(0, match.index).trim();
  if (!body) return null;
  return { body, language: LANGUAGE_NAMES[match[1]] };
}

export function translationInstruction(language = "英文") {
  const target = Object.values(LANGUAGE_NAMES).includes(language) ? language : "英文";
  return `把口述内容译成自然的${target}；保留原意、专有名词、数字和否定。只输出译文。`;
}
