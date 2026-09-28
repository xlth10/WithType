// 本地文字处理纯函数：个人词典替换与轻度清理。
// 只依赖标准 JS，不引入 React / Tauri / 浏览器专有 API，
// 这样 node --test 可以直接引入本文件做单元测试。

/**
 * 解析「正确写法=误写1|误写2」格式的词典。
 * 返回按 variant 长度降序排列的替换项，避免短词先替换掉长词的一部分。
 */
export function parseCorrections(raw) {
  if (typeof raw !== "string") return [];
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const [target, variants] = line.split("=");
      if (!target || !variants) return [];
      return variants.split("|").map((variant) => ({ target: target.trim(), variant: variant.trim() }));
    })
    .filter((item) => item.target && item.variant && item.target !== item.variant)
    .sort((a, b) => b.variant.length - a.variant.length);
}

/** 按个人词典做纯字符串替换。 */
export function applyVocabulary(text, vocabulary) {
  if (typeof text !== "string") return "";
  let output = text;
  for (const item of parseCorrections(vocabulary)) {
    output = output.split(item.variant).join(item.target);
  }
  return output;
}

/**
 * 轻度清理：只去掉明显的口语赘词并规范标点，不改写句子结构、不动数字和否定词。
 * 注意这里用 \s 匹配空白，会把被标点包裹的换行一并压平，这是有意的：
 * 该模式定位是「比原文干净一点」，结构整理交给文字模型。
 */
export function lightlyCleanText(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/(^|[，。！？,.!?\s])(嗯+|呃+|那个|然后呢|就是说)(?=([，。！？,.!?\s]|$))/g, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*([，。！？,.!?])\s*/g, "$1")
    .replace(/([，。！？,.!?])\1+/g, "$1")
    .trim();
}