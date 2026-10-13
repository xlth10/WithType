# 语音输入法中的 Skill：案例、现有差距与演进建议

调研日期：2026-10-09，Asia/Shanghai。

范围：本项目现有 Skill 实现、语音输入产品的自定义模式和命令、选区编辑，以及与 Agent Skills 的关系。依据为本地源码、官方帮助文档、产品更新日志和一手仓库；未安装或实测外部产品，未调用本项目的真实模型服务。下文“公开功能”表示存在具体操作说明，不代表成功率、中文体验或市场规模已经验证。无更新时间的页面按访问时内容记录。

## 1. 结论

有可借鉴的公开产品案例，最接近本项目的是 **Superwhisper 的自定义模式、闪电说的场景技能、Aqua 的选区语音编辑**。真正值得学习的是技能如何被调用、得到哪些输入、产出什么，以及出错后如何恢复。

本项目已有可用的文字处理基础，但 Skill 目前主要是一段整理提示词。建议先把它发展成有明确调用方式、输入契约和样例的“语音处理配方”，补齐选区编辑与恢复闭环；外部工具执行作为独立路径研究。本次未找到能证明“任意口述自动选择任意技能并稳定执行任意桌面任务”的通用成熟方案。

以上是基于本次案例与本地实现的设计判断，具体证据如下。

## 2. 当前项目实际做到了什么

| 方面 | 已有实现 | 对体验的影响 |
| --- | --- | --- |
| 技能定义 | 名称、说明、instruction、plain/markdown、版本和启用字段；内置邮件、汇报、会议纪要、开发需求四种模板 | 适合固定文本整理；未提供技能级输入来源、适用场景结构或保存的输入/输出样例 |
| 调用 | 普通口述持续使用一个技能；第三个快捷键单次使用一个预选技能 | 每次切换任务仍需改设置；没有点名调用任意技能的路由 |
| 自动分流 | 默认关闭；模型只判断 dictation/command，并检查其自报 confidence ≥0.85 | 没有选择具体 skill；0.85 是筛选条件，不能视为已验证的 85% 正确率 |
| 上下文 | 开始时捕获活动窗口身份，但仅用于本地历史 | 技能模型只看到口述，无法理解“改一下这段”“按这封邮件回复”中的具体对象 |
| 成稿 | 请求模型返回字符串，plain/markdown 是提示词要求 | 没有独立的栏目/关键事实检查；在当前路径中，非空结果即可进入后续投递 |
| 恢复 | 原文保留、请求取消、过期结果拦截、服务失败处理、编辑器预览 | 基础可靠性已有设计；尚缺成功结果换技能重跑、选区修改版本和恢复原文的产品入口 |

源码依据：[技能定义与消息组装](../src/text/builtinSkills.js)、[技能编辑器](../src/components/SkillEditor.jsx)、[任务流水线](../src/dictation/pipeline.js)、[默认设置](../src/text/settingsMigration.js)、[应用入口](../src/App.jsx)、[文字请求契约](../src-tauri/src/text_api.rs)。

两处具体问题值得优先验证：

- **模板约束偏重。**邮件必须四部分，汇报必须四部分，开发需求必须六部分，缺失统一写“待确认”。这能形成完整文档，但短句、聊天回复或只补充一个进展时容易增加用户未需要的栏目。这是从提示词推断的体验风险，尚未做模型效果测试。
- **命令与分类请求混入整理语义。**`buildMessages()` 只特殊处理 smart/ask/translate；command 和 intent 会继承“只做文字整理”的边界，而且 user 消息要求把口述当数据，不当指令。与此同时 command 要按口述生成内容，intent 要返回分类 JSON。代码里的要求存在冲突；应分别定义任务消息，再用真实服务确认效果。见 [消息组装](../src/text/builtinSkills.js:50)、[分类请求](../src/dictation/pipeline.js:216)。

当前关于提示词的单元测试主要检查消息结构和字符串是否存在，流水线测试使用模拟模型响应；这些检查有用，但不能证明模型保真、路由准确或模板适合真实使用。见 [Skill 测试](../tests/skill-schema.test.mjs)、[流水线测试](../tests/pipeline.test.mjs)。

## 3. 重点案例

### 闪电说：把风格与场景技能分开

官方将日常听写的清理程度和自定义 Prompt 放在“风格”；“技能”用于“帮我说”，描述适用场景、上下文、处理方法和输出。技能说明强调 description 的适用条件，并公开了跨语言沟通、客服回复的写法；个人技能通常保存为文件夹中的 `SKILL.md`。[风格文档](https://shandianshuo.cn/docs/beginner/style)、[技能文档](https://shandianshuo.cn/docs/beginner/skills)

入口也有任务差异：短按进行普通听写，长按结合上下文生成表达；官方入门文档给出了选中文本修改、结合聊天回复，以及打开网站等不同用途。[入门指南](https://shandianshuo.cn/docs)

**适合借鉴：**日常“忠实清理/技术表达”作为写作风格；“整理周报/客服回复”作为明确任务技能。技能需要知道何时适用和处理对象，不能仅是一个输出模板。公开文档没有提供误触发或中文效果数据；也不能由 `SKILL.md` 文件形式推断其兼容全部 Agent Skills 生态。本项目既定的按一次开始、再按一次结束可以保留，借鉴任务分工即可。

### Superwhisper：自定义模式的完整使用链路

Custom Mode 支持自定义要求、输入/输出示例，并分别选择应用、复制文本、选中文本等上下文。模式可以通过快捷键、菜单、应用/网站规则和 deep link 切换；历史可以换模式重新处理，不必重录。[Custom Mode](https://superwhisper.com/docs/modes/custom)、[Switching Modes](https://superwhisper.com/docs/modes/switching-modes)、[History](https://superwhisper.com/docs/get-started/history)

官方 Windows 文档明确支持 custom modes，但 coding-agent 集成、CLI 等存在平台差异。[Windows 文档](https://superwhisper.com/docs/get-started/windows)

**适合借鉴：**技能快捷选择、应用规则、样例和换技能重跑。应用规则是确定的环境信号，不代表模型理解了每次任务；同一浏览器中可能既有聊天也有写报告。建议先让应用规则影响轻量风格，结构化技能仍由用户明确选择。

### Aqua Voice：用选区确定任务，并提供纠错闭环

选中文字后使用通常的语音键，说修改要求，结果替换选区；无选区则普通听写。官方描述了多轮修改、undo、编辑历史；意图不清时不修改并提示重新表述。地址栏、搜索框、超长选区有听写回退规则。更新日志记载 Edit Mode 于 2026-07-20 的 0.17.0 在 Mac/Windows 发布。[Edit Mode](https://aquavoice.com/edit-mode)、[Changelog](https://aquavoice.com/changelog)

**适合借鉴：**“选中一段 → 说改短一点/翻译/保留数字改成列表 → 恢复原文”。相较仅从一句口述猜意图，选区给出了明确对象。但“有选区”也可能只是用户碰巧选中文字，仍需可见的编辑状态和覆盖方式。Aqua 不同官方页面对是否需要开启 Select to Edit 的描述有差异，默认状态应实测确认。[Voice writing](https://aquavoice.com/voice-writing)

### Wispr Flow：任务分离可借鉴，Command Mode 仍是实验功能

2026-09-20 的官方说明仍要求在 Experimental 中开启 Command Mode，并给出独立命令快捷键、文本编辑和网站搜索方式。2026-09-01 的上下文文档也说明 Windows 仅支持部分能力，不能把 Mac 的上下文能力直接视为 Windows 等效实现。[Command Mode](https://docs.wisprflow.ai/articles/4816967992-How-to-use-Command-Mode)、[Context Awareness](https://docs.wisprflow.ai/articles/4678293671-feature-context-awareness)

**适合借鉴：**让用户明确进入命令路径，并单独反馈失败。该产品的存在不能证明通用 skill 调度已经结束试验阶段。

### VoiceInk / OpenWhispr：工具执行的边界更清楚

VoiceInk 支持按应用、网站、快捷键和语音触发词切换 mode。它把最终文本传给用户预设命令作为一种输出方式，有 10 秒超时；命令由用户配置，而非模型临时生成。官方安装范围为 macOS。[Mode Triggers](https://tryvoiceink.com/docs/mode-triggers)、[Custom Commands](https://tryvoiceink.com/docs/custom-commands)、[Installation](https://tryvoiceink.com/docs/installation)

OpenWhispr 分开提供一次性 voice agent 与留在浮层中对话、使用列明工具的 chat agent；具有 Windows 文档和公开源码。帮助文档明确语音名字的容错也可能产生近似词误触发。[Voice agent](https://docs.openwhispr.com/help/agent/voice-agent)、[Chat agent](https://docs.openwhispr.com/help/agent/chat-agent)、[Agent name](https://docs.openwhispr.com/help/agent/agent-name)、[Windows](https://docs.openwhispr.com/platform/windows)

**适合借鉴：**文字变换、结果投递、工具任务分别定义执行契约。若要扩展到记笔记、建待办或打开应用，可以采用固定适配器或交给已有 agent。公开源码便于检查实现，但本次没有验证其端到端稳定性。更细的触发、上下文和失败行为见 [案例笔记](voice-skill-cases-notes.md)。

### Windows Voice Access：可作为确定性命令的参照

Microsoft 明确提供听写、命令和默认混合三种模式，以及把命令短语作为文字输入的方式。Voice shortcuts 允许用户命名一个动作或动作序列，官方目前把自定义快捷命令限定在所列英语变体；不要与 Voice Access 整体的中文支持混淆。[模式说明](https://support.microsoft.com/en-US/Accessibility/windows/voice-access/get-started-with-voice-access)、[Voice shortcuts](https://support.microsoft.com/en-gb/accessibility/windows/voice-access/use-voice-to-create-voice-access-shortcuts)

**适合借鉴：**显式模式提示、命令转文字的逃逸方式、固定动作编排。它能验证这种交互范式已有具体产品实现，不能证明本项目的中文 LLM 路由准确率。

## 4. Agent Skills 可以借什么

Agent Skills 规范描述 `SKILL.md` 的元数据和正文，以及可选 references、assets、scripts；按需加载目录、技能正文和资源。规范本身定义包装格式，语音识别、桌面投递和撤销仍需宿主提供。[规范](https://agentskills.io/specification)

其客户端指南支持模型选择和用户显式调用，并建议将激活参数限制在已有技能名称中。[集成指南](https://agentskills.io/client-implementation/adding-skills-support)

**对本项目的推论：**可以借用适用场景、样例、版本和共享文件的组织方式。只做文字变换时不必实现脚本执行。如果以后兼容文件导入，应清楚标明支持的子集；导入一个带 scripts 的技能，不等于本项目已能运行它。包装格式与执行能力需要分别设计。

## 5. 建议的产品模型与调用规则

以下为候选设计，并非已实施功能。

| 类型 | 用户意图 | 输入 | 输出与投递 |
| --- | --- | --- | --- |
| 写作风格 | 把我说的话写清楚 | 本次口述 | 尽量保真，沿用当前自动粘贴 |
| 任务技能 | 按特定场景组织内容 | 明确技能 + 本次口述 | 成稿；新技能可先预览，通过后设为直接输入 |
| 选区编辑 | 修改这段已有文字 | 明确编辑指令 + 有界选区 | 修改结果、原文恢复；未取得选区时说明缺少对象 |
| 工具任务 | 将结果交给某个工具 | 明确动作 + 结构化参数 | 独立执行状态；错误保留在结果卡片中 |

建议调用优先级：本次明确选择的技能 → 动作入口中的技能名称/别名 → 用户配置的应用风格规则 → 普通口述默认设置。技能别名先在动作入口解析，例如“用周报技能，今天完成了……”，避免普通口述“让同事帮我写个周报”被误接管。多个技能匹配或名称未知时给出选择，保留已识别文本。

语音技能至少需要：

- 适用场景与不适用场景。
- 输入来源：口述、选区或用户明确提供的参考文本。
- 输出目标：正文、结构化文档或预览卡片。
- 事实保留与缺项策略：可省略、标待确认或询问，按任务决定。
- 输入/输出样例、版本和真实失败样例。

当前有“写待确认”的保真意图，应保留这一价值，但缺项策略要按任务设定。聊天回复通常需要一个可用正文；汇报模板可以保留缺项标记；选区编辑缺少对象时应停在卡片中。

上下文首先考虑用户明确选择的一段文字。窗口身份可以在本地用于路由，不必发给模型；读屏和长期记忆作为后续独立设计讨论。需要向模型提供参考材料时，标明来源，并把编辑指令与待处理内容分开。

现有失败策略值得延续：普通口述的整理失败可回到原文；明确命令、编辑或工具任务失败时保留结果现场，给出重试/改说，避免自动把指令句当正文输入。其他产品的原文回退方式不能不分任务照搬。

## 6. 实施优先级与验证方法

| 顺序 | 建议工作 | 要回答的问题 |
| --- | --- | --- |
| P0 | 分离整理、命令、分类提示词；轻量风格与结构化技能分开；增加快速选择和保存样例；成功结果支持换技能再跑 | 用户能否知道自己调用了什么，是否得到可用正文？ |
| P1 | 选区编辑、状态提示、原文恢复；本地应用风格规则；在动作入口加入技能别名 | 能否低成本处理“这段”，同时减少误路由？ |
| P2 | 技能导入导出；受支持资源；固定输出适配器或外部 agent 交接 | 可复用能力是否确实需要跨出输入法？ |

先做三项小实验：忠实技术口述、工作进展整理、选区缩写/翻译。使用一组真实中文输入，覆盖短句、长句、数字与否定、同音术语、自我纠正、引用别人指令、缺项、未知技能、没有选区、取消和服务失败。需要录音样本与其人工确认文本，才能分开看 ASR 错误和文字处理错误。

记录一次成稿可用率、修改量、误路由、关键事实改动、恢复原文是否成功，以及停止录音后的额外耗时。模型、提示词版本与任务配置固定后比较；模型自报 confidence 仅作为辅助。以上是建议评测，不是已经获得的结果。

这次工作仅形成调研和候选设计，没有更改产品代码、模型设置或上下文读取范围。Windows 设备与真实服务验收仍按 [现有验收说明](windows-acceptance.md) 进行。
