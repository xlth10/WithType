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
