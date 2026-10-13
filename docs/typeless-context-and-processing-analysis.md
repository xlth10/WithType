# Typeless 2.8.1：上下文获取与语音处理链路

核查日期：2026-10-10。目标是本机 `/Applications/Typeless.app`，版本 2.8.1 / build 2.8.1.130。只做安装包静态分析，没有启动 Typeless、录音、读取个人历史或抓取真实请求。结论中的“确认”指客户端代码及静态调用关系，不代表所有应用中都能成功获取数据。

## 结论与问题清单

| 问题 | 本次状态 | 客户端证据 |
|---|---|---|
| 是否读取选区 | 已确认调用路径 | InputHelper.getCurrentInputState / getSelectedText；无选区结果时可调用模拟复制回退 |
| 是否读取当前应用 | 已确认调用路径 | ContextHelper.getFocusedAppInfoAsync；应用名、bundle ID、窗口及浏览器信息进入 active_application |
| 是否读取输入框内容 | 已确认调用路径 | AX TextMarker 或 AXValue + AXSelectedTextRange；光标前后各保留最多 5,000 个 Swift Character，再与选区拼接 |
| 是否读取剪贴板 | 已确认，但用途需区分 | 复制回退会读旧剪贴板用于备份，并读 Cmd+C 后的新文本作为选区；本次未发现把原有剪贴板文字单独作为模型参考的路径 |
| 是否读取窗口可见文字 | 已确认调用路径 | ContextHelper 遍历 AX 元素树；另取输入元素周边树文本 |
| 上下文是否进入请求 | 已确认调用路径 | start_audio / replace_audio_context 经 WebSocket 发送 audio_context；HTTP 重试也提交 audio_context |
| 上下文具体如何影响 ASR 与 LLM | 部分回答 | 客户端收到 transcription 及 refine 结果；服务端怎样提示 ASR、组装 LLM prompt、使用什么模型，客户端没有给出足够证据 |

## 1. 证据范围和复现锚点

原 ASAR SHA-256 为 `eb9bcc842478b12a7488d90778ad6b08e6788c8fa5e875782ec2af0387c6c80b`。REA 整包读取被 better-sqlite3 外置原生文件的 member hash 不匹配阻挡，本机 codesign 验证也未通过；原因尚未查明。因此本报告针对该本机副本，不声称与官方发布副本完全相同。此前的失败与局部验证见 [可行性笔记](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/typeless-rea-feasibility.md)。

主进程 `dist/main/index.js` SHA-256 为 `7b87e1578597b6fce6b6589a2f8aa18496e9513f0e74d0b8b26186a641b59ade`；本次重新从当前 ASAR 读取后与缓存及 member hash 一致。只提取并核对相关 renderer 文件，不提取个人数据。

主进程的字符串表经 Babel AST 解析和有界算术匹配得到 190 次旋转、9,518 处字面量替换；未执行任何应用代码。对 1,245 个 decoder 别名检查未发现冲突声明、参数或赋值。这个转换只提供研究阅读视图，运行等价性未测试。renderer 相关模块的字符串是直接字面量，仅按 token 边界插入换行。

[源文件证据索引](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/typeless-context-evidence/source-ledger.json) 保存文件 SHA-256、原始字节范围及 UTF-16 源位置，以下使用 J-/R- 锚点引用。解码全文和中间文件位于 `/private/tmp/typeless-context-analysis/`，未将应用实现全文复制进项目。

REA 对未改写的 `CSQqv-L0.js` 成功返回 Evidence `ev_463b04446e139d4da65f8b2572ec0566cbf2e74b0b17afaa34a52ac9e0f52a2c`。工具将 enum 属性形式的 IPC channel 保留为 dynamic；字符串 trace Evidence `ev_be733219a55bb4bae51fbde10ae5f095eebbe220119ba43a511d7dc33897bd42` 无匹配，这不是功能缺失证据。下文跨 enum、字符串表和模块的关系由静态源码检查补全，不写成 REA 已自动恢复了完整图。见 [REA 摘要及限制](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/typeless-context-evidence/rea-js-summary.json)。原生 Hopper 引擎未能启动，原生结论来自 nm/otool 的实际调用指令与静态属性数组，未取得反编译伪代码。

## 2. 从前端到采集器

`qA149QP2.mjs` 的录音控制调用 `CSQqv-L0.js` 导出的 getAudioContext，经 `audio-context:get-audio-context` IPC 到主进程 Dm.getAudioContext，再转到 Le.getFullContext / collectFullContext。该采集器分别调用 ContextHelper 和 InputHelper。

证据：R-GATEWAY、J-GATEWAY-MAIN、J-FULL；原生细节见 [ContextHelper 笔记](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/typeless-native-context-notes.md) 和 [InputHelper 笔记](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/typeless-input-context-notes.md)。这两份笔记保存 dylib SHA-256 和未加载 arm64 函数地址。

### 当前应用与窗口

ContextHelper.getFocusedAppInfoAsync 的 JSON 被归一化为 `active_application`，包含 app_name、app_identifier、window_title、window_position、app_type，以及 process_id、app_path、window_id。浏览器信息进一步形成 page_title、page_url、domain。

原生 AppSync 路径使用 NSWorkspace.frontmostApplication，再读 AXFocusedApplication、AXFocusedWindow 与 AXTitle / AXPosition / AXSize。关键调用在 `0x3a34`、`0x4108`、`0x4190`、`0x4218`，因此不是仅凭导出函数名判断它读取了当前应用。

parseFocusedAppInfo 会把 webURL 改成 URL 的 origin + pathname，因此这一处理路径剔除了 query 和 fragment。没有网页 URL 时不会凭空生成域名。证据：J-APP、J-URL。

浏览器 URL/title 的原生路径也已核对：findWebInfoByTraversingUp 从 AXFocusedUIElement 出发，沿 AXParent 批量读取 AXURL / AXTitle（`0xafb0`）。这是辅助功能树信息，不是直接读取浏览器 HTML DOM。

### 输入框与选区

ContextHelper.getFocusedElementInfoAsync 提供 role、bounds、editable、domIdentifier、domClassList。InputHelper.getCurrentInputState 提供 startIndex、endIndex、selectedText、beforeText、afterText。

归一化后的 `text_insertion_point` 包含：

- input_area_type、accessibility_role、position_on_screen。
- input_capabilities：is_editable、supports_markdown、dom_id、dom_classes。
- cursor_state：cursor_position、has_text_selected、selected_text、text_before_cursor、text_after_cursor、full_field_content。
- surrounding_context：text_before_input_area、text_after_input_area。

原生 InputHelper 先读 AXFocusedUIElement。选区独立入口读 AXSelectedText；输入状态入口优先读 AXSelectedTextMarkerRange / AXTextMarkerRangeForUIElement / AXStringForTextMarkerRange，失败时用 AXValue + AXSelectedTextRange 拆成前文、选区、后文。返回前将前文保留靠近光标的尾部、后文保留靠近光标的头部，各最多 5,000 个 Swift Character。原生入口的 Int32 参数是超时毫秒数，不是字数限制；底层 AX 读取本身可能已经取得整个输入元素的值。

full_field_content 在 JS 层等于 beforeText + selectedText + afterText；这里的 selectedText 已经 Fo 裁剪，默认使用约 5,000 token 的估算预算，并先把输入限制为前 30,000 个 JS UTF-16 代码单元。原生的 Swift Character 上限与这份 token 估算是两种不同限制。该拼接字段不能保证是整个输入框或原文档全文。JS 还有特定应用适配，例如 Notion 的 AXWebArea 分支可清空前后文。证据：J-INPUT、J-STATE、J-SELECT；原生 `readCurrentInputText@0x3c50`、`captureCurrentInputState@0x51dc`。

### 选区复制回退与剪贴板

单独 getSelectedText 先调用 InputHelper.getSelectedText；结果为空且 disableSimulateCopy 未开启时，再调用 getSelectedTextBySimulateCopyAsync。前端在 Ask Anything / VOICE_COMMAND 模式没有初始选区时使用该路径，Finder 会禁用模拟复制。原生复制回退的实际顺序是：保存 generalPasteboard 的 items/types/data → clearContents → 主队列发送 Command+C → 约 100 毫秒后用 stringForType(NSPasteboardTypeString) 读取新文本 → 尝试恢复保存的快照。备份、清空、读取的关键调用分别在 `0x8b08`、`0x8b18`、`0x9540`。

因此，“是否读取剪贴板”的答案是会读取：包括旧内容的备份与复制后的文本。但已追踪的返回值来自复制后的文本，用途是取得选区；没有证据表明旧剪贴板文字在这条链路被送作模型参考。恢复也不是所有情况下都保证成功：空快照直接返回而不清空新内容，非空快照写入结果未在该路径检查，详见 InputHelper 笔记。

另对 ASAR 内 dist 下的 83 个应用 JS/MJS 文件搜索 readText、clipboard:read、readHTML、readRTF、clipboard_context、clipboardContent、clipboard_content，未命中字面量。这个有界结果不能排除动态属性或其他未追踪路径读取。见 [搜索范围记录](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/typeless-context-evidence/clipboard-js-search.json)。

主进程里还存在 clipboard:write-text / write-image，它们用于输出或界面操作，本身不是“剪贴板内容送入语音模型”的证明。

## 3. 采集分两阶段

证据 R-INITIAL、R-EXPAND 表明 START_AUDIO 处理有两阶段：

1. 先调用 getAudioContext，focusedInputOptions.inputStateParams=[]，取得应用身份、输入框及光标状态；创建 audio_id 和 session，初始快照随 start_audio 发送。
2. 设置模式参数后，异步再次获取上下文：visibleTextParams=[10000,{timeout:500}]；relatedContentParams=[1000,1000,{timeout:500}]；inputStateParams=[]。原生实参流确认 10000 是可见文字长度预算、1000 是元素周边前后各自的 targetChars 预算，500 是另外的超时毫秒数；未验证精确 Unicode 截断规则或硬截止效果。
3. 合并扩展快照时保留第一次的 cursor_state 和初始选区；仍属于同一个未结束会话时，发送 replace_audio_context。录音结束后到达或旧会话的结果会被条件拦截。

原生证据确认这里的 visible_screen_content 来自 AX 树：查找焦点窗口，必要时回退到 AXMainWindow，再 findWebArea → collectVisibleTexts → smartJoin。getElementText 批量读取 AXRole / AXValue / AXTitle / AXIdentifier，调用点 `0xd728`。输入框周边内容则从焦点元素出发，通过 AXParent / AXChildren 调用 collectContentBefore / collectContentAfter；它与光标前后文本是不同采集路径。已追踪的这些路径没有使用截图/OCR。上述数值是请求参数，不代表每次都成功返回足量文字。

采集器查询应用及 URL 配置，得到 is_text_capture_blocked_by_blacklist；代码用这个条件限制 visible text 和 surrounding content 两条扩展路径。输入状态采集仍有独立条件，不能把该标记直接解释为所有文字均被禁止读取。自身应用、无数据、超时及部分特殊应用均有另外的处理。

## 4. 上下文如何进入服务端处理

### 实时路径

renderer 的 WebSocket 服务连接默认 API host 对应的 `/ws/rt_voice_flow`。start_audio 携带 audio_id、audio_context 和 audio_metadata，音频分块另以二进制 Blob 发送；更完整的上下文通过 replace_audio_context 更新同一 audio_id。

handleSendLogic 在发送带 audio_context 的 JSON 前调用 encryptSensitiveFields，经 rsa:encrypt IPC 使用主进程加密包装。具备公钥时使用 RSA-OAEP 包装随机 AES key、AES-256-GCM 加密内容；无可用公钥或失败时另有 fallback，不能声称这一字段在所有配置下都采用同一种加密方式。代码不是在客户端展开一个可见的 system/user prompt。证据：R-ENCRYPT、R-SEND、J-ENCRYPT、J-RSA-AES。

模式映射为 transcript、ask_anything、translation。VOICE_COMMAND 会在 set_mode_config.parameters.selected_text 中额外提供选区；VOICE_TRANSLATION 提供 output_language。选区因此既是通用 audio_context.cursor_state 的一部分，也可以成为明确任务参数。只有 audio_context 进入上述敏感字段包装，不能由此推断其他参数也采用同样的字段加密。

客户端 handleMessage 接收 transcription，再分别处理 audio_processing_completed / refine_completed / refine_selected_text，成稿从 refined_text 取出。初步转写与整理结果都是服务端消息。证据：R-RECV、R-TRANSCRIPT、R-REFINE。

### HTTP 重试／回退路径

renderer 的 sendRetryRequest / startRefineRace 调用主进程 audio:ai-voice-flow。后者读取同一 audio_id 对应的记录，将 audio/ogg 文件、mode、audio_context、audio_metadata、parameters 等组为 FormData，POST 到 `/ai/voice_flow`。默认 host 由安装包代码设为 https://api.typeless.com；存在开发 host 覆盖分支，但本次未读取用户配置确定实际覆盖值。

该路径同样发送上下文；不是只重传音频。mode_meta.selected_text 在命令模式成为 parameters.selected_text，翻译模式使用 output_language。最终使用服务端返回的 refine_text 及相关结果字段。证据：J-HTTP、R-RETRY、R-FALLBACK。

### 可以与不可以推断的处理分工

可以确认：本次追踪的客户端路径把音频、上下文和模式参数交给同一服务端语音流程，并接收转写与整理结果；选区在命令模式有明确独立的参数通道。

不能确认：具体 ASR 模型、LLM 模型、完整提示词、是否把上下文作为 ASR 热词/提示、哪些字段被服务端忽略或用于成稿。客户端发送了一个字段，不等于每一个模型都消费了它；模型效果需要另行实测，服务端实现需要另外的证据。

## 5. 另一条上下文用途：输出后的修改反馈

插入结果后，前端可启动 track-edit-text。主进程确认当前输入框可编辑且包含刚插入的成稿后保存基线，监听焦点与按键、轮询输入框内容，初始停止计时为 15 秒；检测到编辑时可重置这个计时器，因此不能称为严格的总时长上限。满足小幅修改条件时，将 refined_inserted_text、original_input_box、edited_input_box、active_application、device_environment、mode 经包装提交到 `/user/traits`。

客户端处理服务端返回的 auto_add_dictionary 条目。这个事实支持“存在修改反馈和词典更新的客户端接口”；不能直接推断模型训练、数据保留期限或所有修改都会上报。证据：J-TRACK-START、J-TRACK-CHECK、J-TRAITS。

## 6. 对输入法 skill 的启示（设计推论）

本案例可借鉴的是宿主提供结构化上下文，而不是让 skill 自己猜屏幕：活动应用、插入点、光标前后文字、选区分别有确定字段；快速快照和异步扩展分开；选区保留到同一任务会话；文字处理与采集质量分开记录。

这些能力仍依赖宿主的原生采集器、权限与应用适配。skill 本身不能凭提示词取得上下文，也不能补出文件操作等执行工具。本次没有改动 Typefree 产品代码。
