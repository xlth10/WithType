# Typeless：原生插入与剪贴板交互的静态核查

核查日期：2026-10-11。本轮研究、不实施修复。只读本机标为 Typeless 2.8.1 的 InputHelper 与已提取主 JS，复用上轮 `nm -arch arm64`、`otool -arch arm64 -tvV`、Swift demangle 记录；没有启动 App、麦克风、模型请求或 Hopper，没有调用原生库函数、读取用户数据或改配置。

重新计算的文件摘要：

| 对象 | SHA-256 |
|---|---|
| `/Applications/Typeless.app/Contents/Resources/lib/input-helper/build/libInputHelper.dylib` | `4cd6ba0205e0e7a0d7e6a3706102cb7e98e09d626fbfd738311f05e2cdb0ad47` |
| `/private/tmp/typeless-context-analysis/main.decoded.js` | `dd31f4c2903801d1f563d6ddaa6b40de300708ebdfde812764a6de703be7053a` |

InputHelper 摘要与上轮一致。安装包签名校验异常由上轮主线程记录；以下仅描述当前字节，不代表官方所有版本。所有原生地址都是未加载 arm64 虚拟地址，运行时需另加 ASLR slide。

## 已建立的交互模型

普通文本和富文本插入都采用 **临时写入通用剪贴板 → 发送 Command+V → 约 500 毫秒后恢复原剪贴板快照** 的路径。这些入口没有使用 Accessibility 直接设置输入框的值，也没有逐字符模拟输入。

原生 `insertText`/`insertRichText` 的返回值 `1` 不能解释为“目标已经成功插入”。有效 UTF-8 参数会安排主队列的粘贴事件，并返回 `1`；目标是否收到文字、是否可编辑、是否处理了粘贴，在已跟踪原生链条中没有验证。主 JS 又吞掉了非 `1` 返回和异常，调用方没有拿到明确的插入成功/失败结果。

“保留原剪贴板”和“保留最后一次转录结果”是两种独立行为：此原生插入链保存和恢复的是**插入之前**的剪贴板。它并不能证明存在一个供用户随时取回的“最近转录结果”缓存。主 JS 存在另外的显式 `clipboard:write-text` IPC，可以把传入文字直接留在系统剪贴板；是否由“复制最后结果”功能调用，必须另追踪 renderer/状态层，不能从本库推出。

## 普通文本调用链

```text
main JS INSERT_TEXT IPC (line 8379)
  → Ne.insertText (line 8450)
  → oi/ri.insertText (line 7175)
  → C insertText 0x66d8 / Swift insertText 0x66dc
  → 校验指针与 UTF-8
  → 主线程直接调用；其他线程 dispatch_sync 到主队列 (0x6858)
  → performTextInsertion 0x6914
      → savePasteboard 0x82d8 (调用点 0x6930)
      → prepareForNewContentsWithOptions: 字面值 1 (0x6958)
      → NSPasteboardItem 写 NSPasteboardTypeString (0x6994)
      → 添加空 Data 的 org.nspasteboard.TransientType (0x69c0)
      → generalPasteboard.writeObjects: (0x6a40)
      → simulatePasteCommand 0x8738 (调用点 0x6a74)
          → async 主队列闭包 0xbe3c
          → Command+V down / up
          → completion 0x7518 → 0x72a0
              → main.asyncAfter(now + 0.5s) (0x73b0 / 0x74a0)
              → restorePasteboard 0x8490 (经 0x76f4)
  → 有效参数路径返回 1；JS 再等待 500ms 后解除 isInserting
```

`performTextInsertion` 在 `0x6a90` 无条件返回 true。原生入口在 `0x6728` 调用该函数后没有把 Bool 用作成功判断，而是在 `0x673c` 置返回标志为 `1`；非主线程闭包 `0x6acc` 在 `0x6ae4` 也直接写 `1`。

粘贴闭包按字符 `v` 查当前键码（`0xbe68`/`0xbe70`），找不到时回退到键码 `9`（`0xbf80`）。键盘事件带 flags `0x100000`（Command）；down 在 `0xbfac`、up 在 `0xbfd8` 调 `CGEventPost`。这些是静态可见的调用；没有观察事件是否被系统或目标 App 接收。

## 富文本调用链

`insertRichText` C 入口 `0x6b64` / Swift 入口 `0x6b68` 先检查 HTML 和纯文本指针与 UTF-8，之后在主线程调用 `performRichTextInsertion(html:text:)`（`0x6db4`）。它同样保存快照并准备剪贴板；一个 NSPasteboardItem 同时写入：

- 纯文本 `NSPasteboardTypeString`，调用点 `0x6e40`。
- HTML 类型 `public.html`，调用点 `0x6e8c`。
- 空 Data 的 `org.nspasteboard.TransientType`，调用点 `0x6ec0`。

`0x6f40` 写入对象，`0x6f74` 调同一个 `simulatePasteCommand`。富文本 completion `0x75d8` 复用 `0x72a0` 的 500ms 延迟恢复调度；`0x7718` 跳到共享恢复闭包。`performRichTextInsertion` 在 `0x6f90` 也无条件返回 true。目标最终选择 HTML、纯文本或忽略粘贴，需要运行验证。

## 无焦点、不可编辑目标及失败返回

| 场景 | 当前字节中可见的路径/结果 | 证据性质 |
|---|---|---|
| 普通文本参数为 null | `0x66f4 → 0x6748` 记录日志；`0x6794` 置 `0`，返回前不进入剪贴板操作 | 强：直接指令 |
| 普通文本 UTF-8 无效 | `0x66f8 → 0x676c` 记录转换失败，返回 `0` | 强 |
| HTML 或纯文本指针为 null / UTF-8 无效 | `0x6c04`、`0x6c10`、`0x6c34`、`0x6c40` 等分支；`0x6c74` 返回 `0` | 强 |
| 剪贴板 setString/setData/writeObjects 失败 | 调用返回后直接继续；已跟踪代码没有检查这些 Bool 结果，也没有返回专门的错误 | 强：完整函数范围 |
| 创建粘贴 key-down 事件失败 | `0xbf94 → 0xbff0` 记日志；`0xc050` 仍调用 completion，后续仍安排恢复 | 强 |
| 创建粘贴 key-up 事件失败 | down 已调用 Post；`0xbfc0 → 0xc058` 记日志；`0xc0b8` 仍调用 completion | 强 |
| 没有输入框焦点，或目标不可编辑 | 插入链没有调用 `locateInputElement`、检查 AXFocusedUIElement/可编辑性，也没有此类失败返回分支；仍走全局粘贴事件路径 | 强：范围限定的静态观察；目标效果未知 |
| 插入前后焦点变化 | 入口无目标元素/PID参数，已跟踪代码没有锁定录音开始时的目标或主动恢复该目标 | 强：接口/调用链；事件会落到哪里是运行时未知 |
| JS 层已经 isInserting | `main.decoded.js:7177`/`:7189` 外层 guard 直接跳过本次调用，不排队 | 强：直接 JS |
| JS native 返回非 1 或抛异常 | 非 1 直接 return；catch 为空，finally 解除 isInserting；不会向调用方返回错误结构 | 强 |

因此，将 UI 的“完成”或原生返回 `1` 当成已验证的目标写入成功，会超过当前证据。对无输入焦点时的具体表现，只能推断为“目标 App 按它自己的 Command+V 行为处理或忽略”；没有证据证明此 native 插入器会自动切换成永久复制、展示恢复提示或重新聚焦某个输入框。

主 JS 的入口绑定在 line 7167；plain/rich 方法在 line 7175/7187。两者共享 `isInserting`，原生返回 `1` 时等待 `0x1f4=500ms`。`Ne` 在 line 8450/8454 只继续 await，没有增加结果验证；line 8379 的两个 IPC handler 返回对应 Promise，但该 Promise 没有有意义的成功结果。另一个 `keyboard:type-transcript` handler（line 12247/12251）调用 `Ne.insertText`，没有 return/await 该结果。

## 保存恢复剪贴板的边界

`savePasteboard(0x82d8)` 获取 `generalPasteboard.pasteboardItems`，逐项保存 types 与每个 type 的 Data。保存项目的优化 initializer 位于 `0xbb24`，`0xbbd8` 调 `dataForType:`。这是读取旧剪贴板用于恢复，不是读取旧剪贴板作为转录/模型参考内容。

`restorePasteboard(0x8490)` 对非空快照先 `clearContents`（`0x84d8`），逐项重建 NSPasteboardItem，并以 `setData:forType:`（`0x85d4`）和 `writeObjects:`（`0x86b8`）恢复原 Data。恢复写入的返回值没有在该函数中检查。

如果快照为空，`0x84b4` 直接转 `0x86e8` 返回，不执行清空。因此在原剪贴板为空的情况下，插入文字可能仍留在通用剪贴板。这个边界不能解释成一个有意的“保留最后转录结果”功能；它只是恢复函数的条件分支。500ms 也是固定延迟调度，不是目标已经消费剪贴板的确认信号。

插入器设置 `org.nspasteboard.TransientType` 是直接静态观察；其被剪贴板历史工具如何处理，本轮未验证。本文不把这个类型名当成系统不会保留、泄露或监控该文字的保证。

## “原剪贴板”与“最后转录结果”的证据区分

| 行为 | 本轮结论 |
|---|---|
| 一次 native 插入前保存并在之后恢复旧剪贴板 | 已建立上述完整调用链；空快照/恢复写入成功存在边界 |
| native 插入后把转录永久留在剪贴板 | 非空快照的正常恢复路径会写回旧内容；没有“永久保留转录”的参数或明确分支 |
| 用户显式复制文字 | 主 JS line 11903 的 `clipboard:write-text` IPC，在 line 11906 直接调用 Electron `clipboard.writeText`，返回 `{success:true}` 或捕获后的 `{success:false,error}`；此 handler 没有 native 快照恢复 |
| 保留最近转录内容，以快捷键或 UI 再次复制/插入 | 不能由 InputHelper 证明；本轮未建立 renderer 中“最后转录”状态的写入、寿命与消费者链条 |

这意味着需要分别比较 Typefree 的临时剪贴板保护、结果缓存、显式复制和重试插入。一个能力存在，不能替代另外几个能力的证据。

## 静态边界与未知项

以上“强”表示可以由指令/JS 建立调用与返回路径，不表示观察过用户交互。未知项包括：无焦点/受保护控件的实际表现；前台切换发生时的落点；目标消费剪贴板所需时间；HTML兼容性；系统权限限制下 CGEventPost 的效果；原生失败是否有 renderer 单独检测或提示；最近转录的状态与重试入口。没有对其他 architecture slice、整个 App 的所有插入消费者或网络流程作完整排除。

可复核记录：`/private/tmp/typeless-input-helper-evidence/nm-arm64-demangled.txt` 与 `otool-arm64.txt`，以及上述 `main.decoded.js`。本轮仅新增本报告，没有修改二进制、提取 JS、既有证据或 Typefree 实现。
