# Superwhisper：REA 安装与上下文机制分析

日期：2026-10-09。范围：官方 macOS Superwhisper 2.19.2 的安装包、原生结构和官方文档，重点回答语音处理技能如何获得上下文。没有运行 Superwhisper、录音、读取用户历史或调用付费模型；不能据此评价中文效果、延迟或 Windows 实现。

## 1. REA 是什么，安装到了哪里

REA 同时提供 **skill、MCP server 和 CLI**。skill 是分析步骤与证据规则；MCP 提供读取包、符号、反编译和运行观察等实际工具；原生反编译还依赖 Hopper 等后端。[REA 官方仓库](https://github.com/morluto/rea)

本机已安装 REA npm 包 `rea-agents@6.0.0`、对应 skill（metadata version 33），并注册 Codex 的 `rea` MCP。实际 MCP stdio 握手成功，工具目录包含 139 个工具。官方 scoped doctor 返回 `healthy: true`，Node、Hopper、Codex 注册与 skill identity 检查均通过。这只证明依赖和注册状态，具体分析操作的成功与失败另行记录。

| 项目 | 位置或版本 |
| --- | --- |
| Skill | `/Users/outsider/.agents/skills/reverse-engineer-anything/SKILL.md` |
| MCP 注册 | `/Users/outsider/.codex/config.toml` 中的 `mcp_servers.rea` |
| REA CLI | `/Users/outsider/.npm/_npx/af752b90495482d7/node_modules/rea-agents/scripts/rea.mjs` |
| REA Node runtime | Codex bundled Node 24.19.0；通过 MCP env 的 PATH 指定 |
| Hopper | `/Users/outsider/Applications/Hopper Disassembler.app`，6.6.0-demo |
| Hopper Python | Homebrew Python 3.12.15，库位于 `/opt/homebrew/opt/python@3.12/Frameworks/Python.framework/Versions/3.12/Python` |

Hopper 来源为厂商官方 DMG，核对官方 SHA-1 并通过签名验证；使用演示版，没有购买许可证。Homebrew 安装 Python 时同时更新了其所需的 OpenSSL、CA certificates、readline、SQLite、xz 等依赖。

新注册的 MCP 需要 Codex 重新连接或重新启动才能进入其内置工具列表。本次已通过独立的真实 MCP 客户端继续调用，并保存完整结果；不是用一段普通提示词模拟 MCP。

## 2. 分析对象与证据

官方下载入口：[Superwhisper download API](https://api.superwhisper.com/download)，实际下载地址为 `https://builds.superwhisper.com/latest/superwhisper.dmg`。本次文件快照不随 latest 更新：

- 版本：`2.19.2`，bundle identifier `com.superduper.superwhisper`；最低 macOS 14.0。
- 主程序：Universal Mach-O，包含 x86_64 与 arm64；本次函数与反射分析选择 arm64。
- DMG SHA-256：`08712e6370a7b33adf877a0550ce061b0a48989a2dc0c334b792aaaeca9a29da`。
- 主程序 SHA-256：`0e70c211e0c7a65e09af5d3565e6d5827b62a5247721fa61f8ec981c9e94fd5a`。
- 签名身份：`Developer ID Application: SuperUltra, Inc. (XDP69BYUP9)`，hardened runtime 开启。
- 临时分析输入：`/private/tmp/rea-superwhisper-input/superwhisper.app`；DMG 只读挂载、签名核验后复制，随后卸载。

REA MCP 的原始结果位于 `docs/rea-superwhisper/`。关键 authenticated Evidence：

| 观察 | Evidence ID | 结果文件 |
| --- | --- | --- |
| Mach-O 架构、依赖与 imports | `ev_0f33251b04e660e1dea730fa612a3c8ae0151b679ab8ae214ae82c135f08e0c5` | `macho.json` |
| Info.plist 版本与入口 | `ev_1b2b9f1fcb9d2aa60fb460a445301850eb74f639c35354a5a714694e80ce9e27` | `info-plist.json` |
| 签名与 entitlements | `ev_491c485c17da876b44a5260efde43d07c5d971d21ca5d3ad16280adc20adf8d9` | `signature.json` |
| 应用包完整 inventory | `ev_6b7eef2b86f3fc4a3ac4ad00c2882a83f70e3eb2a6e0af1c68d1e108e05da867` | `application-inventory.json` |
| 包内 inventory substep | `ev_2c2ee6145990ea72f11fd423d00400ba1498d71063aa25f67182725ef5cd80f1` | 同上，substeps |
| 编译 storyboard/nib 的结构 | `ev_2ac4c20e55fc755fd73f1b78372e55317a28407a097bbdfcc5f01ad192e79951` | `interface-builder.json` |
| 已完成的 Hopper inventory | `ev_fa1c53044b3408520d8886ffaab7d446e3ddddf443ad5d2142d560aeb670d4f3` | `overview.json` |
| Context 字符串与地址 | `ev_c13bb6ec60f762b9b922f1ac6b199e1658cf365aaa1a5ef28f07c264ec461175` | `context-strings-long-startup.json` |
| 两种消息组装与模式指令分支的反编译 | `ev_22f27a2147c8df223b528412c6e32ba71469708aba51cf1a28f41fe7eb95172d` | `context-functions.json` |
| 应用上下文内容格式化 | `ev_238013c9407ba853f1f7038a56b094aee8e9a5a0400ce9881332ec280982e5e2` | `application-context-format.json` |
| 剪贴板观察与辅助功能选区读取 | `ev_05e2905b145656f9be97471503aa1fb052f240acb4b91bd77bc4ed4b4c3215dc` | `capture-functions.json` |

`package-evidence-bundle.json` 导出了上述会话的 6 个证据记录。`static-string-leads.json` 和 `swift-reflection-notes.md` 是额外静态调查，明确不冒充 REA authenticated Evidence。

后续原生调用另导出到 `native-evidence-bundle.json`，包含 26 个证据记录。`close_binary` 已成功关闭原生会话；所有 50 个 JSON 调查文件均通过解析检查，安装包内原始 HopperClient 模块的 SHA-256 在调查结束后仍与适配前一致。

## 3. 最值得借鉴的上下文契约

### 3.1 宿主采集上下文，Mode 声明是否使用

官方文档说明，Super Mode 通过 accessibility APIs 取得当前应用/输入区域文本和选区，并利用剪贴板上下文；复制内容需在开始口述前 3 秒内，或在口述期间产生。自定义 Mode 可以分别启用三种来源，并在指令中引用 `User Message`、`Application Context`、`Selected Text`、`Clipboard Context`。[Built-in Modes](https://superwhisper.com/docs/modes/built-in)、[Custom Mode](https://superwhisper.com/docs/modes/custom)

REA 的 Mach-O imports 确认主程序链接了 `AXUIElementCreateApplication`、`AXUIElementCopyAttributeValue`、`AXIsProcessTrustedWithOptions`、`NSAccessibilitySelectedTextAttribute`、`NSPasteboard` 等接口。这与文档描述相符，但 import 存在本身不证明调用时机或最后发送了什么。

额外的 Swift 元数据解析把上下文开关准确定位到 `superwhisper.Mode`：

| Mode 字段 | 类型 | arm64 FieldRecord VA |
| --- | --- | --- |
| `contextFromSelection` | Bool | `0x1012a3784` |
| `contextFromClipboard` | Bool | `0x1012a3790` |
| `contextFromActiveApplication` | Bool | `0x1012a379c` |

因此值得借鉴的接口是：**Mode 声明输入来源，宿主负责收集并传入这些来源。** 单纯加一段 prompt 不会让 skill 自动取得桌面内容。这是文档与编译结构共同支持的设计判断；详细采集分支另需调用关系证据。

### 3.2 上下文是有来源的数据结构

当前主程序中实际存在以下结构，字段来自反射元数据，不是根据英文字符串猜测类型归属：

| 类型 | 已观察字段 | 对本项目的启发 |
| --- | --- | --- |
| `PromptContext` | `modeContext`、`systemContext`、`userContext`、`applicationContext` | 集中组装一次任务的上下文 |
| `ModeContext` | `type`、`language`、`examples` | 任务类型、语言、样例与正文分开 |
| `SystemContext` | 时间、时区、locale、语言、computerName、`clipboard` | 数据来源清楚，可按需最小化 |
| `ApplicationContext` | name、url、nouns、focusedElementDescription、focusedElementContent、`selectedText`、appInfo、`includeInPrompt` | 窗口身份、实际输入内容和选区分别保存 |
| `RecordingMetadata` | `prompt`、`promptContext`、`applicationContextEnabled` | 可以保留任务现场用于诊断和重跑 |

其中 `ApplicationContext.selectedText` 和 `SystemContext.clipboard` 是可选 String。Mode 还包含 `prompt`、`promptExamples`、`contextTemplate`、`activationApps`、`activationSites`。字段存在不等于默认启用、每次发送或无限采集；`UserContext` 中出现姓名/email/phone 也不能据此断言默认会读取或上传这些信息。

准确 VA、类型回指验证和仅用 Python 标准库的完整复现器见 `docs/rea-superwhisper/swift-reflection-notes.md`。解析遍历了当前 arm64 的 2,772 个 FieldDescriptor，并验证相关 nominal descriptor 的 Fields 回指。

### 3.3 REA 函数证据：确实把上下文组装进模型输入

Hopper 完成分析后识别到 83,561 个过程、32,113 个字符串。主程序的许多 Swift 函数没有保留原始名称，搜索 Context 得到的 282 个过程没有 `superwhisper` 命名命中；因此改为标签字串 → xrefs → containing procedure → decompile。以下地址为 provider 返回的 arm64 函数入口；`sub_...` 是分析器名称，不是原始源代码函数名。

| 函数入口 | 直接观察到的行为 | 可作出的结论 |
| --- | --- | --- |
| `0x10061411c` | 按可选内容组装指令、系统信息、用户信息、应用信息、选区和剪贴板；应用信息有 Bool 判定，选区/剪贴板有非空检查；随后构建 system 消息、样例 user/assistant 消息对、最后的 user 消息 | 存在将上下文和样例转换成 chat messages 的真实组装路径 |
| `0x100614e68` | 将指令、样例、选区、剪贴板、系统/用户/应用信息及用户正文串成一个 prompt 字符串 | 还有独立的纯文本 prompt 路径，不能假设所有模型都共享完全相同的消息布局 |
| `0x100613c3c` | 格式化应用名、URL、应用输入格式、焦点控件说明、焦点内容以及 names/usernames 等 | Application Context 的具体内容超过窗口标题；焦点内容与选区有不同处理位置 |
| `0x100613b40` | 按参数选择标题加正文或 XML 风格的标签包装 | 上下文来源标签是实际序列化逻辑；仅有标签不能证明具备内容转义或指令隔离保证 |
| `0x1001508f8` | 按配置和模式判别值选择“只重排正文”与“执行用户消息里的要求”等不同指令语义 | 整理与任务执行存在提示词边界差异；不宜给所有模式统一套用“口述只能当材料”的约束 |
| `0x1000e2820` | 读取 NSPasteboard.generalPasteboard.changeCount，变化后记录时间戳并调用回调 | 剪贴板变化有专门的观察路径；3 秒筛选规则仍以官方文档为依据，未在此函数中发现该比较 |
| `0x100021874` | 读取选区 text-marker 属性，再调用 AXUIElementCopyParameterizedAttributeValue 转成 String；错误/空值有独立分支 | 已观察到真实 accessibility 选区读取实现；尚未验证所有应用里的 fallback 顺序 |

`0x100198464` 直接调用 messages 组装函数，并将结果传给后续异步回调；`0x100207330` 在 `WhisperState.modeManager` 路径中调用纯文本组装函数，并使用用户转录占位符。调用关系和 consumer 反编译保存在 `context-builder-callers.json`、`selection-builder-callers.json`、`prompt-consumers.json`。目前没有把间接回调完整映射到每个模型 provider，也没有抓取实际网络请求。

这将核心判断从“有相关字段”推进到“**宿主确实把来源明确的上下文组装为模型输入**”。其中把参考内容放进 system 字段的路径也说明：来源标签不等于信任隔离。对本项目应分别设计任务指令与外部参考材料的角色和边界，并用包含引用指令的中文样本验证。

### 3.4 调用与修复形成闭环

Mode 可用快捷键、菜单、应用/网站规则或 deep link 切换；历史支持选择其他 Mode 重跑，不必重新录音。官方还明确区分 Super Mode 的格式变换与 Custom Mode 的更广泛任务。对本项目而言，显式任务选择、可见当前模式和换技能重跑，比直接要求模型猜任意任务更容易验证。[Switching Modes](https://superwhisper.com/docs/modes/switching-modes)、[History](https://superwhisper.com/docs/get-started/history)、[Built-in Modes](https://superwhisper.com/docs/modes/built-in)

## 4. Agent 集成与语音整理是两条路径

官方 [superwhisper-codex](https://github.com/superultrainc/superwhisper-codex) 插件把 Codex hooks 接到应用内 `Contents/Resources/agent-hook`。公开 `hooks.json` 注册 SessionStart、UserPromptSubmit、PreToolUse、PostToolUse、PermissionRequest、Stop，均调用同一个 app hook；公开 skill 主要指导 on/off/status，并不负责阅读项目代码或生成桌面上下文。插件 manifest 声明 skills 与 hooks，没有 MCP server 声明。[hooks.json](https://github.com/superultrainc/superwhisper-codex/blob/main/plugins/superwhisper/hooks.json)、[SKILL.md](https://github.com/superultrainc/superwhisper-codex/blob/main/plugins/superwhisper/skills/superwhisper/SKILL.md)

公开 control script 没有显式 session ID 时，用最新 `*-stop-message.txt` 推断 session；并行会话可能定位错目标。它只实现 session 标记操作，skill 还提到 cwd 标记，二者范围并不完全一致。[control script](https://github.com/superultrainc/superwhisper-codex/blob/main/plugins/superwhisper/scripts/superwhisper-codex-control)

包内 `agent-hook` 是另一个原生 Swift executable，SHA-256 `2ae28f189886614ebfd9bda0e455f628425b12ae3253bc04cc295da0bb084864`。其反射显示 HookInput 包含 sessionId、transcriptPath、cwd、hookEventName、turnId、lastAssistantMessage、prompt、toolName、toolUseId、toolInput 等字段；AgentInboxPayload 包含 sessionId/requestId、messageFile/responseFile、cwd/project/branch/title 等字段。符号与字符串提供了 stdin JSON、inbox 文件和等待回复的线索；具体字段映射、唤醒方式和超时尚需函数证据，不能称作已证明的 socket/MCP 协议。

Superwhisper 另外提供独立 CLI/MCP 访问历史、词汇和 snippets；这与 Mode 的上下文采集不是同一个接口。[CLI and MCP server](https://superwhisper.com/docs/get-started/cli)

## 5. 对 Typefree 的候选改进

当前 Typefree skill 主要接收口述；窗口身份仅保存到历史。建议先补三个明确的接口，以下均为研究建议，尚未实施：

1. **Skill 输入声明**：口述必选，选区/参考文本/应用身份按技能配置；将不存在、禁用、权限不足、过长四种状态与空字符串区分。
2. **一次录音的 ContextSnapshot**：保存来源、采集时间、目标窗口和长度限制；开始口述时固定选区目标，异步结果不能重新套用到另一个窗口。剪贴板先采用用户明确提供/复制的参考材料，再评测时间窗口规则。
3. **按任务组装模型消息**：整理任务把口述当待清理材料；选区编辑把口述当编辑要求、选区当材料；具体 skill 引用来源，不用统一“口述不是指令”的边界覆盖全部任务。

随后增加可见的技能选择与换技能重跑，并在历史中显示本次实际使用的上下文来源。应用规则可用于路由，但不要把同一应用里的所有任务视为同一种 skill。语音与 agent 的交接用明确 session/request ID，避免从“最新文件”猜目标。

这套思路的重点是**宿主提供可靠上下文，skill 定义如何处理它，执行层负责投递与恢复**。无需先把所有整理技能变成可以执行任意脚本的 agent。

## 6. 操作限制与复现

REA 的 DMG inventory 成功，但本版本 `extract_artifact` 对 DMG 返回 `Artifact format has no extraction reader: dmg`；随后使用 macOS 只读挂载与复制取得 app，未把失败写作成功。

Hopper 原先根据本机 Xcode Python 的 build-time sysconfig 得到不存在的库路径；安装其推荐的 Homebrew Python，并在 GUI 选择真实解释器后，日志确认库加载成功。

首次主程序分析用了 2 分 24 秒，超过 REA 6.0.0 HopperClient 默认 120 秒启动期限。失败结果保存在 `context-procedures.json`、`context-strings.json`。演示版无法保存数据库，不能通过保存结果跳过下次首次分析。为本次独立 MCP 会话添加了 `hopper-startup-timeout.mjs`：只在内存中把该默认期限改为 300 秒，先核验原模块 SHA-256；不修改 npm 包、Codex 注册或 Hopper 的许可限制。`rea-session.mjs` 仅在环境变量 `REA_INVESTIGATION_LONG_STARTUP=1` 时加载该适配器。

延长期限后，第二次启动在约 142 秒完成，随后 search_strings、search_procedures、binary_overview、xrefs、resolve_containing_procedure、batch_decompile、procedure_pseudo_code、procedure_callers 均实际成功。第一次延长后的尝试遇到演示版重新启动界面，失败结果也保留。当前注册的 MCP 仍是厂商原始配置；这个大二进制的首次分析 workaround 只用于研究 runner，不能把 doctor healthy 写成默认 120 秒足以分析任意文件。

原始调用、错误与成功结果分别保留。静态分析已确认结构/API和上述函数关系；未进行隔离运行，因此实际权限不足回退、特定应用兼容性、每个模型收到的完整请求和效果仍是未知项。Hopper pseudocode 是 provider 的近似重建，寄存器/变量归属和 Swift async 片段可能失真；未恢复原始源码，也未把纯字符串线索当作运行事实。
