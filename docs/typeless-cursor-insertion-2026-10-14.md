# Typeless 光标、焦点与自动插入调研

调查日期：2026-10-14。目标：解释 WithType 的“语音已转写，但无法在光标处自动插入”，并核对本机 Typeless 可借鉴的策略。本轮完成静态调研和当前实现对照，未修改产品代码。

## 结论

**优先排查 WithType 的输入框资格判断、目标捕获时序和插入确认。** 当前 Windows 代码的自动插入资格不依赖光标屏幕坐标；坐标用于结果卡片定位。UIA 信息不完整、600ms 捕获超时、录音期间焦点/选区/全文变化，都可能让本次任务降级为复制。现有逻辑把几种情况合并成“没有可用输入位置”，不利于诊断。

Typeless 本机 2.8.2 的核心策略是：辅助功能读取当前应用、焦点元素和选区；浮条配置为不可获取焦点；完成时重新读取当前焦点；临时写剪贴板并模拟粘贴；借助应用/网址兼容名单决定后续提示。**在已追踪的听写链中，可编辑性不是发送粘贴的前置条件。** 这可以解释它如何兼容辅助功能信息不完整的编辑器，但本轮没有测量成功率。

值得借鉴的是兼容策略和焦点管理。应保留 WithType 已有的密码框排除、目标变化保护、剪贴板竞争保护，以及 `sent` / `inserted` 区分；不能把 Typeless 的 native 返回 `1` 当成“文字已进入目标”。

## 范围与证据

- 本机对象：`/Applications/Typeless.app`，2.8.2 / build 2.8.2.131；以前的仓库记录是 2.8.1，不能直接沿用版本身份。
- ASAR SHA-256：`49ee4061c662c4284e1d79327e2b0c4389d2df1fc1de9004e252e6e6f8528ad9`。
- InputHelper SHA-256：`798a08c986b6d764e51f4d1d2cf858ac10d3864328efe2630247266b863d867c`。
- ContextHelper SHA-256：`6c9c5fdba13f8cc5c9efe7483bc2248dc1aba93a2c9e511b3cfba31fac9d8abb`。
- 从当前 ASAR 读取 83 个 dist JS/MJS 文件，全部匹配包内声明的 member hash。重新做只读签名检查仍返回 `invalid signature`，原因未查明；结论限定于这份本机副本，发行物真实性未核验。
- 使用惰性的 Babel AST 解析和字符串表有界解码，未执行 Typeless 应用代码。主 JS 阅读视图进行了 334 次表旋转、9,608 次替换；名字级别的 alias 收集不构成运行等价证明。
- 重新生成两份 helper 的完整 arm64 反汇编：除输入文件标题外，与保存的 2.8.1 反汇编逐行一致。InputHelper 的 `__DATA,__data` 和 `__TEXT,__cstring` 也逐字一致。ContextHelper 的其他数据段未做全面比较，不能宣称整个二进制等价。
- REA `open_binary` 成功绑定 InputHelper；`search_procedures` 在 Hopper 启动阶段超时，120,000ms / `not_started`。没有获得原生反编译 Evidence，原生结论来自本轮 `nm` / `otool` 及上述比较。
- REA 对两组精确 AST 声明片段（共 5,403 字节）成功分析，Evidence：`ev_f23ac6e3ee55af3506c4981837ff8db51b3a56e8730289213c57cba19296f0a7`。图有 9 个 IPC 操作，其中 8 个 channel 是动态表达式，coverage 为 partial；省略的 imports/依赖没有被恢复。
- REA 对 `is_editable` 的 literal trace 没有匹配：`ev_1f03224c70c2fbce0a38f1bf2d8ef2b92c5ed396bf73d2607ee2f44b503e1187`。这表示图覆盖不足，不能当成功能不存在的证据。下面的投递顺序由完整 member 静态检查补齐。
- 已导出完整 REA bundle 到 `/private/tmp/typeless-cursor-20261014/rea-evidence-bundle.json`，然后关闭 native session。没有启动 Typeless、读取个人历史或进行真实语音输入。

长期复核索引：[产物身份](./typeless-cursor-evidence/artifact-manifest.json)、[ASAR 成员摘要](./typeless-cursor-evidence/asar-members.json)、[原始源码字节锚点](./typeless-cursor-evidence/source-ledger.json)、[解码摘要](./typeless-cursor-evidence/decode-summary.json)、[REA 结果及限制](./typeless-cursor-evidence/rea-summary.json)。原始提取文件及反汇编在 `/private/tmp/typeless-cursor-20261014/`，临时目录可能被系统清理；仓库索引保留成员身份、SHA-256 和字节范围。

## Typeless 的方案

### 1. 光标信息来自辅助功能接口

InputHelper 的 `locateInputElement@0x4c94` 读取系统 `AXFocusedUIElement`。`readCurrentInputText@0x3c50` 优先使用 `AXSelectedTextMarkerRange` / `AXTextMarkerRangeForUIElement` / `AXStringForTextMarkerRange`；不支持时回退到 `AXValue + AXSelectedTextRange`。由此取得选区和光标前后文字；前后文分别截到最多 5,000 个 Swift Character。范围单位和复杂 Unicode 的运行表现未测量。

ContextHelper 另读应用身份、窗口、焦点元素角色及可编辑信息。这里的焦点读取和插入是两个独立入口；没有证据表明读取到的 AX 元素随后作为参数传给插入器。

这些路径不需要从屏幕上识别一条闪烁竖线。Apple 将 `AXSelectedTextRange` 定义为辅助功能对象内部的文本选区属性。[Apple 属性文档](https://developer.apple.com/documentation/applicationservices/kaxselectedtextrangeattribute?language=objc)

原生证据锚点：本轮 `native/input-assembly.txt` 的 `0x3c50`、`0x4c94`、`0x51dc`；具体指令解释见 [此前 InputHelper 核查](./typeless-input-context-notes.md)，本轮已核对对应反汇编和静态数据一致。

### 2. 浮条尽量维持输入焦点

主进程 `cg.getWindowOptions` 将录音浮条设置成 panel、`focusable:false`；创建时默认忽略鼠标事件。鼠标跟踪用于选择屏幕及浮条位置，不能据此解释为用鼠标坐标确定文字插入点。回答卡片是另一类可获取焦点的窗口，不能混为录音浮条。

主进程 `hf.prepareAccessibility` 在上下文采集前调用 `setFocusedWindowEnhancedUserInterface`，再等 30ms。ContextHelper 对应函数存在 `AXEnhancedUserInterface` 属性读取和设置调用（`0x6b04`、`0x6b4c`、`0x6b9c`）；这证明有增强辅助功能状态的准备路径，不证明所有宿主都支持它。它是 macOS 方案，不能直接替代 Windows UIA。

证据：main 阅读视图 4322–4358、7684–7687；原始成员中 `cg` / `hf` 的字节范围见 source-ledger。`focusable` 的平台语义见 [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window#winfocusable-windows-macos)。

### 3. 完成时读取当前焦点，再尝试粘贴

`DFvLNtQv.mjs` 的听写完成 helper `dr` 按以下顺序执行：

1. `ur()` 并行重读当前应用和当前输入框信息。
2. 调用 plain-text 插入 wrapper，经 `xi.insertText → keyboard-input:insert-text → 主进程 Ne.insertText → InputHelper`。
3. 使用步骤 1 的 `is_editable` 决定启动后续编辑跟踪，或按兼容名单决定显示复制卡片。

因此，这次读取是在插入之前；**不是一次插入后的成功检查**。这条 helper 也没有比较完成时对象与录音开始时的 app/element 是否一致。焦点期间变化时的实际落点尚未运行验证。

native `insertText(const char*)` 不接收目标 PID、窗口或 AX 元素。已跟踪路径保存旧剪贴板，写文本及 transient 标记，发送全局 Command+V，约 500ms 后尝试恢复旧快照。富文本入口同时写 HTML 与纯文本。没有看到此插入路径用 AX 直接改控件值或逐字输入。

native 的有效参数路径安排粘贴后返回 `1`；`performTextInsertion@0x6914` 返回 true，没有读取目标内容确认写入。JS 在 native 非 `1` 或异常时没有向上层返回结构化失败；`isInserting` 为 true 时会跳过并发调用。后续编辑学习会检查输入框是否包含成稿，但该检查失败只停止学习，不构成这条投递链的自动恢复。

证据：renderer 阅读视图 `DFvLNtQv.mjs` 3224–3234、3251–3269；`C_18RWmm.js` 15131–15155；main 7164–7193、8445–8447、11449；原生 `0x66d8`、`0x6914`、`0x82d8`、`0x8490`、`0x8738`、`0xbe3c`。完整 native 路径及空快照边界见 [插入核查](./typeless-insertion-interaction-notes.md)。

### 4. 应用和网址适配缓解辅助功能覆盖不足

renderer 有 `app_blacklist/app_whitelist/url_blacklist/url_whitelist` 配置，可由服务端刷新。沿消费者追踪，这里的 blacklist 被解释为 `isBestEffortInsertion*`，whitelist 被解释为 `isGuaranteedWritable*`。两类名单都影响“辅助功能判为非 editable 时是否显示复制卡片”，并不在上面的听写 helper 中阻止粘贴。

本机配置示例：macOS best-effort 列出微信、Excel、Sublime、Zed；whitelist 列出 Slack、Mail、Figma 等；URL best-effort 前缀包括 Google Docs 和腾讯文档，whitelist 包含 Figma Design。名单标记表达兼容策略，不是这些产品的可编辑保证。

主进程输入上下文还有 Notion `AXWebArea` 特例：清空光标前后文字。异常回退对象 `ui` 默认 `is_editable:true`；这属于上下文回退，不能解释为输入框已经确认可编辑。

证据：`DFvLNtQv.mjs` 3074–3167、3273–3289；main 7442、7647–7671。macOS 包中保留 Windows 名单，但实际列表选择器在本机采用 macOS 分支；本轮没有取得 Typeless Windows 发行物。

## 当前 WithType 的具体缺口

以下是当前正式仓库的 Windows 实现，静态证据不足以确定用户每次失败的实际原因。

| 优先级 | 已见机制 | 对痛点的影响 | 位置 |
| --- | --- | --- | --- |
| P1 | `writable()` 必须拿到可写 ValuePattern，或 TextPattern 的 IsReadOnly 能转为 false；缺模式、异常、未知属性都会返回 false | 接受 Ctrl+V 但 UIA 信息不完整的编辑器可能被拒绝 | [uia.rs:97](../src-tauri/src/uia.rs#L97) |
| P1 | renderer 等待停止学习、窗口身份和任务登记后才捕获目标；之前已设 recording 状态；capture 错误被空 catch 丢弃 | 初始焦点与浮条显示存在竞态；实际是超时还是目标缺失无法区分 | [App.jsx:808](../src/App.jsx#L808)、[App.jsx:833](../src/App.jsx#L833) |
| P1 | 捕获总预算 600ms；单次 UIA transaction 300ms；capturing field、全文和选区累计后才检查是否过期；Capture/Caret/Deliver 共用 worker | 慢 UIA 或前面的队列任务可让本次目标被清空 | [platform.rs:186](../src-tauri/src/delivery/platform.rs#L186)、[platform.rs:250](../src-tauri/src/delivery/platform.rs#L250) |
| P1 | 已设置 `overlay.set_focusable(false)`，但 `show()` 后仍补做一次 SetForegroundWindow，结果仅日志记录 | 需要验证第二次显示是否仍抢焦点、恢复后的子控件是否还是原输入框；不能将“已设不可聚焦”当成问题已解决 | [lib.rs:1375](../src-tauri/src/lib.rs#L1375)、[lib.rs:1173](../src-tauri/src/lib.rs#L1173)、[lib.rs:79](../src-tauri/src/lib.rs#L79) |
| P2 | Target 必须保持顶层窗口、子窗口、同一 UIA 元素、可写状态、初始选区，以及可读初始全文不变 | 网页正常更新、同框移动光标、元素重建也可触发复制降级 | [platform.rs:121](../src-tauri/src/delivery/platform.rs#L121) |
| P2 | Ctrl+V 后固定等 150ms，再做一次全文验证；`read()` 拒绝超过 16,384 字符的文本 | 实际写入但读取延迟、无法读全文或格式改变时，可能显示 `sent`；只增加重发会有重复插入风险 | [platform.rs:424](../src-tauri/src/delivery/platform.rs#L424)、[uia.rs:89](../src-tauri/src/uia.rs#L89) |

UIA 的“未知”需要单列：Microsoft 明确说明，GetAttributeValue 可返回 NotSupported 或 Mixed 的保留值，不总是 bool。因此 bool 转换失败不能自动解释为明确只读。[Microsoft GetAttributeValue](https://learn.microsoft.com/en-us/windows/win32/api/uiautomationclient/nf-uiautomationclient-iuiautomationtextrange-getattributevalue)

系统限制也需放入实机矩阵：SetForegroundWindow 不保证成功；SendInput 受 UIPI 完整性级别约束，且返回值不能单独标识 UIPI 原因。这些是可能影响投递的系统条件，本轮没有证据表明它们已造成用户的具体失败。[SetForegroundWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow)、[SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput)

平台边界：当前仓库的非 Windows `capture()` 是空实现，`deliver()` 只复制并提示“当前平台未启用自动输入”，`caret()` 返回 None。如果痛点发生在这个构建的 macOS 上，需先补平台投递实现；Windows 的 UIA 优化不能解决该分支。[delivery.rs](../src-tauri/src/delivery.rs)

## 建议的实施顺序

以下是 WithType 的设计建议，不是 Typeless 已实现能力，也不是本轮完成的修复。

1. **先把失败原因变成可观测状态。** 返回 `capture_timeout`、`provider_unsupported`、`read_only`、`focus_changed`、`selection_changed`、`content_changed`、`clipboard_changed`、`send_failed`、`sent_unverified` 等原因。记录 session、窗口/PID、脱敏的控件标识、每阶段耗时和 SendInput 事件数；诊断日志无需保存用户全文。
2. **把初始身份捕获前移到原生快捷键入口。** 先保存 HWND/子窗口/PID，再让 UIA 补充选区和读取能力；麦克风可并行启动。验证已有 `set_focusable(false)` 在 show/hide 重复循环下的实际行为，必要时用不激活的原生显示方式。不要依赖抢焦点后恢复顶层窗口来保证输入位置。
3. **将可编辑状态改成三态。** 明确可写走确认路线；明确只读/密码框/自身进程拒绝自动写入；能力未知时，只有已验证的应用/控件适配、目标身份稳定和按键已松开才允许一次受约束的粘贴。TextPattern2、ValuePattern、TextPattern 和必要的 Win32 编辑控件能力按适配需要组合。不要把所有未知对象放行，也不要采用 Typeless 的默认 editable=true 作为保证。
4. **把整框相等判断换成适配明确的锚点策略。** 支持同窗口控件正常重建时的重新获取，优先核对选区附近文本；用户主动切换应用/输入框时保留结果。录音中手动移动光标究竟写原位置还是当前位置，需要明确产品语义并单独验收，不要默默改落点。
5. **完善确认和取回。** 已发送后短时间有界重查，优先用选区附近的文本变化确认；无法确认保持 `sent`，提供“复制/在当前输入处重试”，不自动再发第二遍。继续保护用户处理中更新的剪贴板；如以后引入临时剪贴板恢复，恢复必须带 sequence 检查，避免固定 500ms 写回旧快照覆盖用户新复制的内容。

## 待做验证与问题清单

实机至少覆盖原生输入框、浏览器 textarea/contenteditable、Electron 编辑器、VS Code/终端、Word/富文本；加入第二次浮条显示、慢 UIA、长文档、同框光标移动、页面更新、跨应用切换、处理中复制其他文字和管理员目标窗口。每次分别记录捕获、拒绝发送、实际发送、确认以及用户看到的结果；单次任务最多自动发送一次粘贴。

| 原问题 | 本轮状态 |
| --- | --- |
| Typeless 如何获取焦点/选区 | 已回答：本机 macOS 静态调用链，TextMarker 与普通 range 两条读取路径 |
| Typeless 如何插入、如何处理 editable 不准确 | 已回答：临时剪贴板+粘贴，editable 后置、应用/网址兼容名单；运行效果未验证 |
| 它能否确认成功并自动恢复失败 | 部分回答：已追踪链没有成功回执；复制卡片/编辑跟踪存在，完整动态恢复效果未知 |
| 当前 APP 哪些检查可能拒绝插入 | 已回答：上述源码机制；具体发生率和用户失败根因需 Windows 实机日志 |
| Typeless Windows 的实际原生方案与成功率 | 未回答：没有 Windows 发行物或运行环境证据 |
