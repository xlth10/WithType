# Typeless 2.8.1 ContextHelper 原生上下文静态核查

记录日期：2026-10-10。分析范围仅为本机 `/Applications/Typeless.app/Contents/Resources/lib/context-helper/build/libContextHelper.dylib` 的 arm64 切片。未启动 Typeless，未加载/调用该 dylib，未读取个人数据、录音或历史；未联网。

本机副本的签名验证未通过，REA 整包读取也因 better-sqlite3 外置文件哈希不匹配而停止，详见 [主报告](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/typeless-context-and-processing-analysis.md)。因此，以下结论仅属于**当前版本副本的静态代码与元数据**，不能替代官方发行物真实性验证或运行实测。主进程 JS、请求组装及 InputHelper 均由其他支线覆盖。

## 输入与引擎覆盖

- Universal dylib SHA-256：`521e38bbf92eca7186a853b621784e9c0fcce998f624500c97e27eba6732aa56`。
- 地址均为 arm64 切片的首选虚拟地址，未加 ASLR slide，不是运行地址或对象字段偏移。
- 实际调用了已连接 REA 的 `open_binary(provider_id=hopper)`、`search_procedures`、`binary_session` 和 `close_binary`。首次查询返回 `provider_timeout`：startup 120000ms / not_started；独立 CLI runner 使用已有 loader 在**进程内**延长期限并指向现有 `hopper` launcher，随后查询返回 `provider_unavailable: Hopper could not start`。没有取得任何 `analyze_function` / 反编译 Evidence。
- 生命周期调用和以上错误未返回 REA Evidence ID；不得把它们引用成成功的函数行为证据。原始结果在 [REA 证据目录](/private/tmp/typeless-native-context-evidence/) 的 `open.json`、`procedures.json`、`session-after-timeout.json`、`context-open-cli.json`、`context-procedures-cli.json`、`context-session-cli.json`。
- 最后已按主线程收束指令停止引擎尝试。两个本支线 CLI runner（exec sessions 2093、65701）均终止，返回 exit 1；首个及独立 CLI 的 native binding 已先执行 `close_binary`。后续 runner 没有 open target。不修改安装包或共享配置，不终止用户已有 Hopper GUI。

以下使用**本地静态证据编号**，不是 REA Evidence ID：

| 编号 | 原始输入/证据 | 取得方法 |
|---|---|---|
| CTX-S01 | [导出及局部符号](/private/tmp/typeless-native-context-evidence/context-nm-arm64.txt) | `nm -arch arm64 -n`；用本机 `xcrun swift-demangle` 解释符号 |
| CTX-S02 | [逐函数汇编](/private/tmp/typeless-native-context-evidence/context-arm64-assembly.txt) | `otool -arch arm64 -tvV`，含函数名、系统 API stub、ObjC selector 和字面量注释 |
| CTX-S03 | 当前 dylib 的 static String arrays | 解析 FAT / LC_SEGMENT_64 将 VA 映射到文件；按 Swift static array header 与 16-byte String 读取**属性名称**，不读实例值 |
| CTX-S04 | [Swift 结构反射](/private/tmp/typeless-native-context-evidence/context-reflection.json) | 遍历 `__swift5_fieldmd` 的 FieldDescriptor / FieldRecord，解析相对引用与类型名；使用已有 [反射方法笔记](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/rea-superwhisper/swift-reflection-notes.md) 中同一解析器，只替换输入与结果过滤 |
| CTX-S05 | 当前 dylib 的 imports / 链接依赖 | `nm -arch arm64 -u` / `otool -arch arm64 -L`；仅用于核对有无具体导入，不单独证明调用 |

## 导出 ABI 与实际函数调用锚点

callback 接收可为空的 `char*`。静态实参流另确认：Visible 的第二个 Int32 进入 CaptureTimeout(timeoutMs:)（0x5f28 保存第二参，0x5fb0 / 0x5fb8 传入）；Related 的第三个 Int32 进入同一 timeout initializer（0x8d5c、0x8d90 / 0x8d94）。JS 的具体取值与封装层属于主线程证据。

| C 导出 VA | Swift 实现 / 实际采集函数 VA | 静态签名 |
|---|---|---|
| `getFocusedAppInfoAsync` `0x34a0` | wrapper `0x34a4` → closure `0x36fc` → AppInfoSync `0x3918` | Int32, callback(char*?) |
| `getFocusedVisibleTextAsync` `0x5ca0` | wrapper `0x5ca4` → closure `0x5f00` | Int32, Int32, callback(char*?) |
| `getFocusedElementInfoAsync` `0x7f78` | wrapper `0x7f7c` → closure `0x8208` | Int32, callback(char*?) |
| `getFocusedElementRelatedContentAsync` `0x88c4` | wrapper `0x88c8` → closure `0x8b1c` → RelatedContentSync `0x8d3c` | Int32, Int32, Int32, callback(char*?) |
| `setFocusedWindowEnhancedUserInterface` `0x6788` | 实现 `0x678c` | () → Int32；该接口会设置 AX 状态，此次未调用 |

以上 ABI 属于 CTX-S01；下述调用关系均由 CTX-S02 的 `bl` / 参数准备汇编支持，覆盖层级是静态代码路径，运行是否走到该分支尚未验证。

**长度与超时分开。** Visible 的第一参保存到 x23（0x5f2c）及栈槽，随后载入并符号扩展到 `collectVisibleTexts.maxLength`（0x6414 / 0x6418 / 0x643c）；Related 的第一参保存到 x21（0x8d64），作为 `collectContentBefore.targetChars` 传递（0x8ecc / 0x8ee4），第二参保存到 x27（0x8d60）、写入栈 0xb8（0x8df4）并载入 `collectContentAfter.targetChars`（0x9490–0x94ac）。因此主 JS 的 **10000、前后各1000 是长度预算，500 才是单独的 timeoutMs 参数**。本次不把它们写成 10000ms / 1000ms，也不凭此保证精确 Unicode 截断规则。

### 活动应用与窗口

`getFocusedAppInfoSync` 内的 `NSWorkspace.sharedWorkspace`、`frontmostApplication` 调用分别在 **0x3a24 / 0x3a34**；`bundleIdentifier` 在 0x3a60、`localizedName` 在 0x3c14、`processIdentifier` 在 0x3ca4。AX 路径调用 `AXIsProcessTrusted`（0x40cc）、`AXUIElementCreateSystemWide`（0x40d4），从 `AXFocusedApplication`（字面量引用 0x40e4）读属性（`AXUIElementCopyAttributeValue`，**0x4108**）。

接着读取 `AXFocusedWindow`（短 String 即时数值构造在 0x415c–0x4178，CopyAttributeValue **0x4190**）。静态数组 **0x1c780** 包含 `AXTitle`、`AXPosition`、`AXSize`，被转换成 NSArray 后用于 CopyMultipleAttributeValues **0x4218**。0x496c / 0x49b0 调用 `AXValueGetValue`；另有 `CGWindowListCopyWindowInfo` **0x4bd4**。这些证明应用与窗口信息使用 NSWorkspace、AX 及窗口信息 API；不代表有屏幕图像采集。〔CTX-S02、CTX-S03〕

### 聚焦元素元信息

ElementInfo closure 调用 `AXIsProcessTrusted` **0x82c8**，创建系统 AX element **0x82d4**；从 `AXFocusedUIElement`（0x82e4）读取焦点 **0x8310**，调用 `getElementInfoWithError` **0x835c**。后者入口 0xba00，在 **0xbaa0** 调用 CopyMultipleAttributeValues，属性来自数组 **0x1ca88**：

`AXRole, AXSubrole, AXIdentifier, AXDescription, AXTitle, AXHelp, AXPlaceholderValue, AXEnabled, AXFocused, AXSelected, AXURL, AXPosition, AXSize, AXDOMIdentifier, AXDOMClassList`。

这里的 **AXSelected 是元素选择状态，不能等同于 AXSelectedText**；这份已核对的属性数组没有 AXSelectedText 或 AXSelectedTextRange。不能据此推断另一个 InputHelper 未采集选区。〔CTX-S02、CTX-S03〕

### 可见文字与浏览器信息

VisibleText closure 的 NSWorkspace 路径为 0x5fe0 / 0x5ff0；创建应用 AX element **0x6020**，读取 `AXFocusedWindow` **0x6064**，还存在 `AXMainWindow` fallback 读取 **0x6360**。随后调用 `findWebArea` **0x63f4**、`collectVisibleTexts` **0x643c**、`smartJoinTexts` **0x6448**。〔CTX-S02〕

`findWebArea` 入口 0xb460 通过 AXChildren（构造 0xb4bc–0xb4d0；读取 **0xb4e8**）与 AXRole（读取 **0xb5d0**）递归查找；默认 maxDepth 在 0xb450 返回 10。可见文本 collector 入口 0xdfe8，递归调用在 0xe748，调用 `getElementText` **0xe49c**；默认 maxLength 为 10000（0xdfd8）、maxDepth 为 50（0xdfe0），实际调用可覆盖默认值。〔CTX-S01、CTX-S02〕

`getElementText` 入口 0xd678，在 **0xd728** 批量读取数组 **0x1cba8** 的 `AXRole / AXValue / AXTitle / AXIdentifier`。这能确认文字来源涉及 **AXValue / AXTitle**，以及按 role/identifier 处理的树元素；完整的字段优先级、过滤与拼接规则未反编译。〔CTX-S02、CTX-S03〕

浏览器路径的 `findWebInfoByTraversingUp` 入口 0xae7c 首先读 AXFocusedUIElement（0xaee4），反复批量取数组 **0x1c9e8** 的 **AXURL / AXTitle / AXParent**（**0xafb0**），并检查 CaptureTimeout（0xaf94）；静态局部计数在 0xaf8c 初始化为 40。`getFocusedAppInfoSync` 在 0x46b4 / 0x5298 调用该函数，也有 findWebArea 路径。由此可以确认 AX URL/title 的父链取值方式，不能声称直接读了浏览器 HTML DOM。〔CTX-S01、CTX-S02、CTX-S03〕

### Related content 与光标文本的区别

RelatedContentSync 读取系统 AXFocusedUIElement **0x8dd8**，然后调用 `collectContentBefore` **0x8ee4** 和 `collectContentAfter` **0x94ac**。before collector 入口 0xeac4，读 **AXParent 0xeb4c / AXChildren 0xebcc**，在子列表中用 **CFEqual 0xec8c** 定位当前 element，再调用 getElementText（0xed84）；after collector 入口 0xf81c，同样读父/children（0xf8a8 / 0xf928），调用 getElementText（0xfb38）。〔CTX-S02〕

这支持“焦点元素周边树文本”的解释；它**不能被写成根据 AXSelectedTextRange 裁剪光标前后文本**。主进程的 cursor_state 与 InputHelper `getCurrentInputState` 是另一条链路，本笔记不覆盖它。before/after 结果键 `beforeContent / afterContent` 可在当前库中找到，具体最终字段关系以 JS ledger 和主报告为准。

## 返回结构与限制

内部 `CaptureResult` 的 FieldDescriptor 为 **0x14d4c**，nominal descriptor 为 **0x14b24**；字段是：

`data, status, errorCode, isTimeout, truncated, contentLength, beforeLength, afterLength, durationMs, serializationFallbackData`。

`CaptureResult.Status` descriptor **0x14dd4** 含 success/error；`CaptureTimeout` descriptor **0x14dfc** 含 startTime/timeoutMs/finishedElapsedMs。〔CTX-S04；字段的存在不单独证明所有字段进入 wire JSON〕

四条异步路径可见对 `CaptureResult.serialize`（入口 **0x10f74**）的调用：App closure **0x37a4**、Visible closure **0x661c**、Element closure **0x8744**、Related closure **0x8bd4**。serialize 使用 **NSJSONSerialization dataWithJSONObject:options:error: 0x114bc**，转换 UTF-8（0x11500 / 0x11544），再 **strdup 0x11558**。这支持 callback 的结果是序列化 JSON C 字符串；精确 JSON 键映射、空值省略及释放生命周期未完全核对。〔CTX-S02〕

未覆盖与不能推断的事项：

- 没有运行实测，不确认 AX 权限、超时、跨应用兼容性或实际可见文字覆盖率。
- 仅检查这份 ContextHelper。已检查路径/导入中未发现截图或 OCR 采集证据；不能扩展成“整个 Typeless 不采集屏幕图像”。
- 未分析 InputHelper 的 AXSelectedText / AXSelectedTextRange 或 Cmd+C / NSPasteboard 复制恢复，交由独立支线；不能把 context 可见文字采集写成读取任意既有剪贴板。
- 浏览器完整 whitelist、role 过滤、相关元素的树遍历边界、完整 serialized JSON 结构与异常回退均尚未反编译。仅给出确有指令支持的系统 API 与静态路径。
