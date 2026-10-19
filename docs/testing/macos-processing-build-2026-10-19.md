# Mac 链路最终集成验证 v2（2026-10-19）

验证位置：`withtype-pipeline-common/15-withtype` 工作树。本轮未启动或安装 WithType，未改变用户模型配置。

在日期改口、撤回信号误判、部分识别恢复和空识别提示修复后，按冻结的最终 v2 代码重新完成正式构建。产物已覆盖同一工作树中的 v1 App。

| 检查 | 结果 |
| --- | --- |
| `cargo test --offline --lib` | 83 通过，0 失败 |
| `npm run build` | 通过 |
| `npm run verify:appearance` | 通过，17 个颜色 token 和捆绑字体一致 |
| `tauri build --bundles app -- --bin withtype` | release 编译和 App 打包通过 |
| `codesign --verify --deep --strict` | 通过，本地 ad-hoc 签名 |
| App 内容检查 | `app.withtype.desktop`，arm64，最低 macOS 14.0，包含 Speech 用途说明；MacOS 目录只有 `withtype` |

产物：`/Users/outsider/.codex/worktrees/withtype-pipeline-common/15-withtype/dist/macos/WithType.app`。编译缓存复用原项目 `src-tauri/target`，最终 App 复制到此隔离工作树。没有公证，未执行产品录音／投递验收。

最终 `Contents/MacOS/withtype` SHA-256：`a9fbd25ff4c13f6662f8859811a111577f79f627c90b720751d364d535d7ac55`。

原生集成复核覆盖：

- 直接转写、录音会话及保留录音重识别均将正确短词传到 Apple `contextualStrings`；Apple 继续要求设备端识别。
- 会话内 ASR 重试复用同一份 `AsrConfig`，没有跨引擎回退。取消信号传播至识别器；识别超时与用户主动取消分别处理，前者不据此删除录音。
- Apple 的录音中任务和停止后的积压尾段保持有界。部分结果保留错误和 `partial` 状态，前端不将其作为完整内容继续整理投递；保留 spool 且不写 `history.keep`，使录音继续出现在恢复列表。设备错误带有已识别文字时也进入部分结果提示；空识别错误带恢复会话信息。
- `pipeline-benchmark` 受 `required-features = ["benchmark"]` 约束，正式 App 未包含此测试二进制。

边界：App 的“重新识别／恢复录音”入口使用操作当时的设置；录音文件元数据未保存原识别引擎。上述行为没有在本轮被改为跨引擎自动回退。新的 SpeechAnalyzer 仅做只读可行性探查，没有进入正式运行路径，也未下载系统模型。

普通 `cargo build --release` 会被项目已有的 release 入口保护拒绝，需使用上述 Tauri 构建命令或显式启用 `tauri/custom-protocol`。
