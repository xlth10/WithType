# 从 Typeless 借鉴长文本整理：机制、差距与优先级

日期：2026-10-10。依据本机 Typeless 2.8.1 静态分析与当前 Typefree Windows 源码。没有调用模型、读取用户密钥/实际服务配置或进行速度基准；没有修改产品代码。`vibevoice-windows` 是参考源，本次性能判断以当前 Typefree 项目为准。

2026-10-11 更新：用户已授权实施，最新变更见 [长文优化说明](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/long-text-optimization.md)。以下保留实施前的研究基线，源码行号是当时的位置。

## 判断

最值得借鉴的是从录音开始就组织处理会话、减少停止录音后的串行等待、按文字任务选择模型，以及有边界地使用上下文。用户观察到的 Typeless 长文速度优势成立为体验反馈，但目前不能从客户端包证明它采用了某个模型、边录边整理或某种推测解码技术。

当前项目有明确可改善的结构：ASR 已边录边识别，但文字整理等全部 ASR 完成才启动；普通整理只走主模型、全文非流式返回；超长输入有裁尾风险；现有耗时统计混合了重叠阶段。因此提速应同时关注真实停止后等待、全文完整性与模型输出效率，不能只增加 skill 和上下文字段。

## 1. Typeless 已确认的机制及可借鉴边界

| 已确认机制 | 借鉴方式 | 尚不能推断 |
| --- | --- | --- |
| 录音开始即发送 start_audio，上下文与音频分块属于同一 audio_id；后续 replace_audio_context 补充信息 | 尽早建立任务状态、传输必要信息，让独立工作与录音重叠 | WebSocket 不等于模型推理更快，也不证明它录音中已完成文字整理 |
| 快速上下文快照与异步 AX 扩展分开，保留开始时的选区/光标 | 上下文采集不要串行阻挡主要处理；skill 声明需要哪些字段，由宿主提供 | 更多上下文不会自动提高速度；字段发送也不证明服务端消费 |
| 模式参数明确区分 transcript / ask_anything / translation；命令模式单独提供选区 | 按任务设定处理契约、必要上下文与输出方式，减少额外的意图/路由调用 | 无法据此识别其服务端提示词、模型或路由策略 |
| 协议分别返回 transcription 与 refine 结果；HTTP 回退保留同一任务信息 | 识别状态、整理状态、完整结果与失败回退分别管理 | 已有结果类型不能证明最终成稿是逐段生成或逐段输入 |

证据见 [Typeless 上下文与处理链路报告](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/typeless-context-and-processing-analysis.md)，J-/R- 锚点及原生调用记录在该报告对应索引中。

## 2. 当前项目停止录音后实际发生什么

当前正式 Windows 路径是：

```text
录音中：采集 → 找停顿 → 串行提交 WAV → 缓存分段识别结果
停止后：等待在途 ASR → 识别尾段 → 拼接全文
        → 可选意图分类 → 全文文字整理 → 等完整响应 → 最终词库纠正 → 一次粘贴
```

这不是“所有识别都在停止后才开始”。录音中已提交 ASR，但文字整理尚未与录音重叠。`capture_loop` 最后等待在途结果并提交尾段，`stop_audio_session` 等工作线程结束；前端 `recorder.stop()` 返回后才执行 pipeline 的文字阶段。源头见 [音频提交](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/audio.rs:623)、[尾段收尾](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/audio.rs:659)、[停止线程](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/audio.rs:815)、[前端串行入口](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/App.jsx:684)。

**文字阶段的明确差距：**

- `textFastModel` 只覆盖意图分类和翻译，`smart` 使用主模型。填写快速模型不会改变普通长文整理的速度。[路由](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/dictation/pipeline.js:165)
- `smart` / `skill` 用 stream=false，等完整响应正文后才返回。问答已有 SSE，但接口目前只允许 ask。[非流式请求](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/text_api.rs:192)、[完整响应](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/text_api.rs:274)、[流式限制](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/text_api.rs:483)
- 普通智能整理通常只有一轮文字请求；autoIntent 默认关闭。开启它后增加一轮串行分类，不能把这一步归因于所有用户的慢体验。[默认配置](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/text/settingsMigration.js:40)、[分类分支](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/dictation/pipeline.js:320)
- 备用模型按顺序等待，每次有独立超时，尚无整个整理阶段的总时间预算。这主要影响失败与尾部时延，不解释正常请求的全部慢体验。[备用模型](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/dictation/pipeline.js:168)
- 文字 Client 已复用；ASR 每次请求新建 Client，是不同路径的改进机会。复用连接池可减少建连开销，实际收益待测。[文字 Client](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/text_api.rs:82)、[ASR Client](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/lib.rs:381)、[reqwest 官方说明](https://docs.rs/reqwest/latest/reqwest/struct.Client.html)

模型请求没有显式推理开关或输出 token 预算，但实际模型/服务由用户配置。本次没有读取这些配置，不能认定服务正在执行额外思考，也不能认定模型太大。当前智能整理提示词是固定的整理约束，没有发送输入框或窗口上下文；没有证据把慢归因于“上下文过多”。更多细节见 [文字整理源码核查](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/typefree-text-latency-code-notes.md)。

## 3. 第一优先级：完整性与测量

**长文完整性需要先保证。** `runTextStage` 仅将前 12,000 个 JS UTF-16 单元送去模型，成功后用结果替换整个 finalText，没有拼回尾部。不能以这种裁剪取得看似更快的结果；应对全部输入设计分段处理，或明确回退全文原文。[输入裁剪](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/dictation/pipeline.js:194)、[整体替换](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/dictation/pipeline.js:374)

**当前显示的耗时不能直接代表用户停止后等待。**

- App 把整个 `await recorder.stop()` 记为 encodeMs，正式 Windows 路径中这段已经含在途/尾段 ASR 等待。
- native asrMs 累加成功分段的请求时间，含录音中已经完成的请求，不等于停止后剩余识别时间。
- 历史总耗时把 encodeMs + asrMs + textMs + pasteMs 相加，会包含重叠与重复部分；启用时的意图分类耗时又没有纳入 textMs。

证据：[编码记账](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/App.jsx:695)、[ASR 累加](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/audio.rs:407)、[历史总耗时](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/App.jsx:796)、[分类计时](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/dictation/pipeline.js:216)。

应增加独立时点：停止按键、完整 ASR 到达、分类开始/结束、文字请求开始、首个正文 token、完整成稿、粘贴完成。核心指标分别为停止到完整成稿、停止到粘贴完成、文字首字等待与整篇生成时间；阶段重叠不能用简单相加表达。

## 4. 值得实施的方向与顺序（建议，尚未实施）

| 顺序 | 方向 | 如何作用于长文 | 质量/实现边界 |
| --- | --- | --- | --- |
| P0 | 全文保留 + 真实停止后计时 | 建立可靠基线，排除裁尾与错记时间 | 不用删正文或改成摘要换速度 |
| P1 | 为 smart 设置专用低延迟模型路由 | 让普通纠错/分段使用适合该任务的模型；复杂 skill 单独选择 | 用同一文本比较速度与数字、否定、术语保真；服务支持时才设置推理参数 |
| P1 | 控制失败总预算，减少额外分类请求 | 避免多次完整超时叠加；已有明确模式时无需再问模型意图 | 保留取消和普通口述原文回退；不默认新增付费模型竞速 |
| P1 | ASR 连接复用 | 在分段 HTTP 路径减少重复建连开销 | 文字服务已有这一能力；正常推理占主导时收益可能较小 |
| P2 | 录音中整理已稳定段落 | 把部分文字工作提前到说话期间，停止后主要处理尾段 | 独立于音频回调，限制并发；段编号和原文必须保留，处理后续自我修正与跨段衔接 |
| P2 | 整理结果流式预览 | 更早显示实际文字，消除整篇生成期间的空白等待 | 流式本身不保证完整成稿更快；目标应用仍可保持一次粘贴 |
| P3 | 少量改动的校对探索预测输出/编辑补丁 | 避免逐 token 重写大量不变内容 | 仅用于小幅修改，结构重写不套用；依赖服务能力、成本和严格应用校验 |

普通整理的增量方案可先做小实验：缓存已确认的 ASR 段 → 用少量前文处理当前段 → 留下未定尾段 → 结束后处理尾段与必要衔接。若最后仍再调用模型全文重写，会把主要生成成本重新加回来。会议纪要、汇报等需要全文规划的 skill，应保持完整信息后再规划，不能盲目按句独立处理。这是我们的设计推论，不是已逆向确认的 Typeless 做法。

长文整理常需保留接近原文长度的输出，因此减少提示词并不等于解决全文生成成本。模型生成速度、输出量与串行请求数值得优先测量，符合 [OpenAI 官方延迟指南](https://developers.openai.com/api/docs/guides/latency-optimization) 的通用原则；没有将其经验比例当成本项目保证。

流式允许在生成完成前开始展示或处理输出，见 [官方流式说明](https://developers.openai.com/api/docs/guides/streaming-responses)。在我们的输入法里，首字可见和整篇最终可粘贴必须分别测量。

当大部分输出已知、只有少量修改时，已有 [Predicted Outputs 官方案例](https://developers.openai.com/api/docs/guides/predicted-outputs) 利用原文作为预测来降低生成延迟。该能力仅限支持它的模型/API，并可能增加部分费用；本次只作为成熟技术思路，未建议将私有兼容服务当成默认支持，也未证明 Typeless 使用了它。

## 5. 上下文与 skill 如何配合

上下文主要服务于任务准确性和输出适配。可借鉴 Typeless 的结构化采集、开始时快照和异步补充，但每个 skill 应只索取必要字段，例如选区改写使用选区，续写使用光标前文，应用适配使用应用身份。普通长文清理可先只使用原始口述。

宿主负责采集、会话、质量标记、请求调度与文字投递；skill 定义任务和必要上下文。采集器无需阻挡轻度整理，也不把所有窗口文字无差别塞进每次请求。本项涉及现有“输入框上下文不发送给模型”的产品边界，若进入实现阶段，需要先在研究基线中明确范围。

## 6. 建议的验证矩阵

- 文字阶段单测：同一段 ASR 文本，100 / 500 / 1,500 / 5,000 字及超过当前 12,000 上限的样本；包含数字、否定、自我纠正、专有名词和多段结构。
- 端到端测试：固定音频，区分有停顿与连续说话，记录停止按键后的真实等待；以 Typeless 的实际成稿作为参考，分别记录最终速度、全文覆盖和改动质量。
- A/B 顺序：当前主模型 → smart 专用模型 → 流式预览 → 稳定段提前整理。先固定输入、服务和任务，再比较一项变化，避免同时更换模型和流程无法归因。
- 输出指标：p50 / p95、首字和完整成稿时间、请求次数、token usage（服务提供时）、是否裁尾、是否改错数字/否定/术语。

目前没有上述实测数据；不声明任何优化能达到固定秒数或倍数。源码结论用于确定第一轮改造与测量位置，Typeless 的服务端吞吐、排队、模型与具体增量策略仍未知。
