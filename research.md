# Typefree Windows 复现研究

## 2026-10-12 后台可用性实施决定

用户已授权按 [Typeless 后台调查](docs/typeless-background-lifecycle-research.md) 的方向优化。本轮先由原生宿主监管现有语音页面，逐步解耦任务生命周期，不整体重写录音流水线。

- Rust 保存控制器代次、就绪状态、命令确认与当前任务身份；快捷键、托盘与 HUD 经同一入口调度。页面订阅完成且配置、历史、词库载入后才就绪。未就绪明确反馈，已送达的操作不自动重放，避免重复录音或投递。
- 原生定时探测页面响应，超时或页面重新载入时撤销旧代次，取消旧任务的文字/投递并保留已采集音频。恢复有次数和时间窗口限制，明确退出停止监管，不无限重载。
- Windows 电源/用户会话事件由原生消息窗口接收；睡眠或锁屏中止当前任务，解锁/唤醒后验证控制器与热键。设备错误沿用现有保存/重试路径；不自动延续被中断的录音，也不占用麦克风待机。
- 登录启动命令使用明确标记，已完成语音模型配置时静默进入托盘；首次配置、手动打开和托盘设置显示主界面。读取系统禁用启动项的状态，应用启动时不自行重新启用用户禁用的项目。
- 增加原生状态机和前端异步入口测试，覆盖旧页面迟到确认、命令不重放、准备失败、恢复次数限制、睡眠去重与退出。Mac 自动验证与 Windows 编译检查不等同于长时间闲置、真实睡眠、WebView2 故障的实机验收。

平台一手依据：[WM_POWERBROADCAST](https://learn.microsoft.com/en-us/windows/win32/power/wm-powerbroadcast)、[WTSRegisterSessionNotification](https://learn.microsoft.com/en-us/windows/win32/api/wtsapi32/nf-wtsapi32-wtsregistersessionnotification)、[WebView2 process model](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/process-model)。本轮不设置系统服务或阻止 Windows 睡眠。

日期：2026-09-24

## 研究问题

如何在 Windows 上复现 Typefree 的核心语音输入体验，同时使用现有 `vibevoice-windows` 的语音模型、文字模型和快捷键架构？

## 来源与证据

| 来源 | 证据强度 | 观察到的机制与边界 |
| --- | --- | --- |
| [Typefree 官方 README](https://github.com/kdsz001/typefree/blob/main/README.md)，kdsz001，2026-09-24 访问，`mac/` GPL-3.0 | 高 | 按住语音输入、松开整理并上屏；提问、翻译、词库、历史是主要功能。README 明确名称、图标、官网内容不在开源许可中。 |
| [Typefree 官网功能说明](https://typefree.app/index.en.html)，Typefree，2026-09-24 访问，网页许可未声明 | 中 | 云端 ASR + 可选文字整理；口述结果到光标；历史保留策略。网页与 README 的价格政策有版本差异，不用于本复现。 |
| `/Users/outsider/SEVB/VA/vibevoice-windows/README.md` 及源码，当前本机项目，2026-09-24 访问，许可未见声明 | 高 | Tauri 2 + React，Windows 全局快捷键、WAV 采集、OpenAI 兼容 ASR/文本接口、Windows 凭据库、粘贴与恢复剪贴板。该项目作为本地实现参考。 |

## 2026-09-24 初版结论（交互范围已由文末修订取代）

- 原版为 macOS Swift 应用，无法直接构建为 Windows 可执行文件；Windows 版需要独立实现系统交互层。
- 可复用本机 Windows 项目成熟的 ASR、文字模型、全局快捷键、录音和上屏链路，在其基础上提供 Typefree 风格的按住说话与整理流程。
- 默认服务地址必须由使用者配置，不把参考项目的内网地址写成有效默认配置；密钥保存在 Windows 凭据库。
- 只参考行为，不复制 Typefree 的名称之外的商标视觉资源或官网素材。用户指定的 `typefree.exe` 仅作为本地构建目标名；若公开分发须另行处理商标命名。

## 2026-09-24 初版假设（历史记录）

- Windows 全局快捷键插件可以区分按下与抬起，适合实现按住口述；原本 `vibevoice-windows` 是按一次开始、再按一次结束。
- 全局鼠标左键长按与普通点击、拖拽存在冲突。第一版保留可靠的全局按键口述，应用窗口中的鼠标按钮可以按住录音；系统级鼠标触发需 Windows 实机交互验证后再加入。
- 本机参考项目的历史保存在 WebView localStorage；这不足以达到原版加密历史的描述。第一版先提供本地历史与清除能力，后续应迁移到受保护的本地存储。

## 2026-09-24 第一版边界（历史记录）

1. Windows 桌面托盘应用、全局按住口述、录音 HUD、WAV → ASR → 可选文字整理 → 光标上屏。
2. 独立语音与文字模型设置、Windows 凭据库、快捷键录制和冲突回滚。
3. 提问、翻译、术语纠错、可选技能整理、本地历史。
4. Windows CI 构建 NSIS `.exe` 与 MSI；在当前 macOS 环境只能验证前端与纯逻辑，安装包需 Windows runner 验证。

## 2026-09-24 待验证事项（当前步骤见 docs/windows-acceptance.md）

- Windows 全局快捷键释放事件在各类键盘和权限级别下是否可靠。
- WebView2 麦克风授权、目标应用粘贴、剪贴板恢复在 Windows 10/11 的实机结果。
- 安装包产物和首次启动流程。


## 2026-09-28 范围修订与实现研究

用户明确要求采用 vibevoice-windows 的快捷键、最新语音动效、exe 构建方式，并复刻 Typefree 自动学习词汇。本节取代上文的按住/松开与后续鼠标交互设想。

### 一手依据

- Typefree `main` 固定为 `9d16762c52906f054285b630935017a431e9e627`，读取 `mac/Sources/HotWordsAutoLearner.swift`、`AutoLearnScheduler.swift`、`mac/VoicePolishCore/Sources/VoicePolishCore/MishearingCheck.swift` 与 `PersonalVocabulary.swift`（2026-09-28）。来源：https://github.com/kdsz001/typefree/tree/9d16762c52906f054285b630935017a431e9e627/mac 。算法移植保留 GPL-3.0 许可与归属。
- 当前上游实际规则为两次相同纠正后自动采用，并非 README 的“改过一次”。仅观察本次投递范围，60 秒窗口、500 ms 检查、4 秒静置、30 天候选寿命；短词最多 12 字，中文同音/近音判断，过滤数字变化、语义同音字和整句重写。
- `AutoLearnScheduler` 已于 2026-09-11 默认禁用从成稿挖词，防止自我强化误识别。本次不启用成稿挖词，也不扩展到风格画像。
- 本机 `vibevoice-windows/src-tauri/src/lib.rs` 仅响应 Pressed 事件；同一快捷键再次按下结束录音。三个默认组合保持一致。
- 最新动效在 `prototype/voice-motion/motion-core.mjs` 的 D 墨珠版本，晚于生产 App 内旧彩色波形。采用 D 的 55 ms 电平采样、静音收点、两侧高度限制和无弹跳过渡。
- 本机 `build-local.sh` 与 `.cargo/config.toml` 使用 Windows GNU Rust + 用户目录 MSYS2 MinGW、`dlltool`、`-pipe`。移植为可配置路径的脚本；继续保留 MSVC CI。

### 实现决定与边界

1. 恢复按一次开始/再按一次结束，处理麦克风启动期间再次按键或取消；不引入系统鼠标手势。
2. Windows UI Automation 在独立 COM 线程中捕获投递输入框，确认实际插入后才观察；密码框、无法读取或定位不明确的输入框跳过，焦点变化停止。上下文仅存内存，持久化短词候选和规则。
3. 自动学习仅跟随普通口述的自动粘贴；关闭开关立即终止观察，已有词保留。手动词优先，自动规则有限额，删除的规则不再学习。历史纠正作为无法读取输入框时的显式教学入口。
4. 学到的词在下一次任务生效，通过本地替换接入现有语音/文字链路；不假定私有 Qwen ASR 支持未验证的热词参数。
5. 当前 Mac 验证纯逻辑、界面、Rust 可编译部分与构建入口；Windows 快捷键/UIA/WebView2/安装包仍须 Windows 环境实测。

## 2026-09-29 语音处理架构修订

用户进一步要求：主要面向 Windows EXE；采用 Typefree 的边录边提交；ASR 与文字模型自行定义，其余语音处理行为对齐 Typefree。此前确定的 vibevoice 快捷键、墨珠动效及构建路线继续保留。

### 研究决定

- 正式桌面采集目标改为 Rust 后端的 WASAPI 共享模式，前端负责控制与电平显示。修订时浏览器预览仍用 `ScriptProcessorNode`，MDN 已将它标为弃用；实施中已改为 AudioWorklet。
- 采集和上传编码解耦。采集采用设备支持的格式，后台完成下混与连续重采样；分段分析使用 16 kHz 单声道 PCM。
- 原版 AAC 参数已核实为 24 kbps 单声道；当前 PCM16 WAV 为 256 kbps。1 分钟理论载荷分别约 180 KB、1.92 MB，未计容器开销。
- Microsoft 系统 AAC 编码器文档列出的输入采样率为 44.1/48 kHz、码率从 96 kbps 起，不能声称 Windows 原生编码直接复现 macOS 的 16 kHz/24 kbps 压缩参数。编码和 ASR 能力确认后优先 M4A；能力未确认保持 WAV。
- 原版当前入口默认边录边发：2 秒评估、目标段长约 6 秒、最短约 3.5 秒、末端安全边距约 1.5 秒；按停顿提交 HTTP 请求，结束后处理尾段，最终统一输入。
- 文本短句判断、最终词库纠正、失败原文回退、ASR 同模型重试、历史/音频恢复、翻译与问答列为对齐目标。ASR 格式、上下文参数和限流由自定义服务实际能力决定。

完整设计、差距和验收基线见 [Windows 语音处理设计](docs/audio-architecture.md)。实施已进入源码，但 Windows 真实设备和服务验收仍未完成；以设计文档的分层状态为准。

### 关键来源与待验证

- [Typefree M4AEncoder](https://github.com/kdsz001/typefree/blob/9d16762c52906f054285b630935017a431e9e627/mac/VoicePolishCore/Sources/VoicePolishCore/M4AEncoder.swift)：参数与回退实现，GPL-3.0，证据高。
- [Microsoft WASAPI](https://learn.microsoft.com/en-us/windows/win32/coreaudio/wasapi) 与 [AAC Encoder](https://learn.microsoft.com/en-us/windows/win32/medfound/aac-encoder)：Windows 平台接口与编码器约束，证据高。
- [MDN ScriptProcessorNode](https://developer.mozilla.org/en-US/docs/Web/API/ScriptProcessorNode/audioprocess_event)：现有浏览器采集节点的弃用状态，证据高。

用户已选通用 OpenAI 兼容 WAV 接口：实现固定使用 16 kHz PCM16 WAV，不假设 M4A/AAC、词汇上下文或额外并发额度。WASAPI 共享采集不等价于浏览器的回声消除/降噪，需用实际设备录音比较；原生采集不能直接推导为识别更准。未声称尚未测量的性能提升。

## 2026-10-09 语音 Skill 案例调研

针对现有技能使用不成熟的问题，核对了本项目源码，以及 Superwhisper、闪电说、Aqua、Wispr Flow、VoiceInk、OpenWhispr、Windows Voice Access 和 Agent Skills 的一手资料。建议先补明确调用、场景与输入契约、样例、选区编辑和恢复闭环，工具执行另设路径。公开功能与实验功能、平台差异、设计推论均分别标明；本次未实施产品变更或完成效果实测。

完整结论见 [语音 Skill 调研](docs/voice-skills-research.md)，外部案例的具体证据见 [案例笔记](docs/voice-skill-cases-notes.md)。

## 2026-10-11 长文完整性与低延迟整理实施

用户已授权按 Typeless 对照研究的方向优化。研究依据为 [机制与差距](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/typeless-performance-lessons.md) 与 [文字路径核查](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/typefree-text-latency-code-notes.md)。本次进入实现前的决定：

- 首先保证全文覆盖，普通整理/翻译超长输入按语义边界分段；需要全文规划的技能、问答与命令超限明确失败或回退原文，禁止静默裁尾。
- 补独立停止后墙钟计时、分类与文字请求统计；普通整理允许快速模型优先，失败与分段共享阶段总预算。保留普通口述原文回退、取消和单次最终投递。
- ASR 复用 HTTP Client；继续采用用户已选的 WAV 接口和串行 ASR，不引入厂商私有推理参数、预测输出或并行模型竞速。
- 将已有 SSE 扩展为文字整理预览，预览不直接写入目标应用；流不完整、模型长度停止与输出超限作为失败处理，不能把半篇当成功。
- 稳定段提前整理作为可选能力，默认关闭并说明会增加请求；仅普通智能整理、无自动意图分类时适用。保留尾段、编号、原文与缓存一致性检查；复杂 skill 与翻译整条任务不使用这一缓存。
- 本轮仅处理录音文本与已有应用身份，不增加目标输入框、剪贴板或屏幕上下文上传。上下文采集契约另行设计。

验证使用本地可控制的假服务/注入式流水线，覆盖超限保真、分段失败、共享预算、迟到与取消、提前整理复用及流式截断。真实模型吞吐、整理质量和 Windows 设备/投递效果仍须实机测量；自动检查不作固定倍数提速声明。

## 2026-10-11 输入交互与卡片定位实施

用户明确选择：卡片优先出现在输入光标附近；无法取得输入光标时，在鼠标所在屏幕底部居中。并授权落实此前[交互审计](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/voice-input-interaction-audit.md)中的投递和恢复方案。

- 定位按 Windows UIA TextPattern2 活动 caret 与 Win32 GUITHREADINFO 系统 caret 获取，不把鼠标或输入框矩形冒充输入光标。屏幕使用工作区和 DPI，优先下方、空间不足向上、边缘限制；同一张卡片更新内容保持初始锚点。
- 录音开始捕获目标控件身份；投递前校验同一目标、可编辑性与焦点。不可编辑、变化或无法确认时复制并显示可恢复的结果卡片，不把 SendInput 返回计数当成文字已输入。
- 默认完成后保留正文在剪贴板，取消原有纯文本恢复线程；明确这会替换系统剪贴板内容，不提供会损坏多格式内容的部分恢复。用户在投递过程中主动复制的新内容优先，粘贴与复制通过同一串行路径执行。
- 取消状态覆盖原生登记前阶段，已取消 ID 不得因登记重新激活；发送按键前等待用户修饰键释放，并再次检查目标与取消。请求重试/历史重转写默认只生成可回看结果，显式重新输入另选目标。
- 统一记录结果去处、准确的复制反馈与失败恢复；从保留历史恢复最近结果，提供直接复制上次结果入口。保留现有问答卡片、命令失败不输入原命令、迟到结果过滤与词汇观察保护。
- 本轮不引入任意系统工具、批量文件操作、屏幕/剪贴板内容上传或厂商私有推理参数。选区编辑等进一步的模型上下文能力与外部动作不是修复投递所需的隐含行为。

一手接口依据：[GetCaretRange](https://learn.microsoft.com/en-us/windows/win32/api/uiautomationclient/nf-uiautomationclient-iuiautomationtextpattern2-getcaretrange)、[GetBoundingRectangles](https://learn.microsoft.com/en-us/windows/win32/api/uiautomationclient/nf-uiautomationclient-iuiautomationtextrange-getboundingrectangles)、[GetGUIThreadInfo](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getguithreadinfo)、[SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput)。退化文本范围可能没有矩形，光标获取失败须正常回退；实际 Windows 浏览器/富文本应用、管理员窗口和混合 DPI 行为仍须实机验收。


## 2026-10-12 前端色彩与字体基准

用户报告此前导入 Windows 后与 Mac 色彩不同，并明确选择“以本机 Type 最新版为准，同步色彩和字体，保留当前交互”。参考目录 `/Users/outsider/SEVB/Type` 仅作为只读输入。

- 确认存在不同源码色板：本项目沿用 `vibevoice-windows` 的白/暖灰；参考 Type 的表面为 `#fcfcf9`、工作区 `#f8f9f4`、侧栏 `#efefe9`、文字 `#282c27`。这是可确认的版本差异，不能直接认定为历史 Windows 色差的唯一原因。
- 同步当前组件适用的颜色、字体家族和基础文字规格，保留现有窗口尺寸、页面组件、卡片定位和投递行为。使用参考项目随包 Noto Sans SC Sans2.004 可变 WOFF2，保留官方版权、OFL 1.1 许可和哈希信息，不依赖在线字体。
- 固定 HTML/CSS 与三种 Tauri 窗口的浅色主题，明确主窗与卡片底色、保留 HUD 透明背景；保留系统强制高对比模式。
- 建立可携带的色板、字体及源码/构建哈希基准；核对生产字体与源码字节一致，并检查实际浏览器计算色值及 HUD 透明背景。
- 字形文件一致不等于屏幕像素完全一致：不同系统光栅化、DPI、显示器色彩管理与缺失字符回退仍需 Windows 实机核对。

接口依据：[Tauri window configuration](https://v2.tauri.app/reference/config/#windowconfig)、[CSS color-scheme](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/color-scheme)、[WebView2 PreferredColorScheme](https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2profile.preferredcolorscheme)。当前锁定 Tauri 2.11.6 / Wry 0.55.1 源码同时确认了系统主题默认值与 WebView2 配色映射。


### 已定稿进入动画接入生产 · 2026-10-13

用户已确认 C 圆形墨珠落纸、湿墨成字与自定义欢迎语符合预期，要求确认 Windows 复现后提交；随后明确调整为「暂时不验证，代码通过测试即可」。用户随后明确将动画和欢迎语合入新的正式目录 projects/15-withtype，而不恢复旧 Type 作为正式版本。新正式版此前没有进入动画，C 只在旧 Type 文档预览，故提交前必须接入生产。保留新正式版其它语音输入功能；现有 Windows 主窗为 1060×720、最小 860×620，额外核验 640×480 的浏览器构图，使用 Vite 构建的同一 React 前端、离线 Noto 字体和 WebView2。当前 Mac 没有可用 Windows GUI/VM；GitLab origin 不执行现有 GitHub Actions，不能将源码/构建检查表述为实机验证。

方案：将项目自行绘制的纸场与字形距离场提取为共享 ES module，正式 App 与 C 预览共用同一渲染器；保留 3.6 秒、初始正圆、3倍墨画布和2倍纸纹采样、同一几何参数。所需运动值由第一方标准插值、二次加速、衰减振荡、对数缩放与 xorshift32 实现，生产不导入仅非商业的 OneTake 原库。字体与保存配置就绪后播放；保留打断、减少动态、焦点、隐藏结束与托盘重新打开，释放 RAF 与画布缓存。保留 A/B/C1 及批准 C 的历史基线。

本轮提交门槛：运动和播放器单测、完整前端单测、Vite 生产构建、可执行的本机 Rust 测试，以及批准 C 和共享绘制器的关键帧/主窗交互核对。Windows 实机的 DPI、CSP 和冷启动另列待验收。
