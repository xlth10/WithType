# Apple Speech 验证方式

本次 Mac 链路默认选择 Apple 设备端 ASR；用户显式选择的兼容服务继续保留。文字整理仍使用已有模型配置。

`apple_speech::transcribe(audio, locale, contextual_strings, cancelled)` 将短词提示经 JSON 传入原生桥的 `SFSpeechRecognitionRequest.contextualStrings`。每项最多 40 个 Unicode 字符，拒绝控制字符、折叠词间空白、忽略大小写去重，最多检查 1000 项并保留前 100 个有效短词。Rust 和 Objective-C 两层均有边界检查。每个 50 秒以内的实际识别分段获得同一份词库。端侧识别、语言能力检查、取消及授权语义保持原样。

Apple 将 contextual strings 定义为短词组识别提示，它不会保证某个热词必定出现在结果中：[Apple 官方说明](https://developer.apple.com/documentation/speech/sfspeechrecognitionrequest/contextualstrings)。

## 独立探针

```sh
# 默认只读能力，不请求权限
printf '%s\n' '{"id":"health","command":"health","args":{"locale":"zh-CN"}}' | scripts/benchmark/apple-speech-probe.sh

# 明确请求独立测试 App 的系统语音识别授权，30 秒内由人处理弹窗
scripts/benchmark/apple-speech-probe.sh --authorize

# 基线：hotWords 为空；优化：同一录音带入正确热词
printf '%s\n' '{"id":"baseline","command":"transcribe_audio","args":{"audioPath":"/absolute/fixture.wav","locale":"zh-CN","hotWords":[]}}' | scripts/benchmark/apple-speech-probe.sh
```

探针复用生产 Objective-C 桥，以独立 `com.withtype.speech-probe` App 经 LaunchServices 启动；不会读取产品设置、历史或钥匙串，也不会录制麦克风。JSONL 还支持 `audioBase64`。用于测试的录音应是低于 50 秒的 16 kHz 单声道 PCM16 WAV。结果中的 `durationMs` 记录识别调用耗时，不包含启动 App 的开销。探针没有文字模型职责，由 benchmark 的组合 adapter 调用已有文字服务。

不要直接执行临时 App 中的二进制来请求权限：macOS 可能将请求归属到自动化宿主，导致宿主缺少用途说明而被 TCC 终止。包装脚本通过私有临时 FIFO 交换 JSONL，并经 `open` 启动 App；不修改 TCC 数据库，也不自动操作任何权限弹窗。

## 2026-10-19 实测能力

- macOS 27.0.1；探针读取到 `zh-CN` 和 `en-US` 均 `available=true`、`supportsOnDeviceRecognition=true`，支持语言列表含普通话、粤语、吴语和英语等。
- 首次只读检查为 `notDetermined`。按本次真实 ASR 测试授权发起显式请求后，LaunchServices 启动的探针返回 `authorization=authorized`、`zh-CN` 端侧能力可用。
- 原生桥 `-Wall -Wextra` 编译、JS 提供方测试及 Rust 格式检查通过。真实识别前后结果由整体 benchmark 报告记录；能力探针成功不等于产品录音、文字整理和上屏全链路验收成功。
- 本次只能使用合成语音补充样本，不能代表用户自然口述、噪声、停顿或口音下的收益。独立测试 App 的授权也不等于 WithType 产品 App 已获授权。

### 实际识别烟测

本机 `say -v Tingting` 生成“明天下午三点，不对，改成四点开会。请不要发送最终版本。”，`afconvert` 转为 16 kHz 单声道 PCM16 WAV。通过同一 Apple 原生桥先后执行：

| 条件 | ASR 返回 | 识别耗时 |
| --- | --- | --- |
| 不带热词 | 明天下午3:00不对，改成4:00开会，请不要发送最终版本 | 404.90 ms |
| 带 `WithType`、`最终版本` 热词 | 明天下午3:00不对，改成4:00开会，请不要发送最终版本 | 219.29 ms |

该样本证明端侧 ASR 与热词传参路径可执行，不证明热词改善了准确率；单次顺序测试有冷暖差异，不能解释为提速。ASR 保留了改口原文，最终意图还需要后续文字整理模型处理。
