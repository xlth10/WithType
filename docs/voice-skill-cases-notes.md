# 语音输入中的 Skills / Modes：一手案例笔记

调研日期：2026-10-09（Asia/Shanghai）。只采用官方产品文档、官方更新日志和上游仓库。下文“公开可用”仅指一手资料提供功能与操作说明；未做产品实测，不能据此推断活跃用户规模、成功率或市场成熟度。无发布日期的页面均以本次访问时内容为准；GitHub `main` 是可变引用。

## 核心判断

目前已有可直接借鉴的三种产品形态：①持久写作模式，②对选中文本做一次语音编辑，③把完成的文本交给预设工具。它们分别对应 Superwhisper、Aqua、VoiceInk，不能统称为一个任意执行的 LLM skill。下表仅归纳后文已核实的功能。

| 案例 | 主要形态 | Windows | 证据强度 / 状态 |
|---|---|---|---|
| Superwhisper | 自定义 prompt + mode + 明确上下文源 | 支持 | 正式公开文档；Windows 文档明确包含 custom modes |
| Aqua Voice | 写作规则 + 选区语音编辑 + undo | 支持 | Edit Mode 有 2026-07-20 版本日志 |
| Wispr Flow | 上下文适配 + 命令编辑 | 支持，context 部分能力受限 | Command Mode 仍在 Experimental 开关内 |
| VoiceInk | mode 路由 + prompt + 独立输出 command | 未找到 Windows 官方版本 | 正式公开文档和上游开源仓库；桌面范围为 macOS |
| OpenWhispr | 独立 voice agent / chat agent 路径 | 支持 | 公开操作文档及可检视上游实现；未据此判断稳定性 |

## 1. Superwhisper：最接近当前“Skill 是一个文本处理配方”

- **处理契约与上下文：**Custom Mode 对每次 dictation 应用用户 instructions；可以独立启用 Application、Copied text、Selected text，并在 prompt 中明确引用它们。还提供输入/输出示例。该页面描述的是生成结果的处理，不应据此宣称其可任意调用外部工具。[Custom Mode](https://superwhisper.com/docs/modes/custom)
- **触发：**支持快捷键循环切换、菜单、app/website 自动切换和 deep link。自动模式解决“当前在哪个应用”这个稳定信号；快捷键提供临时覆盖入口。[Switching Modes](https://superwhisper.com/docs/modes/switching-modes)
- **纠错与回退：**History 保存音频、转录和 AI 结果，可以不重录而换模式再处理，适合排查 prompt 或路由错误。[History](https://superwhisper.com/docs/get-started/history)
- **Windows 实证：**官方明确 Windows 10/11 的 x64、ARM64 支持，custom modes 包含在通用功能内；但 coding-agent 集成和 CLI 等尚不提供。不能把 Mac 集成页承诺照搬到 Windows。[Windows 文档](https://superwhisper.com/docs/get-started/windows)
- **可借鉴判断（推论）：**为每个 skill 加“输入来源”和 examples，比不断加长 instruction 更有价值。局限是产品文档没有给出模式误触发率；app/site 自动匹配不等于任务语义自动判断。

页面未显示更新时间，以上是访问时状态。

## 2. Aqua Voice：最值得借鉴的是编辑闭环

- **写作规则：**Custom Instructions 支持邮件格式、标点、地域拼写和冗词处理；官方推荐按条列规则并给正确/错误输出示例。这是持久写作偏好。[Custom Instructions](https://aquavoice.com/guide/custom-intructions)
- **触发、回退与范围：**选中文本后按通常的 Aqua key，说修改要求；无选区走普通听写。能多轮编辑并 undo；无法判断意图时不改选区，显示 `Try rephrasing`。地址栏、搜索框和超过 6,000 字符的选区回到 dictation。编辑记录包含原文、结果和说过的话。页面明确 Mac/Windows 桌面版可用。[Edit Mode](https://aquavoice.com/edit-mode)
- **发布日期：**更新日志记录 Edit Mode 在 2026-07-20 的 0.17.0 发布到 Mac/Windows；2026-07-29 为“send it”增加 Paste Only 等完成动作选择。[Changelog](https://aquavoice.com/changelog)
- **可借鉴判断（推论）：**把“已选择文本”作为强意图信号，允许沿用一个按键，同时展示“将修改哪个选区”；保存编辑版本，支持恢复原文。它优于仅向 LLM 提问“这句话像不像命令”。“send it”是特定提交动作，不构成通用 skill 工具系统。

注意：Edit Mode 宣传页说默认可用，另一篇官方写作页提到 Settings 的 Select to Edit；默认开关语义存在页面差异，实施时应实测确认。[Voice writing](https://aquavoice.com/voice-writing)

## 3. Wispr Flow：可学输入/命令分离，但命令功能仍标 Experimental

- **状态与触发：**官方 Command Mode 页面更新于 2026-09-20，要求付费计划及 Settings → Experimental 开关；Windows 默认 `Ctrl + Win + Alt`，按住录音、松开执行，ESC/Backspace 取消。网页搜索命令有特定英文动词和目标站点规则；文本编辑没有原文/选区时不动作，失败可能不显示错误。因此不能把它写成成熟任意工具调度器。[Command Mode](https://docs.wisprflow.ai/articles/4816967992-How-to-use-Command-Mode)
- **上下文：**2026-09-01 文档说明读取光标周围文本并将 app 分为邮件、工作聊天、私人聊天和其他；Windows 为 partial，conversation context、element descriptions 与 IDE-specific handling 尚仅 Mac 支持。[Context Awareness](https://docs.wisprflow.ai/articles/4678293671-feature-context-awareness)
- **纠错与回退：**Backtrack 利用整段 dictation 判断明确自我纠正；桌面 Recent Activity 可恢复原始听写再复制粘贴。格式化失败则粘贴未格式化 transcript。该页面只标相对更新时间，访问时为“3 days ago”。[Smart Formatting & Backtrack](https://docs.wisprflow.ai/articles/5373093536-How-do-I-use-Smart-Formatting-&-Backtrack)
- **可借鉴判断（推论）：**保留原始转录和单独命令键，保证失败仍有可恢复文本；需要显式失败提示。它恰好说明拥有付费正式产品，不代表其每项 agent 功能都已结束试验阶段。

## 4. VoiceInk：最清晰的“路由—增强—输出动作”分层

- **触发：**Mode 可按 app、website、录音专属快捷键、语音开头/末尾词匹配。语音 trigger 在 ASR 后移除并更换处理模式，不会用新模式的 ASR 模型重转录；多个网站规则按第一个匹配决定。这是明确、可测试的路由规则。[Mode Triggers](https://tryvoiceink.com/docs/mode-triggers)
- **处理层：**prompt 与 mode 分开；默认系统模板承担通用听写清理，自定义 prompt 只需定义场景。关闭模板才能完全控制改写或问答；Refine 是固定清理任务，不接受自定义 prompt。[Prompt Management](https://tryvoiceink.com/docs/prompt-management)
- **上下文：**选区、录音开始时剪贴板、当前窗口 OCR 文本分别带标签；screen OCR 在本地执行，提供给模型的是提取文本。[Context Awareness](https://tryvoiceink.com/docs/context-awareness)
- **执行层与回退：**Custom Command 是 output mode：把最终文本以 stdin 和 `VOICEINK_TRANSCRIPT` 交给用户预设命令；AI 增强失败时交非增强文本。shell 为 `/bin/zsh -lc`，10 秒超时，退出码用于诊断；stdout 不作为改写结果粘贴，且 UI 没有成功/失败提示。这是真实外部执行功能，但命令本身由用户配置，不是 LLM 临时编造 shell。[Custom Commands](https://tryvoiceink.com/docs/custom-commands)
- **平台与代码：**公开安装文档限定 macOS；源码位于上游 VoiceInk 仓库，许可 GPLv3。这里未检查其每个实现路径，不能据源码公开推断所有文档功能在任一旧版本可用。[Installation](https://tryvoiceink.com/docs/installation)、[上游仓库](https://github.com/Beingpax/VoiceInk)
- **可借鉴判断（推论）：**本项目可将 skill 输出从字符串扩展成“文本 + delivery target”，保持文本增强与副作用执行分开。执行层需要失败提示和目标窗口标识；照搬无提示 shell hook 会留下排错盲区。

上述官方文档未显示发布时间，仅记录访问时状态。

## 5. OpenWhispr：输入法内的 one-shot agent 与对话工具分开

- **Voice agent：**独立 hotkey 直接表示指令，支持改写选区；可选截图上下文默认关闭，截图只用于当前 request。模型/agent 未配置时返回原始 transcript；调用失败显示 `Agent Unavailable`，截图跳过另有提示。其 system prompt 可自定义。[The voice agent](https://docs.openwhispr.com/help/agent/voice-agent)
- **名字触发：**agent name 在句首、问候后或新句子开头才算寻址；支持容错拼写和拆词，但官方承认容错会带来近似词误触发，建议选不易日常说出的名字。关闭 agent 会同时关闭名字与 hotkey 路径。[Your agent's name](https://docs.openwhispr.com/help/agent/agent-name)
- **工具层：**另一个 Chat agent 留在 overlay 和历史中，具有搜索/读写 notes、clipboard、web search、calendar 这组列明的工具；工具有登录/连接条件并显示执行状态。不能把 voice agent 的文本插入能力混称为任意应用控制。[The chat agent](https://docs.openwhispr.com/help/agent/chat-agent)
- **Windows 与实现：**官方 Windows 文档列 Windows 10+ x64、native hold-to-talk 和剪贴板恢复。`ReasoningService.ts` 包含独立推理 scope、abort controller 和 tool-call / tool-result 流事件等实现，说明可以检查运行路径；本次只检视局部源码，未对发布二进制做测试。[Windows](https://docs.openwhispr.com/platform/windows)、[ReasoningService.ts](https://github.com/OpenWhispr/openwhispr/blob/main/src/services/ReasoningService.ts)
- **可借鉴判断（推论）：**先支持用户明确调用某个处理路径，并将快捷文本任务与长对话/工具任务分开。容错语音名字不适合承担高后果操作的唯一授权信号。截图上下文和失败提示可用作本项目补齐 context/fallback 的参考。

官方帮助页无发布时间；源码是访问时 `main`，以上不代表历史版本或端到端稳定性验证。

## 对当前项目的建议（设计推论）

依据主线程已核实的本地现状：skill 当前主要是 `instruction + outputFormat`，通过持续选择/第三键选单调用；没有上下文进入 skill LLM，也没有 named-skill dispatch；autoIntent 默认关闭且只区分 dictation/command。下面是建议，不是外部产品现成功能的逐字移植。

1. 优先形成 **明确调用 → 有来源的上下文 → 文本处理 → 可恢复输出** 的闭环。先做命名技能的确定性别名、单次作用范围和输入/输出示例。
2. 把“写作模式”“选区编辑”“外部动作”分成不同执行契约。普通听写默认遵守内容保真，选区编辑返回可 undo 的 patch，工具执行走有 schema 的固定适配器。
3. 将“选区存在”“专属键”“明确别名”作为主要意图证据；LLM 的自报 confidence 可作辅助，不能替代可回放评测。
4. 失败时保留原始 ASR、处理前文本、选中的 skill 和上下文来源。对于编辑不确定，保持原文并给改说提示；普通听写的增强不可用时返回 transcript；明确命令或外部动作失败时保留现场并报错，避免自动输入指令句。
5. 验证顺序建议是邮件整理、忠实技术输入、选区翻译/改写三项小任务，再扩展工具输出。先测误路由率、意义保真、可恢复率和延迟，避免用“skill 数量”衡量成熟度。
