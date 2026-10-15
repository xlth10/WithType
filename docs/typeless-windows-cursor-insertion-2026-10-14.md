# Typeless Windows：光标、焦点与自动插入调研

调查日期：2026-10-14。依据从 [Typeless 官网](https://www.typeless.com/downloads) 下载的 **Windows 2.8.2 x64 安装包**，静态分析实际发行包中的 JavaScript、InputHelper.dll、ContextHelper.dll 和 KeyboardHelper.dll，并对照当前 WithType Windows 源码。没有运行安装器、应用或 DLL，没有修改产品代码。

后续开发：本报告的 WithType 对照及源码行号描述改造前快照。落地代码和最新验证状态见 [Windows 输入可靠性改造记录](windows-input-reliability-2026-10-14.md)。

## 结论

**Windows 版最值得借鉴的是焦点获取回退、文字容器定位和多种 UIA 能力组合。** 这三项比单纯调整光标屏幕坐标更贴近当前 WithType 的“已转写、不能自动插入”问题。

Typeless 的实际机制可以拆成五项：

1. ContextHelper 首先查询 UIA 焦点，失败时用前台 HWND、线程焦点和 `ElementFromHandle` 回退；可编辑性还组合 Value、Text、Text2、TextEdit、Legacy/MSAA 等信号。
2. InputHelper 获取逻辑光标和选区时，会寻找当前、父级、子级和 TextChild 的文字容器；优先按 TextRange 读取，失败且未超时时再用 Character unit 路径。
3. 录音浮条配置为不可获取焦点。听写完成时重新读取**当前**应用和输入框，随后尝试插入；已追踪链没有向插入器传初始 HWND、控件身份或光标位置。
4. 普通文字通过剪贴板和 `SendInput` 发送 Ctrl+V；native 的成功值表示四个键盘事件已送入输入流。可编辑性判断位于 renderer 插入调用之后，用于编辑跟踪及复制提示，不能把这条路径称为先确认输入框再投递。
5. 每个注入事件带自定义标签，KeyboardHelper 识别此标签并绕过常规快捷键处理。旧剪贴板在后台约 500ms 后尝试恢复。

**没有证据证明它在已追踪链中强制恢复录音开始时的光标，或把“目标文字已改变”作为必需的成功回执。** 较宽松的粘贴策略可以减少辅助功能误判导致的拒绝，也留下错误落点、静默失败和剪贴板竞争的待测边界。

## 产物、方法与置信度

官方下载入口 `/desktop/windows/download` 在本轮重定向到 `Typeless-2.8.2-x64-Setup.exe`。下载 156,427,200 字节，SHA-256：`2cae8354eb2557e64e36257ebdc6970e68af248218c4ddf324dfb5b463695c36`；响应 Last-Modified 为 2026-10-10 15:10:03 UTC。包内 package.json 同样标为 2.8.2。

安装器是 NSIS。定位偏移 494,033 的嵌入 7z，核对 start/next-header CRC32 后精确截取 155,541,394 字节，用现有 libarchive 3.8.3 解压所需文件；没有运行安装器。84 个 dist JS/MJS 成员全部匹配包内声明的 member hash。

| 对象 | SHA-256 |
| --- | --- |
| InputHelper.dll | `a4ceed4368b274994ad23b82cf3e4e7733b1e04feb1ba21f2b5b82e0ecfab174` |
| ContextHelper.dll | `ba812400599aa4457988756cf842ed1c4eb0b32528f53a259fa56c8b3b7b1869` |
| KeyboardHelper.dll | `1112553a22909eb75e488c0134671706e90ab83fc764ad59b2126951d467d3a8` |
| Windows 主进程 dist/main/index.js | `9b1a2a972721d24dec2dff4ae50789b37bee1df2ef737b9a7918924a091fef47` |

REA 成功建立 Windows JS 局部图并追踪完成投递、InputHelper 包装和焦点分派；core Evidence 为 `ev_5669d61f04acfc438ec868c5890bcdb9ef70d2011d6929f91cc6ac8455c904f1`，补充为 `ev_ff813742b41b11f0ab30752b4d846fee90f741c6e8f5f5a60b7d0ebd547d6b26`。其中 imports/动态调用/省略依赖存在未知，不能把局部图当成完整运行架构。JS 阅读视图通过惰性 Babel AST 字符串表替换取得，未执行 bootstrap；运行等价性未测试。

REA 的 InputHelper 原生产物检查成功，Evidence：`ev_d432cf5d91fcb9e9f92b426f2ca916dfd525b3a516fdf2a9dccb773879370a7c`。Hopper `analyze_function(insertText)` 在启动阶段超时（120,000ms / not_started），没有取得原生反编译 Evidence。以下原生行为来自 **Apple LLVM 21 的 PE x64 反汇编、PE imports/exports/.pdata/RVA 解析，以及 Microsoft 官方 UIAutomationClient.h 的 COM vtable 核对**，都有实际 call/参数/分支锚点。

原生地址均是指定 DLL 的首选 RVA；VA = `0x180000000 + RVA`，不是带 ASLR 的运行地址。LLVM 按最近导出显示的 `insertText+...` 等标签不能当作内部函数原名。

Windows Authenticode 签名链与吊销状态未在本机 macOS 上验证；HTTPS 官方入口、文件摘要、压缩包完整性和成员哈希是本轮身份依据。没有 Windows 运行环境，成功率、焦点竞争和实际权限行为均未实测。

可复核资料：[产物与方法清单](./typeless-windows-cursor-evidence/artifact-manifest.json)、[JS 原始字节锚点](./typeless-windows-cursor-evidence/js-source-ledger.json)、[补充锚点](./typeless-windows-cursor-evidence/js-additional-ledger.json)、[绑定关系](./typeless-windows-cursor-evidence/js-binding-ledger.json)、[REA JS 摘要](./typeless-windows-cursor-evidence/rea-js-summary.json)、[native REA 状态](./typeless-windows-cursor-evidence/rea-native-status.json)。完整提取文件、反汇编和 JS Evidence bundle 位于 `/private/tmp/typeless-windows-20261014/`，临时目录可能被系统清理；正式索引保留身份和定位范围。

## 1. 焦点：UIA 失败后还走 Win32 回退

ContextHelper 调用链：`getFocusedElementInfoAsync@0x2a1d0 → 0xe1b0 → worker@0x10b50 → 0xd690 → 0x2e0c0 → 0x2d5f0`。

`0x2d5f0` 内先调用 `IUIAutomation.GetFocusedElement`（`0x2d6bb`，vtable +0x40）。HRESULT 失败或返回空元素时：

1. `GetForegroundWindow` 得前台窗口，取目标线程和当前线程。
2. 必要时 `AttachThreadInput(TRUE)`，随后 `GetFocus`；无焦点或不能 attach 时改用 `GetGUIThreadInfo`。
3. 从 GUI thread info 依次选 `hwndFocus → hwndActive → foreground HWND`。
4. attach 过则 detach；用 `IUIAutomation.ElementFromHandle` 将 HWND 转成 UIA 元素。

metadata 还用元素的 NativeWindowHandle、线程焦点和 `IsChild` 校正 HasKeyboardFocus。它避免把某一次 UIA 焦点读取失败直接解释为没有输入位置，但回退到前台窗口本身也不保证得到了具体编辑控件。

**这里的 `GetGUIThreadInfo` 已建立的用途是窗口焦点回退。** 不能因为该 API 也包含 rcCaret，就声称 Typeless 在这条路径中用屏幕 caret 坐标选择插入位置。微软也说明 `GetFocus` 是线程局部的；跨线程焦点需要考虑消息队列归属。[GetFocus](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getfocus)、[GetGUIThreadInfo](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getguithreadinfo)

实际调用和 COM slot 见 [Context 原生证据](./typeless-windows-cursor-evidence/context-native-findings.md) 第 1、2 节。

## 2. 光标：寻找文字容器，再读取选区范围

InputHelper 的 `getCurrentInputState`：`0xf440 → 0xf6c0 → 0x10760 → 0x14e10`。这里首先独立调用 UIA GetFocusedElement；尚未看到它直接复用 ContextHelper 的 HWND 焦点回退，因此“应用信息能获取”与“光标前后文字能获取”仍是两种能力。

`0x14e10` 调 `0x12600` 查找可提供 Text/Text2 的元素：

- 先检查当前元素。
- 缺失时用 RawViewWalker 取父元素。
- 再检查当前元素的 children。
- 仍无结果时通过 TextChildPattern 的 TextContainer 获取文字容器。

读取优先走 `ByRange@0x12b80`：取得 DocumentRange 和 `GetSelection`，取第一个选区范围及 selected text；克隆文档范围，并用 `MoveEndpointByRange` 拼出选区之前和之后的范围，读取 before/after text。

结果为空且未超时，改走 `ByUnit@0x13d20`：同样从 selection 定位，再通过 `MoveEndpointByUnit(TextUnit.Character)` 读取周边文字。最后序列化 `startIndex/endIndex/selectedText/beforeText/afterText`。已见周边预算 5,000 和超时检查，但精确 Unicode 索引、截断规则及所有失败分支未完全核对。

这条已追踪链的光标信息主要来自 **Text selection range**。ContextHelper 的 Text2.GetCaretRange 是另一个可编辑性信号；不能把它移植成 InputHelper 已算出了精确屏幕坐标的证据。详见 [InputReader 证据](./typeless-windows-cursor-evidence/input-reader-findings.md)。

## 3. 可编辑性：组合多种能力，再用兼容路径补足

ContextHelper `IsElementEditable_Conservative@0x35110` 实际检查启用状态，缓存若干属性/模式，并组合：Value 的只读状态、Text2 active caret、Text visible range 的 IsReadOnly、TextEditPattern、Value/RangeValue 的只读属性，以及 Legacy role/state。肯定候选还会检查键盘焦点。

UIA/cache 失败后，代码另使用 `AccessibleObjectFromWindow(OBJID_CLIENT)` 和 IAccessible 的 accFocus；满足相应条件时，进程 basename 兼容名单包含 `sublime_text.exe`、`atom.exe`。该判断不只依赖 ValuePattern，但也不能描述为无条件把所有文字控件判成可写。

ContextHelper 在上下文准备中还发送 `WM_GETOBJECT(lParam=1)`，使用 `SendMessageTimeoutW`、100ms 和 SMTO_ABORTIFHUNG，随后发出 `NotifyWinEvent`；日志称 Chrome-style AT detection。能证明它尝试唤醒/探测可访问性接口，不能保证具体 Chromium 版本因此提供有效 UIA 数据。

renderer 还有另一套应用/网址兼容名单。`blacklist` 被消费者解释为 BestEffortInsertion，`whitelist` 被解释为 GuaranteedWritable：例如 best-effort 列出 Word/Excel、终端、Notepad++、微信、WPS 等，另一组列出 Cursor、企业微信、QQ、Trae 等。**在已追踪听写链里，两组名单都影响无法识别 editable 时是否显示复制提示，并不阻止前面的粘贴尝试。** 名称不能当作应用兼容性保证，服务端刷新后的有效配置也未读取。

主 JS 在元素数据为空或异常时还有 `is_editable:true` 的上下文回退对象。这是容错默认值，不是经过验证的可写结论。证据：原始 `fSFyXeKS.mjs` 的 Uo/na/fr 与 main 的 oi/ii，字节范围见 JS ledger。

## 4. 维持焦点：不聚焦的浮条，没有建立强制恢复原光标的链

Windows 主 JS 的录音浮条 `Jp` 配置 `focusable:false`，默认鼠标穿透，并按定义的交互区域切换鼠标事件。显示基类使用 `.show()`；本轮没有看到它调用 `.showInactive()`。配置意图是维持外部焦点，真实 show/hide/click 行为仍需 Windows 测试。

值得区分的一个事实：浮条 click 回调虽调用 `activateAppSilently`，该函数的 `win32` 分支直接 `break`。另有 PowerShell `WScript.Shell.AppActivate` 方法，但这处分派没有调用它；不能据此声称 Windows 点击浮条后会自动恢复录音开始时的输入目标。

初始 audio context 在录音开始时采集，但听写完成 helper `dr` 会重新读**当前** app/input，接着调用插入，再判断 editable。这条 JS→IPC→native 路径只传文字，没有初始 HWND、RuntimeId、选区或光标位置。InputHelper plain 插入及已跟踪帮助函数也没有重新选择原窗口/原选区的动作。

因此，推断这条路径主要依靠维持当前系统焦点。这个推断限定于所追踪链，不能排除其他未覆盖模块的全局状态；也不能把“官网承诺出现在开始位置”当成已验证的原始目标锁定。[Typeless Dictate](https://www.typeless.com/help/quickstart/dictate)

## 5. 自动插入：剪贴板与 Ctrl+V，成功值只到输入流

普通文字链：`renderer dr → l9 → xi.insertText → keyboard-input:insert-text → main gf/ii → native insertText@0xf480 → 0xdf30`。ABI 为 `int32_t insertText(const char *text)`，没有目标参数。

`0xdf30` 保存旧剪贴板格式，随后 `0xba90` 写入 CF_UNICODETEXT：OpenClipboard、EmptyClipboard、分配并复制 UTF-16 数据、SetClipboardData。失败会返回 false，上层 native 不会继续把该失败当成功。

`0xbbe0` 构造四个 INPUT：Ctrl down、V down、V up、Ctrl up，调用 `SendInput(4, ..., sizeof(INPUT)=40)`；只有返回值为 4 才 true。`insertText` 在 `0xec63` 调它，将结果保存并在正常返回路径使用该结果。**这是输入流事件数确认，不是编辑器内容确认。** native 的“Clipboard verification”日志读取的是剪贴板内容，也不是目标输入框。[Microsoft SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput)

富文本另通过 IDataObject、OleSetClipboard/OleFlushClipboard 写多格式数据，再走同一个 Ctrl+V helper。本轮建立了调用关系，未测试各编辑器最终采用 HTML、纯文本或其他格式的行为。

每个键盘事件的 dwExtraInfo 都是 `0x54594c45`；KeyboardHelper 的 WH_KEYBOARD_LL callback 在 `[lParam+0x10]` 比较该值，匹配则绕过常规快捷键处理区。它减少自身插入事件与自身热键处理相互干扰的机会，但标签分支仍有条件吞键路径，不能声称全部无条件透传。证据：[Ctrl+V 指令](./typeless-windows-cursor-evidence/input-ctrl-v.txt)、[KeyboardHelper 探针](./typeless-windows-cursor-evidence/keyboard-native-findings.md)。

Windows 主程序的真实 RT_MANIFEST 为 `level="asInvoker" uiAccess="false"`。ContextHelper 会采集 elevated/isAdmin 信号，但这个检测不绕过 UIPI。正常权限进程向更高完整性级别目标注入仍受系统限制，实际进程权限未在本轮观察。[主 manifest](./typeless-windows-cursor-evidence/main-manifest.json)、[Microsoft 输入限制](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput)

## 6. 失败回执、恢复与结果取回

**native 层比 Mac 已检查的入口多了事件数成功判断，但该结果在 JS 层没有成为可靠回执。** `ii.insertText` 在 native 非 1、异常或 isInserting 已占用时没有向调用方提供结构化失败；只有 native 返回 1 时等待 500ms。renderer 的 plain wrapper 只对抛出的异常记录监控；native false 被吞掉时，不会触发同样的异常回退。

editable 为 true 时，renderer 可在 200ms 后启动 edit tracking。主进程重读上下文，要求 full_field_content 包含规范化后的成稿；失败则记录 start-track failed 并返回。已检查消费者没有将它作为必需的投递回执，也没有因此自动重插。

旧剪贴板恢复由 `0xc3b0 → 0xcac0` 的后台路径执行：约 500ms 后尝试打开剪贴板；打不开时最多 5 次尝试，每次失败后约 100ms 等待；成功后清空并恢复保存的格式。延迟帮助函数最终调用 Sleep。已追踪入口及恢复链没有看到 GetClipboardSequenceNumber 的竞争保护；这不能推广为整个 App 没有相关保护。若用户在这段时间复制其他内容，存在旧快照覆盖新内容的设计风险，运行效果需验证。

用户可通过复制卡片或 History 取回成稿。官网 History 也提供 Copy 和用相同音频 Retry；后者是重新处理音频，不能一概解释成“只重发粘贴”。[Typeless History & Dictionary](https://www.typeless.com/help/quickstart/history-and-dictionary)

## 对照当前 WithType

当前 Windows 自动插入的资格判断没有使用 caret 屏幕坐标，caret 用于结果卡片定位。已经具备 TextPattern2 caret 读取、密码框/自身进程排除、按键松开等待、剪贴板 sequence 保护，以及 `sent` / `inserted` 区分。应该在这些基础上补兼容能力。

| 方面 | Typeless Windows 静态证据 | 当前 WithType | 优先动作 |
| --- | --- | --- | --- |
| 焦点获取 | UIA失败后有HWND/线程焦点/ElementFromHandle回退 | FocusedField 只调用 GetFocusedElement；另有 Win32 Focus 身份，但未合成替代 UIA element | 组合两条读取路线，核对前台窗口与候选控件关系 |
| 文字容器 | 当前、父、子、TextChild容器的Text/Text2查询 | 直接在focused element取Value/Text | 补有限、有界的文字容器查找 |
| 可编辑资格 | 多Pattern、active caret、Legacy/MSAA、应用适配 | Value可写，或Text IsReadOnly能转换为false；未知被拒绝 | 区分可写/只读/未知，增加可验证的能力组合 |
| 捕获时机 | 有初始context；本链最终按当前focus投递 | renderer先等若干步骤，再capture；600ms总预算；错误空catch | 原生快捷键先保存身份，UIA异步补齐并保留错误 |
| 浮条 | nonfocusable panel；当前链没建立Windows主动恢复 | 已set_focusable(false)，show后补SetForegroundWindow且仅日志 | 验证重复显示/点击的焦点行为，采用不激活显示路径 |
| 目标变化 | 已追踪插入链没有初始目标比对 | 要求HWND/child/UIA身份/选区/可读全文不变 | 保留跨目标保护；按适配支持同框重建与稳定锚点 |
| 成功确认 | native确认事件数，JS结果静默；tracking不是回执 | 150ms后一次全文核对，长文档/慢provider容易未确认 | 有界重查附近文本，保持sent状态，不自动重复粘贴 |
| 剪贴板 | 后台恢复旧快照，已追链无sequence保护 | 保护用户途中复制的新内容，成稿可取回 | 保留竞争保护；恢复旧快照必须核对sequence |

源码位置：[uia.rs:34](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/uia.rs:34)、[可写资格:97](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/uia.rs:97)、[目标有效性:121](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/delivery/platform.rs:121)、[捕获期限:250](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/delivery/platform.rs:250)、[前端捕获:833](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/App.jsx:833)、[浮条显示:1173](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/lib.rs:1173)、[nonfocusable配置:1375](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/lib.rs:1375)、[写入确认:424](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/delivery/platform.rs:424)。

## 建议落地顺序与验收

这是 WithType 的实现建议，本轮尚未实施或验证：

1. **先提供具体拒绝原因与分阶段耗时。** capture timeout、UIA unsupported、明确 readonly、focus/selection/content changed、clipboard changed、send failed、sent unverified 分开记录。用窗口/PID、脱敏控件标识、HRESULT 和事件数定位，不把用户全文写入诊断日志。
2. **原生提前保存目标身份，并验证浮条不激活。** 先保存 HWND/child/PID，麦克风和UIA可并行。针对现有show后恢复的竞态，评估 SW_SHOWNOACTIVATE/SW_SHOWNA 与 WS_EX_NOACTIVATE；恢复顶层窗口后仍要检查子控件和当前焦点。不能仅因为设过focusable=false就认定行为正确。[ShowWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-showwindow)、[窗口样式](https://learn.microsoft.com/en-us/windows/win32/winmsg/extended-window-styles)
3. **补焦点/文字容器回退和多Pattern判定。** 引入有界ElementFromHandle、父/子/TextChild候选；结合Value、Text2 active caret、TextEdit与Legacy数据。未知能力在经验证的应用/控件适配、稳定目标和按键已松开时才允许一次兼容粘贴；保留明确只读、密码框、自身进程和跨目标保护。
4. **完善确认，再调整过严的整框相等检查。** 使用选区附近锚点和短时间有界重查；控件正常重建按明确适配处理。录音中手动移动光标的落点要定义为产品语义；跨应用切换时保留结果。未确认的粘贴保持sent，不能自动再发一遍造成重复文字。
5. **按实际故障决定是否增加原生能力。** 自注入标记对未来自有低层hook有帮助，但当前不应仅为了模仿Typeless重写热键；HTML/OLE富文本和临时剪贴板恢复也应按产品需要另立验收。

Windows 实机矩阵：Notepad、浏览器 textarea/contenteditable、Word/Excel、Cursor/VS Code、终端；加入第二次显示浮条、点击浮条、慢provider、长文档、emoji/中文选区、同框移动光标、DOM重建、处理中复制其他内容、跨应用切换及高权限目标。每次分别记录“捕获、资格判断、实际发送、内容确认、用户看到的结果”；一次任务最多自动发送一次粘贴。

## 问题清单的完成情况

| 问题 | 状态 |
| --- | --- |
| 是否取得真正Windows发行物 | 已回答：官方2.8.2 x64包、CRC/成员hash、文件身份均记录 |
| 光标/选区怎样读取 | 已回答主要链：文字容器寻找、UIA selection、ByRange/ByUnit；精确Unicode及全部限制未穷尽 |
| 焦点怎样定位、是否恢复初始目标 | 已回答主要定位/回退和JS分派；当前链未建立强制恢复初始目标，其他全局路径仍可能未覆盖 |
| 自动插入使用什么API | 已回答：plain剪贴板/富文本OLE + SendInput Ctrl+V；事件数返回与自注入标签已追到指令 |
| 如何确认成功/取回失败结果 | 部分回答：事件流成功、可选tracking及复制/历史路径已建立；真实目标送达和整体动态恢复未验证 |
| 哪些机制值得WithType采用 | 已提出有源码依据的优先级，尚未实施 |
| 跨应用成功率和具体用户失败根因 | 待Windows实机日志与测试；本轮不提供成功率保证 |
