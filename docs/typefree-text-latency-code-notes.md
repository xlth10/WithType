# Typefree Windows 文字整理时延：源码核查

日期：2026-10-10。只读核查当前项目源码；未调用模型、未读取用户密钥或实际配置。本文聚焦文字模型阶段，音频停止与投递链路由主报告覆盖。

2026-10-11 已进入实施，见 [长文优化说明](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/long-text-optimization.md)。本文保留旧实现作为研究基线，源码行号是当时的位置。

## 范围与结论

[当前 README](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/README.md:1) 将 Typefree Windows 定义为当前开发项目，`/Users/outsider/SEVB/VA/vibevoice-windows` 是快捷键、动效与构建参考源。因此以下性能判断以当前 Typefree 源码为基准，不把两个目录当成同一运行版本。

普通长文整理目前是“ASR 成稿 → 一次全文文字请求 → 等待完整响应 → 投递”。快速模型没有覆盖智能整理，智能整理没有流式结果或分段处理，备用模型顺序尝试。文字服务已经复用 HTTP Client；连接池重建不是这条文字路径中明显的重复开销。ASR 路径另有每段新建 Client 的实现，由主报告区分。Typeless 的实际模型、推理策略、服务端排队与整理开始时点无法从这些源码确认，不能据此量化双方差距。

## 已确认的实现

| 项目 | 当前行为与证据 | 性能含义 |
| --- | --- | --- |
| 模型与服务 | `textEndpoint`、`textModel` 默认留空；用户配置服务与模型，代码没有固定整理模型。[配置](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/text/settingsMigration.js:32) | 无法仅靠源码判断用户体验慢在具体模型、服务负载还是网络。 |
| 普通整理请求 | `smart` / `skill` 调用 `process_text`，只有 `ask` 在桌面调用 `stream_answer`。[路由](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/dictation/pipeline.js:165) | 整理过程没有首字可见的进展；所有输出生成完才返回。 |
| 完整响应等待 | ChatRequest 固定 `temperature: 0.2, stream: false`；`post_chat` 使用 `response.text().await` 后解析正文。[请求](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/text_api.rs:192)、[读取](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/text_api.rs:274) | 长文需要重写整篇，客户端等待全部输出；并非已在边生成边投递。 |
| 快速模型 | `textFastModel` 只用于 `intent`、`translate`；`smart` / `skill` 仍先用主模型。[路由](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/dictation/pipeline.js:167)、[界面说明](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/components/TextSettings.jsx:125) | 填了快速模型并不能提高当前普通长文整理速度。 |
| Token / 推理参数 | 出站 ChatRequest 仅有 `model/messages/temperature/stream`。未设置 `max_tokens`、`max_completion_tokens`、`reasoning_effort`、`enable_thinking` 或 prediction。[结构](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/text_api.rs:133) | 无客户端输出 token 预算；是否启用额外思考取决于所用服务，不能从“没设置”断言正在思考。 |
| 本地输出上限 | 解析结果后才截取最多 60,000 Rust char。[上限](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/text_api.rs:25)、[解析](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/text_api.rs:209) | 这是收到结果后的裁剪，不是请求预算，不能降低之前的服务端生成量。 |
| 提示词与上下文 | `buildMessages` 只构造 system 整理要求和 user ASR 原文；智能整理 system 是 `SMART_INSTRUCTION`，用户输入放在标记内。没有输入框、选区、当前应用或窗口标题字段。[消息](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/text/builtinSkills.js:50)、[智能整理指令](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/text/builtinSkills.js:205) | 当前长文请求的主要动态输入是全文 ASR 文本；无“上下文太多导致慢”的证据。不能把上下文采集作为首要提速方案。 |
| 串行依赖 | ASR 返回后才进入 `finishTask`；智能整理等待 `runTextStage` 完成，再替换 `finalText` 并交付。[ASR 后](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/dictation/pipeline.js:279)、[整理](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/dictation/pipeline.js:359) | 没有录音中提前整理已稳定段落，也没有分段整理并合并。 |
| 备用模型 | 主模型加最多 5 个备用模型去重，`for` 中逐个 `await`；仅超时、连接、配额及若干 5xx/429 失败继续。[实现](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/dictation/pipeline.js:168) | 增强恢复能力，不能当成提速竞速；最坏等待可随失败模型数累加。 |
| 超时 | 每次尝试都使用同一个 `textTimeoutMs`，默认 60 秒，范围 3–300 秒；未见整个多模型阶段的总截止时间。[配置](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/text/settingsMigration.js:36)、[钳制](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/text_api.rs:185) | 在配置多个失败服务模型时，60 秒不是整个整理阶段的总上限。 |
| 自动判断意图 | 默认关闭；打开后，ASR 后先等待一次分类，再等待整理或生成。[默认](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/text/settingsMigration.js:40)、[调用](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/dictation/pipeline.js:320) | 启用时增加一轮串行模型请求。分类时长没有单独写入 `timings.textMs`；`classifyIntent` 的 started 变量最后被丢弃。[分类](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/dictation/pipeline.js:216) |
| 文字服务 Client 复用 | `OnceLock<reqwest::Client>` 保存单一 Client；连接超时 10 秒。[实现](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/text_api.rs:33) | 不应将“每次新建 Client”列为当前文字路径待修问题。实际服务是否保持连接仍需要运行证据。 |
| 流式能力现状 | 问答已有 SSE parser，支持 delta content 和 answer-stream 事件；stream_answer 明确拒绝非 ask 任务。[流式](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/text_api.rs:300)、[限制](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/text_api.rs:483) | 可作为整理预览的实现参考，但当前尚未覆盖整理。若依旧一次性粘贴，流式本身不缩短最终成稿时点。 |
| 现有计时 | `runTextStage` 用整个 await 的墙钟时间填 `textMs`，包含备用模型失败等待；返回 `durationMs` 未用来拆分服务时间。[计时](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/dictation/pipeline.js:194) | 没有首 token 时延、输出 tokens/sec、usage、finish_reason 或模型尝试次数记录。当前 Rust 只取 content，未提取这些字段。[解析](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/text_api.rs:209) |

## 长文完整性风险，不能用来换速度

前端 `MAX_TEXT_CHARS=12000`，`runTextStage` 对原文做 `slice(0,12000)`（JS UTF-16 code unit），只把前半部分送入消息。成功后，`finishTask` 以模型结果替换整条 `finalText`，没有拼回剩余原文。因此超过上限的文本可能在整理成功时丢掉尾部。[裁剪](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/dictation/pipeline.js:197)、[整体替换](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/dictation/pipeline.js:374)

Rust 的二次 `raw_text.chars().take(12000)` 只改变 `raw_text` 字段，`build_chat_request` 实际发送 `request.messages`，没有重新组装消息；它不能独立保证 API messages 的输入上限。目前正常前端路径的上限主要由前端实现。[Rust 裁剪](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/text_api.rs:470)、[消息来源](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/text_api.rs:195)

这属于静态可确认的完整性风险，未执行超长真实请求复现。应先保留全文，再设计分段；不能把当前裁掉尾部视为有效的长文提速策略。

## 建议的顺序与边界

1. **先修测量与完整性**：补录音停止时点、文字阶段开始/首字/完成时点、使用模型与尝试次数、输入输出长度，并按 100/500/1500/5000 字比较停止后的 p50/p95 等待；启用意图分类时单独计时。超长文本明确处理全部内容或按原文返回，不能静默裁尾。现有编码/ASR 字段重叠问题见主报告。
2. **让“普通整理”成为专门的低延迟任务**：在质量基准上选择适合轻度纠错、分段的模型；允许 smart 使用独立快速配置。若服务支持，按该服务契约明确推理开关和输出预算，不能给所有兼容服务硬塞同一厂商参数。预算需保证全文重写完整，配合 finish_reason 检查。
3. **减少停止后的工作量**：研究稳定句段先整理，保留原文/段编号/未定尾段；结束时只处理最后部分与必要的跨段衔接。避免每段整理后再进行一次全文大改写，否则又重新生成整篇。并发数量有上限，仍需保护后续口述自我修正、代词指向、数字与否定；结构性 skill 需要全文规划，不能简单套逐句方案。
4. **流式用于可见进展**：复用问答 SSE 能力给整理预览或稳定段反馈。先显示并不能自动解决完整成稿速度；逐段直接写入目标窗口需要可控的插入/回滚语义，不能照搬聊天气泡。
5. **给失败恢复总预算**：保留顺序备用模型，但增加阶段总截止时间与剩余预算，避免每个模型完整等待一次超时。未经质量、费用与取消评测，不默认增加并行模型竞速。

OpenAI 的[官方延迟指南](https://developers.openai.com/api/docs/guides/latency-optimization)支持优先关注模型生成速度、输出量、请求次数和流式进展的通用思路。它是优化参考，不证明 Typeless 使用这些技术，也不保证任意 OpenAI 兼容服务支持相同参数。

## 尚不能确认

- 实际配置模型的推理模式、生成吞吐、队列等待、网关冷启动与用户网络延迟。
- Typeless 是否边录音边整理、是否做全文重写、是否用推测解码/预测输出、使用什么模型或提示词。
- 用户主观感受中识别、整理与投递各自贡献多少；需要同一段输入和独立时点证据。
- 本次没有基准数据，因此没有声称某项优化可带来固定倍数提升。

参考源 `vibevoice-windows` 的文字请求同样只有 model/messages/temperature/stream；较旧 pipeline 只有一个 textModel，不包含当前项目的快速/备用模型与问答流式路由。[参考请求结构](/Users/outsider/SEVB/VA/vibevoice-windows/src-tauri/src/text_api.rs:83)、[参考路由](/Users/outsider/SEVB/VA/vibevoice-windows/src/dictation/pipeline.js:124)。这些差异仅用于区分来源，不用于替代当前项目结论。
