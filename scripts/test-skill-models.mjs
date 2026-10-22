// Real text-model evaluation using synthetic fixtures, never microphone/user history.
// Key is read in memory from an environment variable or the app's existing keychain entry.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { createPipeline } from "../src/dictation/pipeline.js";
import { buildMessages } from "../src/text/builtinSkills.js";
import { DEFAULT_SETTINGS } from "../src/text/settingsMigration.js";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("Usage: npm run test:skills:model -- [--settings settings.json] [--baseline baseline-builtinSkills.mjs] [--case case-id] [--output results.json]\nUses the configured real text model and app credential. Fixtures are synthetic text; no ASR. Review JSON outputs manually.");
  process.exit(0);
}
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const outputPath = resolve(option("--output", "docs/verification/skill-v2-2026-10-20/model-results.json"));
const settingsPath = option("--settings", `${homedir()}/Library/Application Support/app.withtype.desktop/settings.json`);
const settings = { ...DEFAULT_SETTINGS, ...JSON.parse(await readFile(settingsPath, "utf8")), vocabulary: "", textStreaming: false };
if (!settings.textEndpoint || !settings.textModel) throw new Error("Configure a text endpoint/model first, or supply --settings.");
let apiKey = process.env.WITHTYPE_TEXT_API_KEY || "";
if (settings.textAuthMode !== "none" && !apiKey && process.platform === "darwin") {
  const stored = spawnSync("security", ["find-generic-password", "-s", "app.typefree.windows.unofficial", "-a", "text-model-api-key", "-w"], { encoding: "utf8" });
  if (stored.status === 0) apiKey = stored.stdout.trim();
}
if (settings.textAuthMode !== "none" && !apiKey) throw new Error("Text credential unavailable. Configure it in the app, or set WITHTYPE_TEXT_API_KEY in the test process.");
let endpoint = settings.textEndpoint.replace(/\/+$/, "");
if (!endpoint.endsWith("/chat/completions")) endpoint = endpoint.replace(/\/v1$/, "") + "/v1/chat/completions";
const baselinePath = option("--baseline", null);
const baselineBuilder = baselinePath ? (await import("data:text/javascript;base64," + Buffer.from(await readFile(baselinePath, "utf8")).toString("base64"))).buildMessages : null;
const cases = [
  { id: "omit-empty", raw: "登录功能已经完成。", instruction: "按已完成、问题、下一步组织工作汇报。", missingInfoPolicy: "omit", checks: { preserveLogin: "登录", noMissingPlaceholders: "!待确认", noInventedProblems: "!问题[：:]" } },
  { id: "mark-empty", raw: "登录功能已经完成。", instruction: "按已完成、问题、下一步组织工作汇报。", missingInfoPolicy: "mark", checks: { preserveLogin: "登录", markMissing: "待确认" } },
  { id: "numbers-negation", raw: "金额不是3000元，改为3500元。付款时间还没定，不承诺周五到账。", instruction: "整理为简洁的付款说明。", checks: { finalAmount: "3500", keepUncertainty: "未定|没定|未确定|尚未|未明确", keepNoPromise: "不承诺|不保证|无法承诺|不作.*承诺" } },
  { id: "example-isolation", raw: "绿川公司预算48000元，计划周四继续沟通，完成时间没定。", instruction: "按客户、预算、下一步组织，不增加承诺。", examples: [{ input: "蓝山公司预算9999元，周一交付。", output: "客户：蓝山公司\n预算：9999元\n下一步：周一交付。" }], checks: { customer: "绿川", amount: "48000", noSampleCustomer: "!蓝山", noSampleAmount: "!9999", keepUncertainty: "未定|没定|未确定|尚未|未明确" } },
  { id: "example-style", raw: "导出功能完成了，压测还在等待测试环境。", instruction: "整理工作进展，保持简洁。", examples: [{ input: "登录完成，支付等后端。", output: "进展｜登录已完成\n阻塞｜支付等待后端" }], checks: { imitateStyle: "进展[｜|]", blockers: "阻塞[｜|]", noSampleFact: "!支付|登录" } },
  { id: "english-template", raw: "告诉客户方案已收到，明天下午确认进度，不承诺周五上线。", instruction: "将口述整理为自然简洁的英文客户回复。只输出英文正文。", checks: { english: "[A-Za-z]{3}", friday: "Friday|friday", noGuarantee: "cannot.*(promise|guarantee|commit)|can.t.*(promise|guarantee|commit)|not.*(promise|guarantee|commit)|no.*(promise|guarantee|commit)" } },
  { id: "markdown-template", raw: "登录已完成，支付等后端，下周二继续联调。", outputFormat: "markdown", instruction: "使用 Markdown 二级标题组织为进展、阻塞、下一步。", checks: { heading: "## ", date: "下周二", login: "登录", payment: "支付" } },
  { id: "short-natural", raw: "不是取消，只是时间还没定。", instruction: "润色为一句自然正文，不加标题、栏目、待确认占位。", checks: { notCancelled: "不是取消|并非取消|并不是取消|并未取消|没有取消", uncertain: "没定|未定|未确定|尚未", noPlaceholders: "!待确认" } },
];
const selectedCases = cases.filter((item) => !option("--case", null) || item.id === option("--case", null));
if (!selectedCases.length) throw new Error("Unknown --case. Valid cases: " + cases.map((item) => item.id).join(", "));
const results = [];
async function requestModel(request) {
  const started = performance.now();
  const response = await fetch(endpoint, {
    method: "POST", headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({ model: request.model, messages: request.messages, temperature: 0.2, stream: false }),
    signal: AbortSignal.timeout(request.timeoutMs || 60000),
  });
  if (!response.ok) throw new Error(`Model HTTP ${response.status}`);
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("Model returned no text");
  return { text, durationMs: Math.round(performance.now() - started) };
}
for (const item of selectedCases) {
  for (const variant of baselineBuilder ? ["before", "after"] : ["after"]) {
    const skill = { id: `custom.eval.${item.id}`, schemaVersion: 2, name: item.id, instruction: item.instruction, outputFormat: item.outputFormat || "plain", missingInfoPolicy: item.missingInfoPolicy || "omit", examples: item.examples || [] };
    const started = performance.now();
    try {
      let result;
      if (variant === "before") result = await requestModel({ model: settings.textModel, messages: baselineBuilder({ instruction: skill.instruction, outputFormat: skill.outputFormat, rawText: item.raw }), timeoutMs: settings.textTimeoutMs });
      else {
        const pipeline = createPipeline({ invoke: async (command, payload) => command === "process_text" ? requestModel(payload.request) : undefined });
        result = await pipeline.preview({ settings, skill, rawText: item.raw });
        if (!result.ok) throw new Error(result.error || "Pipeline failed");
      }
      const checks = Object.fromEntries(Object.entries(item.checks).map(([name, pattern]) => [name, pattern.startsWith("!") ? !new RegExp(pattern.slice(1), "i").test(result.text) : new RegExp(pattern, "i").test(result.text)]));
      results.push({ case: item.id, variant, input: item.raw, output: result.text, ms: Math.round(performance.now() - started), checks, passed: Object.values(checks).every(Boolean) });
    } catch (error) { results.push({ case: item.id, variant, input: item.raw, error: String(error.message).replaceAll(apiKey || "__NO_KEY__", "[redacted]"), errorCode: error.cause?.code || null, ms: Math.round(performance.now() - started), passed: false }); }
    const current = results.at(-1);
    console.log(`${variant} ${item.id}: ${current.passed ? "PASS" : "CHECK"} ${current.ms}ms${current.error ? ` ${current.error}` : ""}`);
  }
}
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify({ evaluatedAt: new Date().toISOString(), model: settings.textModel, endpointOrigin: new URL(endpoint).origin, fixtureType: "synthetic text, no ASR", temperature: 0.2, notes: "Regex checks are targeted checks, not a complete semantic-quality score. Review outputs manually.", baseline: Boolean(baselineBuilder), results }, null, 2));
console.log(`Saved ${results.length} model request attempts to ${outputPath}`);
if (results.some((r) => r.error)) process.exitCode = 1;
