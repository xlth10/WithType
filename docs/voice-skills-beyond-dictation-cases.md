# 超出文字整理的语音 skill：4 个公开参照

核查日期：2026-10-09。只使用官方文档/API；本次未安装、运行或实测这些产品。除明确标注的日期外，页面没有可靠发布日期，以下均表示访问时公开文档所描述的能力，不能据此推断成功率或全部设备上的可用性。

## 公开事实与能力边界

| 参照 | 官方证据覆盖的链路 | 能借鉴的重点 |
|---|---|---|
| Raycast Quick AI + AI Extensions | 内置语音听写进入 AI composer，再由同一 AI 界面调用扩展工具 | 参数化动作、工具选择、确认、执行评测 |
| Windows Voice Access shortcuts | 自定义口令直接触发预设的一至八步动作 | 固定流程、应用快捷键、可见动作表 |
| Home Assistant Assist | 语音设备入口 → 意图/参数 → 设备、场景、脚本；可使用卫星所在区域 | 有身份的实体、环境上下文、真实结果反馈 |
| Apple App Intents / App Shortcuts | 官方 Siri 集成框架；开发者提供动作、对象与触发短语 | 当前对象的指代解析、对象查询、跨动作结果传递 |

### 1. Raycast：语音输入与动作扩展处于同一 AI 界面

**公开事实。** Quick AI 支持 `Ctrl+M` / macOS 对应快捷键或 Action Panel 开始语音听写；接收后文字留在 composer，支持取消。AI Extensions 可从 Quick AI / AI Chat 使用，AI 选择已暴露的工具和参数。官方列出文件管理、创建笔记、播放音乐等例子，工具按扩展和平台决定可用性。[Quick AI 语音入口](https://manual.raycast.com/ai/quick-ai)、[AI Extensions 的工具与平台](https://manual.raycast.com/ai/ai-extensions)

扩展 SDK 明确将 **Tools、Instructions、Evals** 分开：工具接收一个输入对象；文档以任务的标题、描述、ISO 日期为参数例子；工具可提供执行前的 `confirmation`，取消时不执行；评测可检查工具选择及参数。应用级权限还能对工具调用执行 Ask / Auto / Always Allow 策略。[扩展核心概念](https://developers.raycast.com/ai/learn-core-concepts-of-ai-extensions)、[当前权限策略](https://manual.raycast.com/ai/ai-extensions#permissions)

**边界。** 证据覆盖“语音进入 AI → 同界面有工具执行”，没有证明所有扩展都支持 Windows，也没有证明随口说扩展名就能替代 `@` 选择。这里不把聊天式语音输入写成持续监听的免手助理；具体插件的动作仍取决于其工具实现与账户权限。[语音输入操作](https://manual.raycast.com/ai/quick-ai#dictate-a-message)、[扩展选择与平台](https://manual.raycast.com/ai/ai-extensions)

### 2. Windows Voice Access：口令触发预设应用工作流

**公开事实。** Windows 11 的 Voice Access 支持语音控制电脑；voice shortcuts 的动作类型包括粘贴文本/媒体、打开文件/应用/URL、按键组合、鼠标点击和等待。用户配置“when I say”的口令与动作，单个 shortcut 最多八步，支持启停和编辑。当前文档列出的 shortcut 语言为六种英语变体，未列中文。[Microsoft 官方 voice shortcuts 文档](https://support.microsoft.com/en-us/accessibility/windows/voice-access/use-voice-to-create-voice-access-shortcuts)

**边界。** 这是预设动作序列的语音入口；该文档没有展示自然语言动态生成流程或解析任意业务参数。Power Automate 另有按键触发、暂停/恢复、停止 desktop flow 的官方能力；需本机安装并登录，流程有输入变量时由控制台询问。该文档更新于 **2026-08-31**。[Power Automate 键盘入口](https://learn.microsoft.com/en-us/power-automate/desktop-flows/run-desktop-flows-via-keyboard-shortcuts)

**组合方案，非已核验产品事实。** 让 voice shortcut 发出绑定 desktop flow 的快捷键，在公开接口层面可以衔接；此次没有发现或实测 Microsoft 提供的“自然语音参数 → Power Automate 流程”的完整集成。不能把两个分别成立的能力合写成现成语音 RPA 产品。

### 3. Home Assistant：环境实体、区域和参数化动作

**公开事实。** Assist 内置句式覆盖设备控制、场景/脚本、媒体播放、待办和计时器。诸如设置亮度、颜色的省略区域命令可使用 voice satellite 的区域；媒体暂停/恢复也可作用于卫星或当前区域。被控制实体需先暴露给 Assist，名称或别名需与配置匹配。[实际命令与区域语义](https://www.home-assistant.io/voice_control/builtin_sentences/)、[实体暴露](https://www.home-assistant.io/voice_control/voice_remote_expose_devices/)

自定义 Sentence trigger 能从语音触发 automation；官方示例用 `play {album} by {artist}` 提取命名 slots，并将它们用于回复。文档要求先有可工作的 Assist，再用实际语音设备测试。这个示例证明参数捕获，不单独证明已接好音乐播放后端。[自定义句式与 slots](https://www.home-assistant.io/voice_control/custom_sentences/)

LLM conversation agent 则能将已暴露脚本注册成 tools；需要启用 home control，脚本和字段描述帮助模型决定调用与参数，Stop action 可返回成功/失败及恢复信息。官方建议在 Assist Debug 检查真实 tool call。[脚本工具、前提与结果反馈](https://www.home-assistant.io/voice_control/exposing_scripts_to_llms/)

**边界。** 环境上下文来自配置的实体、区域和语音卫星，不是自动理解任意屏幕。语言、实体暴露、集成与设备能力仍影响命令是否成立；例如 Assist 语音计时器属于具体设备，延迟设备命令目前不能像普通计时器一样取消或修改。[设备与命令限制](https://www.home-assistant.io/voice_control/builtin_sentences/)

### 4. Apple App Intents：对“这个对象”执行明确动作

**公开事实。** `AppIntent` 表达动作，`AppEntity` 表达有标识与查询能力的应用对象；系统用查询解析用户提到的文档等实体。`AppShortcut` 可带触发 Siri 的 spoken phrases。开发者可把 entity 附到当前视图；官方以正在显示的歌曲为例，使 Siri 的“play this song”指向该对象。[Apple 官方框架入门](https://developer.apple.com/documentation/AppIntents/getting-started-with-the-app-intents-framework)

官方验证指南要求测试无上下文/有屏幕上下文、跨应用多步任务，以及只有语音的使用环境。Siri 设计指南还给出把当前照片加入相册、转黑白等对象操作范例。[端到端集成测试要求](https://developer.apple.com/documentation/appintents/verifying-your-app-intents-implementation)、[Siri 对象操作设计范例](https://developer.apple.com/design/human-interface-guidelines/siri/)

**边界。** 这是官方集成范式，要求目标应用提供 intents、entities、queries 与上下文。设计指南中的照片例子不证明任意图像编辑器已经实现；也不证明视频时间线有现成 Siri 接口。此次未验证某个已安装应用、系统版本或语言的实际端到端能力。

## 对 Typefree 的推论与候选场景

以下是设计推论，均不是已实现功能，也不是上述厂商承诺：

| 候选场景 | skill 应处理的对象/参数 | 更合适的执行边界 |
|---|---|---|
| 文件与表格：“把选中的文件按日期命名”“把这条记到账表” | 文件 ID、工作簿/工作表 ID、范围、列类型、值 | 固定工具校验参数与当前对象；执行后返回改动数量、具体结果 |
| 图片与媒体时间线：“当前片段加标记”“选中画面转灰度” | 图层/片段 ID、播放头、时间范围、操作值 | 由目标应用官方扩展/API 提供 adapter；先核查动作能力，语音链路另行验证 |
| 错误现场：“把这个错误建成任务并附现场” | 当前应用/项目、错误日志、截图、任务目标 | 组合读取工具与建任务工具，保留来源；对外写入前展示可检查的内容 |
| 环境状态：“把这里的亮度降到一半” | 当前设备/区域、状态、目标值 | 先解析“这里”的可检验范围，再对限定实体执行动作 |
| 任务连续性：“回到刚才的任务，继续上一流程” | task/session ID、上一步结果、待办步骤、当前对象 | 显式 session 状态与结果交接；避免仅靠重播一段 prompt 猜测进度 |

这些案例共同支持把 skill 从纯文本 instruction 扩展为 **动作说明 + 类型化输入 + 对象查询/上下文 + 可验证执行结果**。Raycast 的 tools/instructions/evals 分离、Assist 的实体与区域建模、App Intents 的对象身份，以及 Voice Access 的固定流程，可分别作为边界清晰的参照。Typefree 可以先选一个动作族做验证，再讨论多个工具之间的规划与连续任务状态。

