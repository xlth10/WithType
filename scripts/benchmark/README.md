# 可重复处理链路基准

本基准导入 `--source-root` 内真实的 `createPipeline`，通过 JSONL 适配器调用实际 Apple Speech / 当前文字模型。不会把界面预览的固定文本、mock 或单元测试当服务实测。

- `manifest.json`：16 条固定口述，涵盖短句改口、数字、否定、专名、中英混说、强调、列表、长段撤回和润色保真。
- `synthesize.mjs`：使用已安装的 macOS Tingting，以 185 语速生成 16 kHz、单声道、PCM16 WAV；记录 SHA-256。沙箱若静默生成空音频会拒绝继续。
- `run.mjs`：读取非密钥配置白名单，导入指定源树，输出 `results.jsonl`、`summary.json` 和 `REPORT.md`。
- `compare.mjs`：核对执行方式和音频 hash，生成前后逐例文本报告。
- `combined-adapter.mjs`：Apple ASR 走独立授权、由 LaunchServices 启动的 Speech probe；文字走产品 Rust 客户端。
- Rust `pipeline-benchmark`：通过 `--features benchmark` 构建，调用产品已有 ASR / 文字客户端及系统凭据库。JSONL 中不包含密钥，也不会输出网关原始错误正文。

## 执行

```sh
node scripts/benchmark/synthesize.mjs --output /private/tmp/withtype-audio
cargo build --manifest-path src-tauri/Cargo.toml --features benchmark --bin pipeline-benchmark
node scripts/benchmark/run.mjs \
  --source-root /absolute/source-tree \
  --settings /absolute/non-secret-settings.json \
  --manifest scripts/benchmark/manifest.json \
  --audio-dir /private/tmp/withtype-audio \
  --output /private/tmp/withtype-before \
  --platform macos --label baseline \
  --adapter-command '["/absolute/path/to/pipeline-benchmark"]'
node scripts/benchmark/compare.mjs /private/tmp/withtype-before /private/tmp/withtype-after /private/tmp/COMPARISON.md
```

Apple Speech 需用已授权 probe 的组合适配器，而非直接启动裸 CLI 请求 Speech。组合参数：

```text
--adapter-command '["node","/absolute/scripts/benchmark/combined-adapter.mjs","--asr-command","[\"/bin/sh\",\"/absolute/apple-speech-probe.sh\"]","--text-command","[\"/absolute/pipeline-benchmark\"]"]'
```

可用 `--case short-simple,short-correction` 先烟测，`--repeat 3` 重复采样。服务失败默认立即停止；`--continue-on-service-error` 仅用于有明确理由的继续诊断。

`--text-only` 使用固定口述参考文本输入实际产品路由及真实文字模型，隔离观察整理差异；这项结果必须标注为“参考文本 → 真实文字模型”，不能写成 ASR 实测。

## JSONL 契约与凭据

输入每行 `{"id":"...","command":"...","args":{...}}`，输出每行 `{"id":"...","ok":true,"result":{...}}` 或 `{"id":"...","ok":false,"error":"安全摘要"}`。

- `health`：只读状态，不请求 Speech 授权或读取密钥。
- `transcribe_audio`：`args.request` 使用产品请求字段：`audioBase64`、`filename`、`provider`、`locale`、`endpoint`、`model`、`hotWords`。Rust adapter 另支持 `audioPath`。
- `process_text`：`args.request` 与产品现有命令一致，包括 messages / model / endpoint / authMode / timeoutMs。
- `cancel_text_request`：取消指定 requestId。

当前文字模型、快模型与回退列表全部来自已有配置；温度沿用产品 0.2。默认不更换模型。系统凭据只能在原生客户端内使用；Keychain 授权受阻要记录 blocked，不绕过、不把密钥写入命令行或报告。

## 结果口径

每条保留 ASR 文本、词库处理后文本、文字模型输出、最终文本、真实请求耗时和处理路由。记录 `stopToReadyMs`，但它从提交既有 WAV 开始，不能代表录音中预识别后的实际松手延迟。

复制/上屏使用结果收集器，不操作系统剪贴板，也不验收焦点、UIA、真实输入框或快捷键。合成语音不能代表口音、背景噪声和实际麦克风质量。自动检查是局部语义约束，所有成稿都保留人工语义复核要求；不得称作准确率。

用户本轮没有 Windows 设备，且 Windows ASR 没有真实服务地址；Windows 服务与客户端实测暂缓，不能用 Mac 或 HTTP 测试代替 Windows 验收。
