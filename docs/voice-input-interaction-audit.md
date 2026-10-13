# 语音输入交互研究：Typeless 与当前 Typefree

核查日期：2026-10-11。本轮先研究和审计，不修改产品行为。

后续状态：本报告保留修复前的源码观察、行号和离线探针；2026-10-11 已实现核心投递/恢复优化及用户指定的光标优先定位，最新行为、验证范围和待验收项见 [交互优化说明](interaction-optimization.md)。下文的“当前”“待实现”指审计时的基线。

## 结论

优先问题是**结果是否到了正确位置、失败时能否立即取回、界面是否准确说明结果去处**。增加更多 Skill 场景之前，应先把这三件事稳定下来。

“看不到光标”不能直接作为失败条件：光标可能隐藏，但输入框仍可编辑；有选区也可能只是只读网页。需要分别判断目标身份、可编辑性、焦点是否变化和投递结果。无法验证的控件也不能直接等同于不可输入。

当前 Typefree 的主路径为：写剪贴板 → 等 70ms → 对完成时的前台输入流发送 Ctrl+V → 报完成 → 约 900ms 后尝试恢复旧纯文本。它尚不能可靠实现用户提出的“无输入位置时自动复制并保留结果”。前端错误分支、剪贴板备份范围与取消登记还存在具体问题。

## 证据与适用范围

| 来源 | 能回答什么 | 边界 |
| --- | --- | --- |
| Typeless 官方帮助，2026-10-11 访问 | 桌面功能的公开交互规则 | 文档承诺不等于每个应用中均成功 |
| 本机 Typeless 2.8.1 / build 2.8.1.130 的 ASAR、macOS InputHelper | 结果分流、快捷键状态、插入与剪贴板的静态调用链 | 没有启动、录音或操作真实文档；不能据 macOS 原生库推断 Windows 原生实现 |
| 当前 Typefree 工作区源码 | 当前 Windows 投递逻辑及界面分支 | 包含上一轮未提交的优化；没有 Windows 实机运行证据 |
| 隔离探针与状态模型 | 错误分支、取消与恢复状态迁移 | 剪贴板/API 都为 mock；不是跨应用成功率测试 |

复用上轮 REA 局部证据与静态提取。本机 Typeless 安装副本上轮签名/member 校验存在异常，原因未明；本轮只对相同已核对字节作结论，不能声称它代表官方所有发行包。细节见[原生插入笔记](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/typeless-insertion-interaction-notes.md)与[既有证据边界](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/typeless-context-and-processing-analysis.md:17)。未读取个人历史、密钥或真实模型请求。

## Typeless 公开的交互规则

| 场景 | 官方规则 | 借鉴点 |
| --- | --- | --- |
| 正常听写 | 先点输入框，再按一次 Dictate 开始；有声音/Voice bar 后开口，再按一次结束，结果出现在开始听写的位置。[Dictate](https://www.typeless.com/help/quickstart/dictate) | 明确开始信号、停止动作、预期落点 |
| 翻译 | 独立入口；Voice bar 上切换预设目标语言；使用主快捷键结束，译文进入输入位置。[Translate](https://www.typeless.com/help/quickstart/translate) | 操作时看得见语言，结束动作统一 |
| 改写可编辑选区 | 选中文字，说修改要求；结果替换选区。[Ask anything](https://www.typeless.com/help/quickstart/ask-anything) | “处理对象”和“口述命令”分开 |
| 阅读网页/只读选区 | 选中后提问、解释或总结；原选区保留，查看回答。[Ask anything](https://www.typeless.com/help/quickstart/ask-anything) | 阅读与编辑使用不同结果去处 |
| 没有选区，直接提问 | 回答显示在弹出卡片中。[Ask anything](https://www.typeless.com/help/quickstart/ask-anything) | 不把答案误当输入正文 |
| 网页搜索动作 | 语音描述搜索，打开相应网页。[Ask anything](https://www.typeless.com/help/quickstart/ask-anything) | 属于额外工具能力；不是本项目输入投递稳定性的前置要求 |
| 卡片关掉或没有及时复制 | 从 History 找回转录结果。[找回转录](https://www.typeless.com/help/troubleshooting/missing-transcript) | 提示消失后仍有恢复入口 |
| 识别失败、历史回看 | History 可复制、用同一音频 Retry、下载音频、删除记录与设置保留期。[History](https://www.typeless.com/help/quickstart/history-and-dictionary) | 不强迫用户重新讲一次 |
| 长时间录音 | 9 分钟上限；第 8 分钟显示 60 秒倒计时；达到上限保存当前结果到 History。[录音上限](https://www.typeless.com/help/troubleshooting/dictation-limit) | 中断前预警、中断后能找回 |
| 快捷键/外接键盘/音频 | 可修改入口快捷键、添加额外快捷键、选择麦克风并看电平；可开关开始结束音效和录音时静音。[Settings](https://www.typeless.com/help/quickstart/settings) | 多入口、设备反馈和听觉反馈 |
| 权限或设备失败 | 分别解释辅助功能与麦克风问题；麦克风错误有按 OS 分开的排查步骤。[权限](https://www.typeless.com/help/troubleshooting/permission-issues)、[麦克风](https://www.typeless.com/help/troubleshooting/microphone-unavailable) | 让用户知道失败在哪一步 |

这些文档没有说明“任何无光标情况都自动永久复制”、焦点切换后的全部落点策略，或“粘贴失败已被验证”。相关行为需要客户端证据，不能从营销文案补齐。

## 本机 Typeless 原生插入的实际边界

已追踪的 plain/rich 插入都临时使用剪贴板，再发送 Command+V，约 500ms 后恢复旧快照。快照覆盖 pasteboard items/types/data，范围比我们只保留旧文本更完整；但写入返回值未检查，空快照恢复直接返回，仍有边界。[静态调用链](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/typeless-insertion-interaction-notes.md:21)

原生返回 `1` 表示有效参数的插入尝试已安排，不能证明目标收到文字。原生链没有锁定录音开始的控件、检查可编辑性或确认目标内容；JS 包装会吞掉异常/非 `1`，忙时跳过插入。上层结果分流可以改善恢复体验，却不能把底层按键发送变成成功确认。[原生失败边界](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/typeless-insertion-interaction-notes.md:58)

“保存旧剪贴板”与“保存最近一份转录”必须分开：前者用于临时粘贴后恢复，后者用于重新复制和找回。它们不是同一份状态，也不是同一种用户承诺。

## 本机 Typeless 上层如何处理结果

本轮将 renderer 到原生调用的消费者链补齐，详见[上层交互与原始字节索引](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/typeless-interaction-static-notes.md)。其结果分流是：

| 结果类型 | 本机静态可见的行为 | 需要保留的边界 |
| --- | --- | --- |
| 听写、翻译 | 完成时重新读取当前应用/输入信息，先调用普通文本插入，再判断当前区域是否可编辑；不可编辑且未被兼容名单排除时显示有 Copy 按钮的结果卡片 | 不是先验证目标再决定是否插入；焦点可以已经不同于录音开始时 |
| Ask `replace` | 同样重新取焦点；Markdown 转 HTML/纯文本后尝试富文本插入，抛异常时回退普通文本；再判断跟踪或结果卡片 | 初始选区用于请求/卡片，并没有在此处确认实际替换对象仍是原控件 |
| Ask `reply` | 直接打开答案卡片 | 与插入正文分开 |
| Ask `external` | 打开返回的目标 URL | 只能证明打开网页，不能推广为任意系统工具 |

结果卡片是**主动复制入口**：展示卡片本身不复制，用户点 Copy 才走独立 clipboard IPC/DOM 回退。没有证据证明该完成序列会永久保留语音正文到系统剪贴板。卡片条件也不是原生插入失败返回值，所以可编辑控件忽略粘贴时未必显示卡片。

客户端会先将模型完成状态切回 idle，再异步投递和保存 completed 历史；completed 不能当成目标已写入。取消提示中的 Undo 追到的是重处理最近音频，不是撤销已插入文字。代码有 `pasteLastTranscript` 配置，但本轮未闭合执行消费者链，不能凭配置名称为已验证的“复制/插入上次结果”功能。

这些细节支持借鉴**结果卡片、独立复制和历史找回**，同时说明目标校验、成功确认与剪贴板保留规则仍需要我们自行设计。

## 当前方案的具体问题

P1：会写错位置、取消后仍输入或错误报告核心投递结果。P2：恢复、剪贴板数据或反馈有缺陷。表中的“确认”是源码/隔离分支确认；跨应用影响和触发频率仍需要 Windows 实测。

| 编号 | 级别/性质 | 触发与结果 | 证据 |
| --- | --- | --- | --- |
| I1 | P1，目标策略缺失 | A 中录音，处理时切到 B：完成只对当前前台发 Ctrl+V；没有校验开始控件，历史仍记录 A。从主窗口点重试/插入原文也有同样问题 | [开始身份仅用于历史](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/App.jsx:648)、[投递参数](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/dictation/pipeline.js:587) |
| I2 | P1，状态误判 | 无输入框、只读区域或目标忽略粘贴时，按键提交成功就标 `pasted=true`；可能显示完成、恢复旧剪贴板，但没有文字落下 | [SendInput 返回检查](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/lib.rs:487)、[pasted 标记](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/dictation/pipeline.js:601) |
| I3 | P1，取消竞态 | cancel_paste 先于异步 paste_text 的 active 登记时，不保存取消；登记还清除取消标记。窄时序下 UI 已取消，原生仍可能投递 | [取消登记](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/lib.rs:547)、[投递登记](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/lib.rs:514) |
| I4 | P2，剪贴板格式丢失 | 旧内容为图片、文件列表或富文本：只备份/恢复纯文本，不能还原完整原内容。旧剪贴板没有文本时，结果又会留下，行为取决于原内容类型 | [备份与恢复](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/lib.rs:574)、[依赖源码核对](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/typefree-insertion-interaction-audit.md:54) |
| I5 | P2，恢复竞态 | 两次投递在 900ms 恢复窗口内交叠：第二次备份第一次结果，后续恢复可能回到第一次口述而非原内容 | [异步恢复](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/lib.rs:590)；状态模型复现，正常语音时序频率未知 |
| I6 | P2，系统兼容风险 | 粘贴瞬间仍按 Alt/Shift/Win，发送的 Ctrl+V 可能受现有键盘状态干扰，未等释放 | [发送序列](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/lib.rs:481)；[Microsoft SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput)；实机待测 |
| I7 | P2，复制反馈 bug | 关闭自动输入，复制 Promise 拒绝后错误被吞，仍成功提示；点“插入原文”在此模式只复制，却提示已插入 | [完成通知与复制](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/App.jsx:834)；实际 handler 与 pipeline 隔离探针已复现 |
| I8 | P1，回退分支缺失 | 粘贴失败事件保存历史后直接 return，跳过自动复制；失败现场没有正文复制/重新选择目标卡片 | [失败提前返回](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/App.jsx:828)；实际 handler 隔离探针已复现，正文仍可从历史取回 |

Microsoft 的 SendInput 返回值只表示事件进入输入流；当前代码没有取得“文字已插入”的确认。此外管理员窗口可能受 UIPI 限制，应把它作为失败恢复场景，不应靠“显示完成”掩盖。[API 契约](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput)

详细触发、局限及已存在保护见[投递源码审计](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/typefree-insertion-interaction-audit.md)。

## 已有能力与功能缺口

| 交互能力 | 当前情况 | 缺口性质 |
| --- | --- | --- |
| 按一次开始，再按一次结束；悬浮条/托盘结束取消 | 已有；只认本次启动入口，不同入口不会误停 | 基础能力存在 |
| 提问显示独立卡片与追问 | 已有；不自动粘贴答案 | 基础能力存在 |
| ASR 失败恢复音频；文字处理失败重试/复制原文 | 已有；命令和提问失败不会把指令句输入出去 | 应保留这些保护 |
| 全程最近结果与历史复制 | 最近结果在内存、历史持久化；下一次开始/取消不会清空最近结果 | 重启加载历史后不恢复首页 lastResult，没有全局“复制上次结果”入口 |
| 结果永久保留在系统剪贴板 | 关闭自动输入会尝试复制；自动输入会尝试恢复旧纯文本 | 尚无清晰统一的默认策略，不等于“始终保留最新完成复制” |
| 无目标/投递失败的结果卡片 | 失败有图标和主窗口通知、正文在历史 | 缺少不切应用就能复制、确认去处、重试投递的卡片 |
| 根据可编辑选区改写、只读选区提问 | 当前模型请求处理口述文字，没有独立选区内容；UIA 用于投递后的词汇学习 | 这是上下文与结果路由能力缺失，不是已有选区功能的 bug |
| 翻译目标在录音条切换 | 设置里有默认语言，口述可触发语言识别 | 缺少 Voice bar 的语言选择；属于功能选择 |
| 所有入口用主快捷键结束 | 当前要求同一个启动入口结束，UI 文案也这样解释 | 与 Typeless 不同，但不是当前规则下的 bug |
| 多组外接键盘快捷键、Esc 取消 | 当前三个入口各一组；取消来自托盘/HUD，Esc 只用于快捷键录入退出 | 可补的交互能力，优先级低于投递可靠性；本机 Typeless 长按会停止并提示勿长按，不能将按住说话列为已证竞品优势 |
| 听觉反馈、录音时静音、实时麦克风测试 | 可选麦克风并显示录音电平，有设备错误恢复 | 开始/结束音效、设置中的麦克风试音和静音选项尚未形成同等入口 |
| 长录音倒计时与自动收尾 | 原生有 15 分钟上限错误并保存已录内容路径 | 没有提前倒计时；上限与设备错误混用反馈 |
| 重新转写历史 | 开启保留音频后已有；会走通常的投递流程 | 应把“重新生成结果”和“重新输入正文”分开，避免回看时意外插入 |

其中“首页最近结果重启为空”可由 [lastResult 初始值](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/App.jsx:560) 与[历史加载](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/App.jsx:931)共同确认；持久化历史本身没有因此丢失。

## 建议采用的结果交互规则（待实现）

1. 开始时记住预期目标；结束投递前再检查目标。若焦点改变，保留结果并让用户选择复制或新的去处，不静默输入另一窗口。
2. 可编辑目标仍有效时尝试插入；无法识别/确认时提供保留结果的回退。不能以“光标不可见”一项粗暴禁用输入。
3. 无有效目标或投递失败时，复制正文并保留，显示“已复制，可以粘贴”；复制也失败时显示“结果已保留，复制失败”，提供重试。只有复制真的成功才能称已复制。
4. 区分 `结果生成`、`已复制`、`粘贴尝试已发送`、`已确认输入`、`投递失败`；不要用一个“已完成”替代所有去处。
5. “最后完成结果”独立于系统剪贴板持久保存。开始新录音、取消、识别失败不清掉上一份可用结果；下一份完成结果才更新。提供直接复制上次结果的入口。
6. 剪贴板策略单独说明：如果默认保留最新语音正文，成功输入后也不再恢复旧内容；如果提供保护旧剪贴板选项，就应按所有权与格式完整恢复。失败回退的正文不能被旧内容恢复线程随后覆盖。用户期间主动复制的新内容应优先保留。
7. 重试识别/整理先产生可回看的结果；显式重新插入才进行目标校验和投递。选区改写、只读问答、工具动作分别走对应结果去处。

这些是本项目的建议契约，不代表已经实现，也不把它们全部归为 Typeless 已验证行为。用户说的“保留上一次完成的复制”在这里拆成两项：**最近结果可重新取回**与**系统剪贴板默认保留什么**；实现时应让二者独立且行为可预期。

## Windows 实机验收矩阵

| 场景 | 应观察的结果 |
| --- | --- |
| 记事本、浏览器普通输入框、聊天编辑框 | 插入一次，去处正确，结果状态准确 |
| 光标暂时不可见、没有输入框、只读网页 | 不靠光标可见性误判；无法投递时结果可立即复制 |
| 输入框选区 vs 网页只读选区 | 前者允许明确替换；后者回答/卡片，不改原文 |
| A→B 切应用、同窗切输入框、窗口关闭 | 不静默写进错误目标，保留结果 |
| 从设置窗口点击重试/插入原文/历史重新转写 | 设置输入框不被误写，重新生成与投递有区别 |
| 图片、文件列表、HTML/纯文本混合、空剪贴板 | 与声明的保留/恢复策略一致，格式不意外丢失 |
| 完成期间用户重新复制、两次快速投递 | 新复制不被恢复线程覆盖，不恢复到中间口述 |
| ASR/文字超时、粘贴失败、复制失败 | 每一步独立提示并提供可用恢复动作 |
| 取消发生于请求中、投递登记前、70ms 窗口 | 取消前未发送的输入不再发送；已发送的边界准确说明 |
| 修饰键未松开、管理员程序、终端、远程桌面 | 失败不误报输入成功；兼容性分别记录 |
| 多显示器、麦克风拔出、休眠/恢复、长录音上限 | HUD 可见，录音中断可恢复，超时前有明确提示 |

本轮没有这些跨应用实测，不将它们标成已通过。建议先落实 I1/I2/I3/I8，再处理剪贴板和反馈，之后补选区编辑及快捷键体验。

## 本轮验证与研究清单

- [已回答] Typeless 公开的听写、翻译、选区编辑/阅读、回答卡片、历史恢复、设备反馈。
- [已回答] 当前 Typefree 的目标、粘贴、剪贴板、取消和错误分支；功能缺失与逻辑问题分开登记。
- [已回答] 本机 Typeless macOS 原生插入和剪贴板恢复的静态实现边界。
- [已回答] 本机 Typeless 的完成时焦点重取、结果卡片、主动复制、历史重试、通用结束键和 Escape 取消的静态路径。
- [部分回答] Typeless 所有无输入框/焦点竞争的实际效果，以及 pasteLastTranscript 动态执行链；有界静态结果不能替代实测。
- [未实测] Windows 应用兼容性、真实 clipboard 权限、焦点竞态频率、修饰键/UIPI 行为。

隔离前端探针：[脚本](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/interaction-evidence/frontend-delivery-probe.mjs)、[结果](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/interaction-evidence/frontend-delivery-probe-results.json)。执行 `node docs/interaction-evidence/frontend-delivery-probe.mjs`：三种错误/反馈分支断言通过；读取当前 handler，不操作系统剪贴板。

原生状态模型：[脚本](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/interaction-evidence/native-delivery-state-probe.mjs)、[结果](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/interaction-evidence/native-delivery-state-results.json)。两种状态迁移断言通过，涵盖预登记取消丢失与交叠恢复；没有执行 Windows API。

本轮仅新增研究文档与隔离复核材料；没有修改 Typefree 产品代码、配置、Typeless 安装或个人数据。
