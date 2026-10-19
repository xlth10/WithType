# Apple 新 ASR 可行性探查（2026-10-19）

结论：值得安排 macOS 26+ 的独立升级实验，但本轮不替换正式实现。当前 Mac 支持新模型的中文，模块资源预检尚未达到可用状态；未下载资源、未运行新引擎识别，不能宣称它修好了现有错词。

本机环境为 macOS 27.0.1，Xcode-beta SDK 27.0、Swift 6.4。SDK 的 `SpeechAnalyzer`、`SpeechTranscriber`、`DictationTranscriber` 均要求 macOS 26+。正式产品仍需保留 macOS 14 的旧桥接路径。

| 只读运行时检查 | 观察 |
| --- | --- |
| `SpeechTranscriber.isAvailable` | `true` |
| 两个 transcriber 的 `supportedLocale(equivalentTo: zh-CN)` | 均为 `zh-CN` |
| `SpeechTranscriber.installedLocales` | `zh-CN`、`zh-TW` |
| `DictationTranscriber.installedLocales` | `en-US`、`zh-CN` |
| `AssetInventory.status`：Speech 默认／最小配置 | 均为 `supported` |
| `AssetInventory.status`：Dictation 默认／最小配置 | 均为 `supported` |
| 资源预留／下载操作 | 未调用 |

`installedLocales` 与具体模块资源状态存在差异，应按更细的模块状态作保守判断。Apple 将 [`supported`](https://developer.apple.com/documentation/speech/assetinventory/status/supported) 定义为配置可用但仍需下载资源，[`installed`](https://developer.apple.com/documentation/speech/assetinventory/status/installed) 才表示模块已具备可运行资源。本次没有执行可能进入模型准备流程的分析调用。

[`SpeechTranscriber`](https://developer.apple.com/documentation/speech/speechtranscriber) 是值得对照的新设备端转写模型。Apple 的 [WWDC25 说明](https://developer.apple.com/videos/play/wwdc2025/277/)介绍了新模型及文件／实时分析方式；其质量是否优于当前中文路径仍须用同一 WAV 验证。

[`DictationTranscriber`](https://developer.apple.com/documentation/speech/dictationtranscriber) 使用系统听写和旧 `SFSpeechRecognizer` 设备端模式相同的模型，主要是新分析接口，不应把切换 API 当作准确率升级。官方 [`AnalysisContext.contextualStrings`](https://developer.apple.com/documentation/speech/analysiscontext/contextualstrings) 文档明确描述其对 DictationTranscriber 的短词提示用途；不能据此声称 SpeechTranscriber 也会获得相同热词收益。

建议后续试验保持为独立选项：仅在 macOS 26+、中文受支持且模块 `installed` 时启用新引擎，仍复用现有文字模型；模型缺失时向用户明确说明系统资源需求。先针对同一批 16 例音频比较错词、数字、否定及遗漏，再决定是否推荐。旧 macOS 及未就绪设备继续当前 Apple 路径，识别任务中不偷偷切换引擎。

可复现证据：[`status-probe.swift`](speech-analyzer-evidence/status-probe.swift)、[运行结果](speech-analyzer-evidence/status-2026-10-19.json)。探针只读系统服务，需要在能够访问系统 Speech XPC 服务的环境执行；受限沙箱会返回空语言列表，不能将该空结果解释成设备不支持。
