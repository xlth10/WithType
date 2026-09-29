# Typefree Windows 复现研究

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
