# Typeless 后台驻留与故障恢复调查

本调查的项目对照描述为优化前快照；2026-10-12 后续实施见 [后台可用性说明](background-availability.md)。

调查日期：2026-10-12。问题：语音输入应用怎样在用户关闭设置界面、登录、睡眠唤醒和组件异常后仍可调用？本次只调查及对照代码，没有修改 Typefree 的产品实现。

## 结论

Typeless 的已知设计由几项机制组成：登录启动、设置界面与语音浮条分离、独立于窗口焦点的键盘监听、唤醒时清理按键状态，以及键盘辅助组件的异常恢复代码。应把“进程仍在”“快捷键能够触发”“录音和投递能够完成”作为三项不同能力验证。

官网可以直接确认桌面版支持登录启动和跨应用快捷键。更具体的实现来自本机 **Typeless 2.8.1 macOS 安装包**的静态代码；其中还保留 Windows 键盘子进程分支，但该分支在本机包里不被选中。本次没有取得 Windows 发行安装包或做 Windows 运行测试，因此不能把这些分支当作 Windows 实际行为的保证。也没有足够证据确认独立系统服务、主进程崩溃后自动拉起或任务管理器结束后自动重启。

## 证据范围

- 官方资料：Typeless Settings、Dictate、Windows 发布说明和故障排查；Electron、Microsoft 的 API 文档仅用来解释平台机制。
- 本机产物：`/Applications/Typeless.app`，2.8.1 / build 2.8.1.130。ASAR SHA-256：`eb9bcc842478b12a7488d90778ad6b08e6788c8fa5e875782ec2af0387c6c80b`。重新核对主进程 member 与旧缓存，SHA-256 均为 `7b87e1578597b6fce6b6589a2f8aa18496e9513f0e74d0b8b26186a641b59ade`。
- 既有签名检查未通过、整包 REA 因外置原生 member 哈希不符停止。本次 ASAR 哈希未变化，继续沿用该限制：本报告描述本机副本，不宣称厂商发行物真实性已核实。详见 [此前检查](./typeless-rea-feasibility.md)。
- 沿用有界、惰性的 Babel AST 字符串解码阅读视图：190 次字符串表旋转、9,518 次字面量替换；没有执行 Typeless 代码。运行等价性未测试。
- [静态锚点与有界搜索](./typeless-background-evidence/source-ledger.json)保存原始 member 的字节/UTF-16 范围。以下 BG-* 都是分析者锚点，不是 REA 自动证明的执行路径。
- REA 对原始主进程里精确截取的 10,384 字节 Windows 键盘类进行了静态分析，Evidence：`ev_650812327da38aac1151e69a67d5528eb3976deb9c392b842ab6a39091965f71`。省略的 import 与混淆 decoder 使工具没有恢复进程调用关系；具体行为由完整 member 的静态检查补充，不能说 REA 自动恢复了完整后台架构。见 [REA 摘要](./typeless-background-evidence/rea-summary.json)。

## 1. 登录后进入可用状态

官网 Settings 的 General 部分提供 **Launch app at login**。可确认这一产品能力；官网没有说明默认开关或 Windows 注册方式。[Typeless Settings](https://www.typeless.com/help/quickstart/settings)

本机代码的 `launchAtSystemStartup` schema 默认值是 `true`。启动阶段读取这一值，调用 `getLoginItemSettings()`，最后同步 `setLoginItemSettings({openAtLogin: ...})`。修改设置也有 `permission:update-auto-launch` IPC 调用相同 API。证据：BG-SETTINGS、BG-STARTUP、BG-AUTO-LAUNCH-IPC。

启动路由存在 `shouldLaunchSilentlyAtSystemStartup` 参数：已登录且完成初始化、权限满足时，登录启动分支创建语音浮条、关闭 Hub/登录/引导窗口；普通启动会创建 Hub 和语音浮条。需要登录或引导时仍会显示相应页面。因此这里的“静默”是**正常配置下不打开主界面**，不是所有窗口永远不可见。证据：BG-LAUNCH-ROUTER、BG-STARTUP。

macOS 分支依据 `wasOpenedAtLogin`；代码还包含 Windows 平台条件。虽然定义了 `--system-startup-silent-launch` 字符串，当前所见启动逻辑没有使用 `argv.includes(...)` 的返回值作为分流依据，不能仅凭这个字符串声称已配置 Windows 启动参数。证据：BG-STARTUP-ARG、BG-STARTUP、BG-PLATFORM-CONSTANT。

Electron 文档确认 `setLoginItemSettings` 是登录启动设置；Windows 能另外查询 `executableWillLaunchAtLogin` 及启动项是否被系统禁用。该 API 不提供“崩溃后持续自动重启”的含义。[Electron app](https://www.electronjs.org/docs/latest/api/app#appsetloginitemsettingssettings)

## 2. 主界面可关闭，语音承载窗口另行保留

本机包把 Hub、登录、引导、语音浮条和回答卡片分成不同窗口。基础窗口的 `closeWindow()` 关闭窗口并清空引用；托盘另外提供设置、历史和退出入口，明确退出调用 `app.quit()`。这不是所有窗口都拦截关闭并隐藏的实现。证据：BG-WINDOW-BASE、BG-LAUNCH-ROUTER、BG-TRAY、BG-QUIT。

一个关键细节是 **macOS 浮条收起后仍保留窗口**：浮条的 `setExpanded(false)` 经 `moveWindowToDisplay()` 将窗口改为 **1×1 像素**；展开时恢复约 750×500 的窗口区域，内容和透明区域由页面控制。renderer 的 effect 把“录音控制可见或存在浮条提醒”的结果发送到 `page:floating-bar-set-expanded`。证据：BG-FLOATING-WINDOW、BG-FLOATING-EXPAND-IPC、BG-RENDERER-EXPAND。

可以据此推断这一设计把“不显示浮条内容”与“销毁承载语音逻辑的 renderer”分开，避免正常收起时卸载它。不能进一步断言 1×1 窗口是专门为了绕过系统节流、一定在 OS 层可见，或后台计时器永远不被节流；没有相关运行测量。

当前主进程 member 的有界搜索未命中 `backgroundThrottling`、`disable-renderer-backgrounding`、`powerSaveBlocker`。这不是其他依赖、原生库或发行包没有相关机制的证明。Electron 默认允许后台页面的动画/计时器节流；设置窗口的存活与计时器频率是不同问题。[Electron WebPreferences](https://www.electronjs.org/docs/latest/api/structures/web-preferences)

没有 Windows 托盘、关闭 X 行为的直接官方文字证据；macOS 菜单栏和浮条实现不能替代 Windows 验证。

## 3. 快捷键不需要主界面取得焦点

官方 Dictate 的步骤是在其他应用的文本框中按快捷键，Windows 默认为 Right Alt。Windows Help me write 发布说明给出 Right Alt + Space。这证明跨应用调用的产品行为，不证明所用 OS API。[Typeless Dictate](https://www.typeless.com/help/quickstart/dictate)、[Windows 发布说明](https://www.typeless.com/help/release-notes/windows/use-help-me-write-desktop)

本机主进程的键盘服务从原生 helper 接收按键，再向 Hub、引导、浮条、卡片广播 `global-keyboard`，同时发出内部事件；平台选择器将 macOS 路由到直接原生库包装、Windows 路由到子进程包装。另有 `requestSingleInstanceLock()` 防止同一应用启动多份实例。证据：BG-KEYBOARD-SERVICE、BG-KEYBOARD-PLATFORM、BG-SINGLE-INSTANCE。

不能把它概括成“Typeless 一定使用 RegisterHotKey”。该 API 是 Windows 的一种系统范围快捷键机制，Typeless 的按键监听代码还有自己的原生 helper；具体 Windows hook 需查看实际 Windows 原生库。[Microsoft RegisterHotKey](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-registerhotkey)

## 4. 唤醒与解锁后清除残留按键

本机代码监听 Electron `powerMonitor` 的 `resume`、`suspend`、`lock-screen`、`unlock-screen`。其中 **resume 和 unlock-screen 调用 `resetPressingKeycodes()`**。这是具体的恢复措施：清理睡眠或锁屏期间可能遗留的修饰键状态。证据：BG-POWER。

该回调本身没有显示重新打开麦克风、重新注册所有热键或重连网络的逻辑，不能写成“Typeless 唤醒后完整自愈”。macOS 的权限变化轮询还会决定开始或停止输入监听，但这一机制也不能直接移植成 Windows 已验证行为。

Electron 文档解释这些电源事件；Windows 另外提供 `WM_POWERBROADCAST` / `PBT_APMRESUMEAUTOMATIC`，可用于本项目的唤醒恢复设计。后两者是平台依据，不是 Typeless 的调用证据。[Electron powerMonitor](https://www.electronjs.org/docs/latest/api/power-monitor)、[Microsoft WM_POWERBROADCAST](https://learn.microsoft.com/en-us/windows/win32/power/wm-powerbroadcast-messages)

## 5. Windows 键盘辅助子进程有重建和状态恢复代码

这是**macOS 包里残留的 Windows 分支**，不是本次运行验证的 Windows 架构。平台常量 `Ft` 固定为 `darwin`，选择器在本机不会选择这个类；ASAR 的 `dist/main` 也没有它所引用的 `keyboard-helper-child-process.js`。证据：BG-PLATFORM-CONSTANT、BG-KEYBOARD-PLATFORM、BG-WIN-KEYBOARD-PROCESS。

该分支的机制可以明确读到：

1. 主进程 `fork` 键盘辅助脚本，用环境变量传入原生键盘库路径。
2. 监听子进程的 `message`、`error`、`exit`；异常退出时拒绝未完成的请求，记录原来的监听状态并尝试重建。
3. 重建使用指数退避：公式为 `min(1000 × 2^(attempt−1), 5000)` 毫秒，配置 `maxReconnectAttempts=3`。
4. 子进程发送 `ready` 后，延迟约 100 ms 恢复监听回调、watcher interval 和目标快捷键。
5. 正常销毁时清除重连定时器，断开并清理子进程。

需注意计数器在 `fork` 成功返回后重置，因此不能把 `maxReconnectAttempts=3` 描述为“整个应用生命周期最多重启三次”。这些代码也只能恢复受主进程监管的子组件；主进程已经死亡时，它本身无法执行这条恢复路径。

## 6. 尚未证实的“保活”能力

| 问题 | 本次能得出的结论 |
| --- | --- |
| 主进程崩溃后自动拉起 | 未取得证据；明确的 `relaunch()` 调用用于重启 IPC/权限操作，不能解释成崩溃监管 |
| 独立 Windows Service / watchdog / 计划任务 | 官方资料没有说明，Windows 安装包未取得；不能断言存在或不存在 |
| renderer 卡死或崩溃后重建 | 当前主进程 member 有界搜索未命中 `render-process-gone` 等处理；不排除依赖/其他平台实现 |
| 睡眠后麦克风/网络全部自动恢复 | 已找到按键状态清理，完整设备与网络恢复未知 |
| 被用户主动退出或结束后自动复活 | 未取得证据；明确 Quit 路径允许应用结束 |
| 闲置 CPU、内存、耗电、麦克风占用 | 未做运行测量，不能给出数字或保证 |

官网麦克风排查仍建议特定情形下完整退出重开，说明存在需要手动恢复的支持路径；不能反过来证明其没有任何自动恢复。[Typeless Microphone unavailable](https://www.typeless.com/help/troubleshooting/microphone-unavailable)

Microsoft 说明传统桌面应用不受那组后台应用权限开关管理。因此 Typefree Windows 的问题应围绕桌面进程、用户会话和组件可靠性评估。[Windows background apps and privacy](https://support.microsoft.com/en-us/windows/privacy/windows-background-apps-and-your-privacy)

## 7. 对照 Typefree Windows 现状

以下是当前工作区的静态代码状态，不是 Windows 长时间运行测试结果。

| 能力 | 当前代码 | 含义与缺口 |
| --- | --- | --- |
| 关闭主窗口后驻留 | `src-tauri/src/lib.rs:881` 附近对 main 的 CloseRequested 调用 prevent_close + hide | 基本托盘驻留已经具备 |
| 托盘与明确退出 | `src-tauri/src/lib.rs:923` 附近创建菜单，quit 调用 app.exit(0) | 可从托盘操作和退出 |
| 单实例 | `src-tauri/src/lib.rs:813` 使用 single-instance 插件 | 避免重复实例争抢资源 |
| 全局快捷键 | Rust 注册后 emit toggle-dictation 等事件 | 热键注册独立于窗口焦点，但触发后的逻辑还有 frontend 依赖 |
| 登录启动 | `src-tauri/src/startup.rs` 写当前用户 Run 项；设置默认 false | 已有能力；未发现静默启动参数和相应窗口分流 |
| 系统禁用启动项后的状态 | startup.current() 比较 Run 项内容与当前 EXE 命令 | 仅此检查无法证明 Task Manager / Settings 中启动项仍被允许 |
| 录音流程承载 | `src/App.jsx:1224` 附近只在 main 中监听 toggle 事件并驱动 pipeline | 隐藏 main 的 JS 仍是关键路径；Rust 进程/托盘存在不保证页面能响应 |
| 睡眠、解锁和设备恢复 | 对 src-tauri/src、src/dictation、App.jsx 的有界搜索未找到 Windows 电源/会话恢复协调器 | 尚未建立或验证系统性的恢复链路；浏览器 AudioContext.resume 与系统恢复不是同一机制 |
| 页面崩溃恢复与健康信号 | 未发现应用层 renderer 健康检查、WebView 失败重建或已送达的任务入口确认 | 可能出现“进程还在、输入入口失效”的故障面，需 Windows 实测 |

主窗口 hide 不等于 WebView2 一定被 suspend。本次没有发现我们调用 `TrySuspend`，也不能声称 Windows 必然自动冻结它。Microsoft 的 TrySuspend 文档说明显式暂停会暂停页面计时器；ProcessFailed / BrowserProcessExited 提供另一组故障通知。这些适合用于设计恢复路径，不能当作已发生故障的证据。[WebView2 TrySuspend/Resume](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2_3)、[WebView2 process model](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/process-model)

## 8. 建议的实现顺序与验收

这是 Typefree 的设计建议，不是 Typeless 已实现功能清单。

1. **先让关键入口可恢复。** 原生层接收快捷键后检查语音控制器是否就绪，对未响应/页面重载建立确认、超时和重建路径。设置界面与录音任务的生命周期逐步解耦；原生录音已经存在，不需要为了形式重写所有功能。
2. **完善登录启动体验。** 登录启动进入托盘，首次配置和明确点击图标时显示主界面；设置读取系统允许的真实启动状态，避免“开关开着但实际被禁用”。
3. **补齐唤醒和设备变化恢复。** 恢复时清理任务与按键残留，按需重查热键、麦克风和网络；处理中断要保留已有结果/可恢复音频并给出可见反馈。
4. **再决定是否需要外部监管。** 先覆盖页面和组件失败、观测主进程真实故障率，再评估独立 supervisor 或 Windows Application Restart。主动退出应停止恢复；睡眠期间不要求持续执行。无需仅为隐藏窗口就引入系统服务。

Windows 验收应至少覆盖：关闭主界面后连续调用；放置 8–24 小时后的第一次调用；登录静默启动；睡眠/休眠和锁屏恢复；耳机切换与麦克风拔插；快捷键冲突；断网后重试；页面重载/renderer 失败；主进程异常退出；用户明确 Quit；升级后的启动路径。每项记录“快捷键收到、开始录音、生成结果、成功投递”的时间及失败原因，并测闲置 CPU/内存/设备占用。上述均是待做验收，本次未执行。

最先要补的能力是 **语音控制链路的就绪判断和恢复**。目前我们已经有托盘、隐藏窗口、单实例和登录启动基础；继续只增强进程存活，仍会留下“程序在后台但无法输入”的体验缺口。
