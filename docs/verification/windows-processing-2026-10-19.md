# Windows 处理链路优化与复测 · 2026-10-19

Windows 独立工作树：`codex/processing-windows-20261019`。优化前基线：`534b3d7`。两端共通的整理规则、完整性修复由共通分支提供；Windows 保留当前专有 ASR 的 `model + file` 请求契约，继续使用现有文字模型。没有加入未经该服务确认的热词、数字清理或去不流畅参数。

## 本轮交付

- `scripts/verify-windows-processing.ps1`：读取当前模型配置的白名单字段及 `vocabulary.json` 的 `entries`，对同一音频、同一模型配置分别执行两个工作树。默认构建并调用 Rust `pipeline-benchmark.exe`，复用当前应用的真实 ASR/文字请求与 `keyring` 凭据读取。不会修改用户设置、词库、凭据或历史。ASR 服务地址缺失时在产生结果前停止。
- `tests/windows-benchmark.test.mjs`：Windows PowerShell 双工作树同配置快照契约，以及缺失 ASR 服务地址时阻止假实测的测试。测试不访问凭据或网络。

服务实验经 Rust CLI 复用实际客户端请求。ASR 为 PCM16 WAV multipart，文字整理为现有模型的 chat/completions。原生适配器直接调用模型服务，不运行 Windows 桌面界面，因此无法覆盖 WASAPI、DPAPI、全局快捷键、WebView2、UIA 或实际粘贴。基线与优化前端逻辑共用同一原生服务适配器，能比较分流与提示词效果；不会把原生录音/投递性能改进算进服务计时。

## 当前可确认与待验证范围

| 层次 | 本轮状态 | 能支持的结论 |
| --- | --- | --- |
| Windows 工作树基线 JS 回归 | 257 通过、4 跳过 | 其中两项为新增 Windows 专用测试，另外两项为既有 Windows provisioning；不表示 PowerShell 已在 Mac 执行 |
| Windows PowerShell 验收入口契约 | 本机为 macOS，无 PowerShell，未执行 | 已提供 Windows CI/实机可运行用例 |
| 完整 Windows Rust 交叉检查 | 未通过环境准备 | 已安装 Rust target，但 `ring` C 构建缺少 Windows SDK `assert.h`；不属于 Windows 构建通过 |
| Windows 专有 ASR 服务实测 | 用户确认是测试配置、没有实际服务地址，本轮暂缓 | 不推导私有地址，不使用替代服务冒充，不继续请求凭据 |
| Windows 客户端采集与投递 | 没有 Windows 电脑/VM，未执行 | 没有 Windows 实机准确率或停止到上屏延迟结论 |

当前本机配置的安全白名单检查仅确认专有模型名为 `Qwen/Qwen3-ASR-1.7B`，ASR endpoint 为空；文字主/快模型均为 `deepseek-flash`，主机为 `api.deepseek.com`。这些是配置值，不表示服务调用成功。未读取或输出实际密钥。

## 在 Windows 运行一次前后对比

准备两个不同工作树：基线固定在 `534b3d7`，优化树使用本轮 Windows 分支；每个工作树先完成 `npm ci`。模型配置沿用当前 Windows 用户的应用设置和 Credential Manager，不复制 macOS 钥匙串或历史。

把同一批录音和 manifest 放在固定目录。暂时没有真实口述录音时，可使用共用 benchmark 的合成语料，但报告必须标注 synthetic，不能据此宣称真人口述体验已经验收。命令示例：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-windows-processing.ps1 `
  -BaselineRoot C:\WithType-before `
  -OptimizedRoot C:\WithType-windows `
  -Manifest C:\WithType-corpus\manifest.json `
  -AudioDir C:\WithType-corpus\audio `
  -OutputDir C:\WithType-results\windows-processing `
  -RunChecks
```

使用 PowerShell 7 时也可以由 `pwsh` 执行。默认设置位置是 `%APPDATA%\app.typefree.windows.unofficial\settings.json`；测试环境可显式传 `-SettingsPath` 和 `-VocabularyPath`。预先编译的原生适配器可用 `-NativeBenchmarkExe` 指定。默认构建要求 Node.js、Rust 和 Windows C/C++ 构建工具。输出目录必须为空，以免覆盖原始对比。整个过程只生成临时非密钥设置快照，结束时删除；保留音频原件。

结果分为 `baseline/` 和 `optimized/`，各有 `results.jsonl`、`summary.json`、`REPORT.md`。顶层 `windows-validation.json` 独立记录服务实验与原生单元检查状态，同时把客户端运行、采集、UIA/粘贴标为待人工验收。逐例查看原始 ASR、词库处理后、最终文本、失败信息和请求耗时，再比较准确率及延迟；服务往返时间不能代替停止到实际上屏时间。

## Windows 桌面补充验收

获得 Windows 环境后，执行 [完整验收清单](../windows-acceptance.md) 和 [输入可靠性清单](../windows-input-reliability-2026-10-14.md)，本轮重点补充：

1. 新装与旧配置都使用专有 ASR，文字模型名称和服务保持原配置。Apple 模式不应成为 Windows 默认。
2. 同一麦克风重放或真人重复读基线与优化语料，覆盖短句改口、数字、否定、专名、中英混说及长句。核对 ASR 原文和最终成稿，记录最后发声、停止操作、完整上屏时间。
3. 尾段服务故障时，只能显示部分结果或失败状态，保留完整录音供重试；不能把前段当成完整成功后删除录音。
4. 纠正专名后检查正确词学习；当前专有 ASR 不支持已确认的热词注入，不能仅凭词条已保存宣称下一次识别会更准。显式手动替换与旧规则仍单独验证。
5. 处理中取消、切换窗口、用户自行复制内容，以及故障后重试均不应发生迟到投递、重复文本或覆盖用户剪贴板。

## 尾段并发决策

录音期间保持单个识别请求。停止后的长尾才有潜在并发收益，需先等待已有在途请求，再按停顿切分尚未确认的音频，限制并发并按音频原序提交结果。失败段不能被后续成功段跨过，完整录音应保留。专有服务的并发上限和限流行为尚未实测，因此本轮不把 Typefree 的五并发直接套入默认设置；短尾也没有拆分收益。Apple 文件识别的请求时长与端侧资源约束应在 Mac 分支独立处理。
