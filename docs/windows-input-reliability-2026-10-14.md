# Windows 输入可靠性改造 · 2026-10-14

已按 [Typeless Windows 调研的落地顺序](typeless-windows-cursor-insertion-2026-10-14.md#建议落地顺序与验收) 完成目标捕获、焦点保护、可编辑性判定、投递确认和诊断代码。当前证据是自动化回归、Mac 后端测试及 Windows 原生模块交叉类型检查；Windows 实际跨应用输入尚未验收。

## 行为与实现

| 原问题 | 现在的行为 | 代码 |
| --- | --- | --- |
| 前端先等待，再捕获输入位置，浮条显示可能改变焦点 | 原生录音动作先记录前台 HWND、子控件、PID、剪贴板序号并排队捕获 UIA，再向前端发送一次性目标 token；前端任务注册后沿用该目标 | `background.rs`、`delivery/platform.rs`、`pipeline.js` |
| 捕获失败被空 catch 吞掉 | 返回具体原因及捕获回执，投递结果和历史保留诊断；捕获出错仍继续转写并保留正文 | `delivery.rs`、`pipeline.js` |
| 重复显示 HUD 可能激活悬浮窗 | Windows HUD 使用 `WS_EX_NOACTIVATE` 和 `SW_SHOWNA`，显示时不再依靠 `SetForegroundWindow` 补救 | `overlay_windows.rs`、`lib.rs` |
| 只在当前 UIA 元素找 Value/Text，漏掉真正的编辑容器 | 焦点获取失败时从原生 HWND 回退；依次查当前元素、TextChild.TextContainer、父节点和最多 8 个拥有键盘焦点的子节点。候选须同 PID、非密码框 | `uia.rs` |
| 把“不支持只读属性”直接当只读 | 区分可写、明确只读与未知；综合 Value、Text、TextEdit、Legacy/MSAA 和标准原生 Edit 样式；输入控件的明确只读信号优先，文档容器元数据按当前活动范围细化 | `delivery/policy.rs`、`uia.rs` |
| 未知能力时缺少可靠的兼容投递条件 | 只有 Edit 控件、键盘焦点、活动 Text2 caret、保存的选区和可读内容锚点同时存在，才能进入兼容路径；投递前再核验这些条件 | `delivery/platform.rs` |
| 全文相等和单次 150ms 核对对长文档、慢编辑器过严 | 优先保存选区及前后各 256 个字符的锚点；有界重查局部内容，回退到原有全文确认；一次任务只发送一次 Ctrl+V | `uia.rs`、`delivery/platform.rs` |
| 剪贴板竞争可能覆盖用户的新复制内容 | 在 `OpenClipboard` 持锁期间核对原始序号，再提交 Unicode 文本；按键发送前再次核对序号。结果保留在剪贴板或历史中，不定时恢复旧快照 | `delivery/platform.rs` |

录音目标绑定于开始时的输入框。录音或处理期间切换应用、控件、选区或改变锚点，自动插入会降级为复制或保留结果，不会主动切换前台应用。标准原生 Edit 可以在同 HWND、同 PID 和焦点验证通过时重新绑定 UIA 元素；浏览器 DOM 重建不凭顶层窗口相同自动接受。

历史和回答卡片的“3 秒后输入”保留原有语义：倒计时结束后捕获用户新选中的输入位置，不采用录音开始时的 token。重试转写及保留原文继续只复制；提问继续只显示卡片。

目标 token 单次消费，接收时超过 5 秒则失效；目标缓存上限 64 个。失效 token 不会触发重新捕获当前窗口。原生捕获总预算 1200ms，调用方最多等待 1800ms；UIA 连接/事务超时各 120ms。确认阶段在 60/100/180/260ms 间隔后只读重查，合作式预算 900ms；投递调用 4 秒超时后设置取消标记。UIA provider 的阻塞可能超过合作式预算，超时不意味着已撤销发送的系统按键。

明确只读、密码框、自身进程、不可用控件、目标变化和取消均禁止自动发送。剪贴板提交后产生的副作用无法撤销；迟到回执仅归档已提交结果，不改变新任务的 UI。

## 回执与诊断

`capture_input_target` 返回 `reason / message / elapsedMs / queueMs / target`。投递回执保留 `inserted / sent / copied / retained` 四种状态，并增加 `reason`、`diagnostics.captureMs / captureQueueMs / verifyMs / sentEvents / target`。只有内容核验通过才报告 `inserted`；SendInput 接受 4 个事件仍可能是 `sent`，界面继续提供完整正文和恢复操作。

主要原因包括：`capture_busy`、`capture_timeout`、`capture_missing`、`provider_unsupported`、`read_only`、`password`、`own_process`、`focus_changed`、`selection_changed`、`content_changed`、`modifiers_held`、`clipboard_changed`、`send_failed`、`sent_unverified` 和 `delivery_timeout`。

主窗口可通过 Tauri `invoke("get_input_diagnostics")` 读取最近 64 条内存记录。每条包含 session、阶段、原因、耗时，以及可取得的窗口/PID、focusSource、textSource、捕获失败 HRESULT 和发送事件数。超时回执无法知道 worker 的发送事件数时，该字段省略。内存诊断不记录控件名称、窗口标题、输入框正文或音频。兼容远程已有的 `%TEMP%\typefree-debug.log`，仅写捕获能力布尔值、投递状态、原因与事件数摘要；正常历史仍按原有逻辑保存用户转写正文和附带的投递回执。

## 已完成的验证

- `npm run test:unit`：221 项通过。新增捕获失败诊断、一次捕获/一次投递、token 传递、等待捕获、捕获期间取消、手动选择新目标与诊断保留回归。
- `cargo test --offline --locked --manifest-path src-tauri/Cargo.toml --lib`（Mac）：57 项通过。新增三态资格策略、局部插入/替换证据及 CRLF/LF 多行文本确认测试。
- `npm run build`、`npm run verify:appearance`、`cargo fmt --check`、`git diff --check`：通过。Vite 保留已有的大 chunk 提示。
- 实际 `uia.rs`、`delivery.rs`、`delivery/platform.rs`、`correction_monitor.rs`、`card_position.rs`、`overlay_windows.rs` 使用真实 Windows/Tauri 依赖，在隔离 crate 中通过 `x86_64-pc-windows-msvc` 的 `cargo check`，未用假 Windows API。此项不代表完整 Windows 安装包构建或运行通过。

捕获错误诊断回归在修改前实际失败（缺少 `capture_failed` 原因），修改后通过。该回归覆盖的是错误吞掉、结果无法解释的问题，未模拟 Windows UIA 或证明真实跨应用插入成功率。

多行文本回归也先复现了确认失败：转写为 LF、编辑器回读为 CRLF 时，原比较不能确认。现在仅在插入确认时统一换行比较，原始投递正文及投递前内容变化检查不做规范化。局部文本超过有界读取长度时不使用截断内容作确认依据。

## Windows 实机验收

在 Windows 工具链中运行完整 `npm test`、`cargo test --manifest-path src-tauri/Cargo.toml --lib` 和 `npm run desktop:build`，随后执行下表。每次保留 session 对应的 capture/adopt/delivery 诊断，区分“发送事件”和“内容确认”。

| 场景 | 预期与判定 |
| --- | --- |
| Notepad、Chrome/Edge textarea 与 contenteditable、Word/Excel、Cursor/VS Code、终端 | 各测试首次及连续两次口述、段中插入、中文/emoji、选区替换。可读目标应得到 `inserted`；不可确认时 `sent`，正文可恢复，一次口述不会重复输入 |
| 第二次显示浮条、点击结束/取消、125%/150%/200% 缩放、多屏 | 原目标应用与输入框保持焦点；显示 HUD 不闪切前台，取消后无迟到发送 |
| 长文档（超过 16K），粘贴处理延迟 | 使用局部锚点确认；慢编辑器可在重查时确认。超出预算仍为 `sent`，不重新粘贴 |
| 同窗口移动光标、切换控件、切换应用、DOM 重建 | 返回目标/选区/内容变化原因；目标不会被主动抢回，其他输入框不出现本次文字 |
| 录音或处理中 Ctrl+C 复制其他内容 | 返回 `clipboard_changed`，保留用户新复制内容，转写在卡片或历史可取回 |
| 密码、只读、disabled、自身设置窗口 | 诊断可区分；无 Ctrl+V；不读取密码内容 |
| 修饰键持续按住、捕获期间取消、慢/故障 UIA provider | 松键后才允许发送；取消先于发送时事件数为 0；超时明确保留正文 |
| 高权限目标、SendInput 失败或部分接受 | 不声称插入成功；只清理可能残留的按键，不补发粘贴；正文可取回 |
| 历史/回答卡片“3 秒后输入” | 倒计时内选择新框，结束时捕获新位置；不会复用录音的旧目标 |

本轮没有增加 HTML/OLE 富文本写入或后台恢复旧剪贴板，也没有更换全局热键系统。后续是否需要这些能力，由实机失败记录决定。

## 2026-10-15 远程整合

本地提交重放到远程 `7043058`（及其前两个提交）之上，保留模型配置与预置脚本、15 字短句直出阈值、HUD 冷启动状态同步、丢失浮条报错和生产资源检查。浮条恢复最小化状态时也使用不激活显示路径。

输入判定保留远程对“只读文档中的活动可写光标”的修正，并继续阻止只读输入控件和失焦后残留选区。仅凭控件类型为 Edit、但没有可写能力证据时，沿用本地的未知能力与兼容投递保护，不直接认定可写。对应的范围判定回归放在跨平台策略测试中，Mac 也可以执行。

整合后检查：JavaScript 232 项通过，2 项 Windows PowerShell/凭据库集成用例在 Mac 明确跳过、Windows 仍完整运行；Rust 61 项通过；Windows 原生模块类型检查、前端构建、外观基线与格式检查通过。这些检查仍不代替 Windows 实机验收。
