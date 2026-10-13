# Typeless InputHelper：输入上下文与选区复制回退

核查日期：2026-10-10。对象是本机标为 Typeless 2.8.1 的安装包中的 `/Applications/Typeless.app/Contents/Resources/lib/input-helper/build/libInputHelper.dylib`，仅分析 **arm64** slice。整个文件 SHA-256：`4cd6ba0205e0e7a0d7e6a3706102cb7e98e09d626fbfd738311f05e2cdb0ad47`。

本次仅使用 `nm`、`otool`、`strings`、Swift demangle 静态读取；没有运行 App、调用库函数、读取用户数据、联网、改配置或打开 REA 原生会话。主线程已发现该安装包签名校验异常，因此以下结论只描述这份当前字节，不能外推到官方所有版本。本文的地址均为反汇编显示的未加载 arm64 虚拟地址，运行时还会有 ASLR slide。

## 结论

`getCurrentInputState` 从当前获得焦点的 Accessibility 元素读取输入文本和选区，得到 `beforeText`、`selectedText`、`afterText`。原生成功路径在返回前分别把前文和后文截为最多 **5,000 个 Swift Character**：前文保留靠近选区的尾部，后文保留靠近选区的头部。这是输出截断；底层 AX 路径可能已经读取整个输入元素的值或完整 TextMarker 文本。没有发现这几条捕获路径对 `selectedText` 的相同 5,000 字符截断。

这两个同步入口的 `Int32` 参数是 **timeoutMs（毫秒）**，不是文本长度或 AX 模式。传 `0` 时，`hasExpired` 的 `<1` 分支返回 false。同步包装先完成捕获再调用 `CaptureTimeout.finish`；不能把此参数描述成可以立即中止阻塞 AX 请求的硬截止。`CaptureTimeout` 初始化还设置一次全局 AX messaging timeout 为 5 秒。

`getSelectedText` 的原生路径读取 `AXSelectedText`。`getSelectedTextBySimulateCopyAsync` 则保存当前剪贴板、清空剪贴板、发送 Command+C、约 100 毫秒后从通用剪贴板读取文本，再尝试恢复原快照。旧剪贴板的 items/types/data 被读入内存用于备份；从这条已跟踪返回链看，返回选区文本的是清空并触发复制之后取得的字符串，不能据此声称旧剪贴板文本被用作模型上下文，也不能声称它完全不读取既有剪贴板。

## 函数与证据

| 范围 | 地址 | 静态证据摘要 | 强度 |
|---|---:|---|---|
| `getSelectedText(Int32)` C 入口 | `0x4d08` | 选择 `captureSelectedText`，跳转共用包装 `0x5144` | 强：有符号与指令 |
| `captureSelectedText` | `0x4d20` | `AXIsProcessTrusted` → `locateInputElement` → `readSelectedInputText`；成功时把 String 送入 `CaptureResult.fromText` | 强 |
| `readSelectedInputText` | `0x3aac` | 内联小字符串常量可还原为 `AXSelectedText`；`0x3b08` 调 `AXUIElementCopyAttributeValue` | 强 |
| `locateInputElement` | `0x4c94` | `AXUIElementCreateSystemWide`，读取 `AXFocusedUIElement`，调用点 `0x4cdc` | 强 |
| `getCurrentInputState(Int32)` C 入口 | `0x5138` | 选择 `captureCurrentInputState(0x51dc)`，跳转共用包装 | 强 |
| 共用同步包装 | `0x5144` | `0x5174` 将入口参数传给 `CaptureTimeout(timeoutMs:)`，捕获后 `0x5190` 调 `finish` | 强 |
| `readCurrentInputText` | `0x3c50` | TextMarker 优先路径；缺失/失败时转 AXValue/AXSelectedTextRange 路径 | 强 |
| 前文/后文截断 | `0x361c` / `0x374c` | 调 `String.count` 与 `String.index(offsetBy:)`；捕获器在 `0x5290`、`0x52a0` 传 `0x1388=5000`，异常 range 分支也在 `0x53d4` 截后文 | 强 |
| 复制回退 C / Swift 入口 | `0x894c` / `0x8950` | `0x8b08` 保存剪贴板，`0x8b18` 清空，主队列执行复制闭包 | 强 |
| 复制事件闭包 | `0x8edc` | `0x903c` 传字符 `c` 找键码，失败用键码 `8`；创建 down/up 事件，设置 flags `0x100000`（Command），`0x90c0`、`0x90cc` 调 `CGEventPost` | 强；效果未运行观察 |
| 复制后读取闭包 | `0x9488` | 调度延迟常量 `0.1` 秒；`0x9540` 调 `stringForType:`，类型为 `NSPasteboardTypeString` | 强 |
| 正常完成闭包 | `0xc628` | `0xc650` 先恢复快照，未完成时构造选区文本结果并调用完成闭包 | 强 |
| 超时闭包 | `0xc264` | 未完成时 `0xc2a0` 恢复快照，再以空文本结果完成；入口参数 `>0` 才安排毫秒超时任务 | 强 |
| 事件创建失败路径 | `0x9338` / `0x93c8` | 分别在 `0x9340`、`0x93d0` 恢复快照并生成内部错误 | 强 |
| `savePasteboard` / `restorePasteboard` | `0x82d8` / `0x8490` | 保存 `generalPasteboard.pasteboardItems`；枚举 types 并读 `dataForType:`（`0xbbd8`）；恢复时建 NSPasteboardItem、`setData:forType:`、`writeObjects:` | 强 |
| `CaptureTimeout` | `0xdcd8` / `0xdd14` / `0xddf0` / `0xde9c` | 参数存为 timeoutMs；用 systemUptime 计算毫秒；`0xdda4` 设置 AX messaging timeout `5.0` 秒 | 强 |

## AX 上下文的两条路径

TextMarker 路径先读取 `AXSelectedTextMarkerRange`（`0x3cec`），再以当前输入元素请求 `AXTextMarkerRangeForUIElement`（`0x3dec`）。通过 `AXStringForTextMarkerRange` 参数化属性读取整个元素、选区及构造出的 marker 子范围，调用点包括 `0x3bac`、`0x3f54`。代码比较从整个元素起点到选区两端的文本长度来判断端点顺序，随后构造前文、选区、后文。AX 返回值和被支持的属性决定实际可获得哪些内容。

如果首个 TextMarker 属性失败/为空，`0x3d64` 调 `AXUIElementCopyMultipleAttributeValues`，属性数组静态对象在 `0x18a10`。数组第一项内联字节（`0x18a30`）为 `AXValue`；第二项 Swift 字符串引用（`0x18a40`/`0x18a48`）解析到 `__cstring 0xfa00` 的 `AXSelectedTextRange`。第二个返回值转成 AXValueRef，在 `0x44ec` 调 `AXValueGetValue(..., 4, ...)` 读取 CFRange。随后把 location 和 location+length 对 String.count 做界限限制，再用 Swift String 索引切出三段。

应区分字符串属性 **`AXValue`**（输入元素的值）与 **AXValueRef/`AXValueGetValue`**（承载选区 CFRange 的对象）。后者不是第二次读取输入框全文。代码可见的 range 与 Swift Character 计数混用行为已经记录，非 ASCII/复杂 Unicode 的实际效果没有运行验证。

## 剪贴板恢复的实际边界

静态控制流支持“正常、超时和创建事件失败都会尝试恢复保存的快照”，但不支持“剪贴板在所有情况下保证保持原样”。`restorePasteboard` 在 `0x84b4` 检查快照 items 数量；为空时直接转 `0x86e8` 返回，连 `clearContents` 都不执行。因此，若原剪贴板为空，新复制的内容可能仍留在剪贴板里。非空快照路径会清空剪贴板并重建原 types/data；恢复写入的成功结果没有在已跟踪路径中检查。

在这些函数与闭包的完整反汇编范围内，没有发现 `changeCount` 竞争保护，也没有发现剪贴板历史枚举或持续监听。本结论的检索边界仅限当前三个入口及其上述帮助函数，不能用来排除 App 其他模块的剪贴板使用。读出的新文本还可能受前台 App 对 Command+C 的处理、其他进程并发写剪贴板及权限影响；本次没有观察运行效果。

## 与主 JavaScript 的衔接与未知项

主线程已从其独立检查的主 JS 确认：`getCurrentInputState` 映射 `selectedText/beforeText/afterText`；选择读取先调用原生 `getSelectedText(0)`，结果为空且 `disableSimulateCopy=false` 才调用 `getSelectedTextBySimulateCopyAsync`，默认 timeout 为 1,000 毫秒。这一调用顺序不是仅由 native 函数名推出；本次原生检查与该 JS 链条互相补足。

未验证：特定浏览器/编辑器/受保护输入框的 AX 支持；AX 权限拒绝时的真实用户体验；复制与恢复的运行效果；其他架构 slice；异常签名的原因和官方发行包行为。原生返回值到模型请求的跨模块链路另见 [主报告](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/typeless-context-and-processing-analysis.md)；客户端字段不能证明服务端实际 prompt。

## 原始记录

原始记录保存在 `/private/tmp/typeless-input-helper-evidence/`：

- `nm-arm64.txt`：原始符号与地址。
- `nm-arm64-demangled.txt`：Swift 名称展开。
- `otool-arm64.txt`：完整 arm64 `-tvV` 反汇编。
- `strings.txt`：整个 dylib 字符串输出（可能含多架构重复，不用其推断 arm64 控制流）。
- `data-arm64.txt` / `cstring-arm64.txt`：静态属性数组与带地址字符串。
- `focused-functions.txt`：本报告所需函数片段，保留原始地址。
- `manifest.json`：输入摘要、命令、分析边界和片段范围。

这些记录是本机临时证据文件；持续复核时应保留或迁入正式证据目录。报告中的“强”表示可从指令和数据直接建立静态调用/数据流，不表示运行时已经发生。
