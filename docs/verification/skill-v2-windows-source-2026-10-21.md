# Windows 推送前源码复查

日期：2026-10-21，Asia/Shanghai。

本次提交从 `6b8b860f898e2fa5652d141a06b00de753c77221` 提取模板功能及其必要依赖，保留已有 Windows 构建配置。Mac ASR、Mac 打包、启动与其他尚未提交的改动留在原工作区。本报告验证的是待提交的独立源码快照；10 月 20 日完整工作区的测试数字见[原报告](skill-v2-2026-10-20/report.md)，二者不能混算。

## 提交内容

- 模板 v2 数据结构、执行样例、独立缺项策略、旧数据迁移、内容修订。
- 编辑器的样例管理、试用结果编辑与显式保存、过期试用保护、窗口内草稿会话。
- 试用和正式任务共用消息组装，录音开始冻结模板与嵌套样例。
- 五个内置模板（包含润色）、测试、模型检查脚本和原始验证记录。
- App 仅接入编辑会话状态与文字服务设置入口；其余 UI 重构未混入。构建资源摘要从该快照重新生成。

## 在独立源码快照实际执行

| 检查 | 结果 |
| --- | --- |
| `npm run test:unit` | 254 通过、2 跳过、0 失败 |
| `npm run test:skills` | 40 通过、0 失败（属于全量测试的子集） |
| `cargo test --offline --locked --lib --manifest-path src-tauri/Cargo.toml` | macOS 主机执行，65 通过、0 失败 |
| `npm run build` | 通过；存在既有单包体积提示 |
| `npm run verify:appearance` | 通过，字体校验与 16 个颜色变量一致 |

[JavaScript 日志](skill-v2-windows-source-2026-10-21-unit.log)、[Rust 日志](skill-v2-windows-source-2026-10-21-rust.log)。Rust 复查复用了本机依赖缓存；首次命中其他工作区的旧构建脚本后，刷新快照源文件时间戳并重跑，以上结果取自完整成功的重跑。

本机未生成或运行这次提交的 Windows EXE／MSI。Windows 原生行为与真实模型效果仍需按[原报告](skill-v2-2026-10-20/report.md)验收。本次检查没有发起模型调用。

## 推送与 Windows 构建

当前分支 `main`，远程 `origin` 是公司 GitLab 的 `2507215232/type.git`。本次只创建本地提交，未推送。

```bash
git push origin main
```

普通推送不会触发仓库里的 `.github/workflows/build-windows.yml`；仓库未提供 `.gitlab-ci.yml`。在 Windows 的 MSVC 环境拉取后可执行：

```powershell
npm ci
npm test
cargo test --manifest-path src-tauri/Cargo.toml --lib
npm run desktop:build
./scripts/package-windows.ps1 -ReleaseDir src-tauri/target/release
```
