# Windows 更新整合 · 2026-10-22

Windows 更新统一在 `codex/processing-windows-20261019` 对应的 Windows worktree 中实现、验证和提交。

## 整合来源与结果

- Windows 原分支 `c97e7ff`：平台 ASR 路由、口述整理链路、词库管理与自动学习、资源读取失败后的控制器恢复。
- 导入 `main` 的 `8414f8d`：模板 v2 结构、参考样例、独立缺项策略、旧模板迁移、试用结果编辑与显式保存、过期试用保护。
- 合并为双亲提交，保留两侧提交历史。主目录中待提交的通用界面、进入动画与启动改动已包含在 `534b3d7` 快照及 Windows 后续提交中，本次保留 Windows 的新链路和词库实现。
- 早期备份 `codex/pre-sync-20261015` 的焦点捕获和输入投递功能已由现有历史 `afa1728` 及后续修复承接。
- README 更新 Windows 开发入口、当前词库容量与生效边界、15 字短句分流，以及 GitLab 与 GitHub Actions 的实际关系。

## 冲突处理

保留 Windows `App.jsx` 中“设置文字服务 → 返回整理模板”的上下文导航。模板编辑器、深拷贝、Unicode 字数校验、样例请求和缺项策略采用 v2；继续保留 Windows 短句改口分流、普通智能整理提示词、词库冻结和部分结果恢复逻辑。测试使用最后一条用户消息定位本次素材，避免把参考样例当作当前输入；界面资源摘要依据合并后的实际源码重新生成。

## 本次实际执行

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 模板、流水线和质量针对性测试 | 104 通过，0 失败 | 包含于全量前端测试 |
| 全量 JavaScript 测试 | 307 通过，4 跳过，0 失败 | [日志](frontend-tests.txt) |
| Rust 库测试（当前 Mac 主机） | 95 通过，0 失败 | [日志](native-host-tests.txt) |
| 前端生产构建 | 通过 | [日志](frontend-build.txt) |
| 生产字体、色板与资源摘要校验 | 通过 | [日志](appearance-check.txt) |
| `cargo fmt --check` 与 Git 空白检查 | 通过 | 提交前执行 |
| Windows x64 原生模块类型检查 | 通过 | [日志](windows-modules-check.txt) |
| 生产构建浏览器巡检 | 模板 v2 字段和设置往返草稿保留通过 | [结构化记录](summary.json) |

4 项跳过需要 Windows PowerShell 或 Credential Manager。Windows 类型检查使用当前 Windows worktree 的真实模板、词库、纠正观察、UIA、输入投递、历史和后台状态机源码；仅 `debug_log` 为编译边界空函数，模板的原子保存使用实际产品实现。模块检查存在隔离环境下历史加密函数导出未使用的警告。

浏览器巡检通过编辑临时草稿和一组输入输出样例，验证跳转设置后返回的字段值；最后显式取消草稿，未保存测试模板，也未调用文字服务。浏览器结果不代表 Windows 桌面原生行为。

## 重现命令

在 Windows worktree 根目录执行：

```bash
npm run test:unit
npm run build
npm run verify:appearance
cargo test --offline --locked --lib --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

Windows 模块检查使用 [Cargo.toml](windows-check/Cargo.toml)、[依赖快照](windows-check/Cargo.lock) 和 [实际源码入口](windows-check/lib.rs)。入口记录了本机 Windows worktree 的绝对路径；其他机器需先调整这些路径。

```bash
cargo check --offline --locked --lib --target x86_64-pc-windows-msvc \
  --manifest-path docs/verification/windows-integration-2026-10-22/windows-check/Cargo.toml
```

## 验证范围

本机没有 Windows 电脑、虚拟机或可运行的专有 ASR 服务地址。本次没有生成或运行 Windows EXE/MSI，没有实际执行 WASAPI 录音、跨应用 UIA/粘贴或完整 ASR 上屏链路。整合继续沿用 Windows 专有 ASR 配置和已有文字模型；实际平台验收按 [Windows 清单](../../windows-acceptance.md) 执行。

来源提交、逐项结果和产品文件 SHA-256 见 [summary.json](summary.json)。此前模板与模型实测保留在 [原模板报告](../skill-v2-2026-10-20/report.md)，本次未重复进行外部模型调用。
