const STATUSES = new Set(["inserted", "sent", "copied", "retained"]);

export function normalizeDelivery(value) {
  if (!value || !STATUSES.has(value.status)) {
    return { status: "retained", copied: false, pasted: false, message: "投递没有返回确认，结果已保留，请手动复制" };
  }
  return { status: value.status, copied: value.copied === true,
    pasted: value.status === "inserted" && value.pasted === true,
    message: String(value.message || ({ inserted: "已输入", sent: "已发送粘贴，尚未确认输入", copied: "已复制，可以粘贴", retained: "结果已保留，请手动复制" }[value.status])) };
}

export async function copyResult(invoke, text, sessionId) {
  try {
    return normalizeDelivery(await invoke("copy_text", { text, sessionId }, async () => {
      await navigator.clipboard.writeText(text);
      return { status: "copied", copied: true, pasted: false, message: "已复制，可以粘贴" };
    }));
  } catch (error) {
    return { status: "retained", copied: false, pasted: false, message: `复制失败，结果已保留：${String(error?.message || error)}` };
  }
}

export function recentResult(history) {
  const entry = history.find(item => !item.archived && typeof item.text === "string" && item.text.trim());
  return entry ? { text: entry.text, intent: entry.intent, ms: entry.ms, breakdown: entry.breakdown,
    delivery: entry.delivery, savedAt: entry.savedAt } : null;
}

export function needsResultCard(delivery) { return delivery?.status !== "inserted"; }
