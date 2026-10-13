# WithType 正式版本整理

整理日期：2026-10-13。

用户指定本会话原目录为正式版本。保留项目编号 15，正式名称为 **WithType**，正式目录为 `/Users/outsider/codex_projects/emergence-lab/projects/15-withtype`。
原目录 `/Users/outsider/codex_projects/emergence-lab/projects/15-typefree-windows` 已更名；原有源码、未提交修改、研究记录、资源和依赖随目录一并保留，282 个项目文件在移动前后通过 SHA-256 核对。

## 名称与兼容

应用界面、窗口、托盘、前端包和 Rust 包使用 WithType 名称；Windows 主程序为 `withtype.exe`，便携包为 `withtype-windows-x64-portable.zip`。
应用标识、凭据库服务名、localStorage 键及登录启动注册表值保留原值，以继续读取旧设置、密钥、历史与词库，并尊重已有的系统启动禁用状态。Windows 部分仍待实机验证。
Typefree 上游名称、许可证文件和历史调研证据保留来源归属，截图与原始机器证据不回写成新名称。

## 旧版本清理

共 21 个旧源码、原型及临时构建目录从原位置移出，集中放入废纸篓 `/Users/outsider/.Trash/WithType-old-versions-20261013-110344`。
`SEVB/Type` 包含独立 Git 历史及未提交改动，整个目录保留在废纸篓中；没有向正式版本合入该副本的功能。
同一副本的 Vite 预览服务已停止。恢复映射见 [withtype-consolidation.json](withtype-consolidation.json)，废纸篓内也保存 `RESTORE-MANIFEST.json`；如需找回，可从废纸篓复制对应目录。

| 原位置 | 废纸篓内目录 |
| --- | --- |
| `/Users/outsider/SEVB/Type` | `01-Type` |
| `/Users/outsider/temp/15-vibevoice-input-method` | `02-15-vibevoice-input-method` |
| `/private/tmp/typefree-background-platform-check` | `03-typefree-background-platform-check` |
| `/private/tmp/typefree-copy` | `04-typefree-copy` |
| `/private/tmp/typefree-desktop-stage` | `05-typefree-desktop-stage` |
| `/private/tmp/typefree-hud-fix` | `06-typefree-hud-fix` |
| `/private/tmp/typefree-icon-v3` | `07-typefree-icon-v3` |
| `/private/tmp/typefree-interaction-check` | `08-typefree-interaction-check` |
| `/private/tmp/typefree-layout-review` | `09-typefree-layout-review` |
| `/private/tmp/typefree-native-latency-check` | `10-typefree-native-latency-check` |
| `/private/tmp/typefree-redesign-stage` | `11-typefree-redesign-stage` |
| `/private/tmp/typefree-redesign-target` | `12-typefree-redesign-target` |
| `/private/tmp/typefree-refine-stage` | `13-typefree-refine-stage` |
| `/private/tmp/typefree-ui-fix` | `14-typefree-ui-fix` |
| `/private/tmp/withtype-ink-welcome-stage` | `15-withtype-ink-welcome-stage` |
| `/private/tmp/withtype-ink-welcome-v2-stage` | `16-withtype-ink-welcome-v2-stage` |
| `/private/tmp/withtype-motion-stage` | `17-withtype-motion-stage` |
| `/private/tmp/withtype-onetake-stage` | `18-withtype-onetake-stage` |
| `/private/tmp/withtype-phrase-cargo` | `19-withtype-phrase-cargo` |
| `/private/tmp/withtype-round-bead-2026-10-13` | `20-withtype-round-bead-2026-10-13` |
| `/private/tmp/withtype-welcome-settings` | `21-withtype-welcome-settings` |

安装的第三方 Typefree/Typeless 应用、研究截图、验证日志及用户历史数据不属于本项目的源码副本，保留作为来源、证据或数据。
本次只更新项目本地 metadata 和文档；共享公开索引当前未登记项目 15，本次没有增加公开展示记录。

## 验证

- 前端测试：173 项通过。
- Rust 测试：37 项通过；离线锁定依赖的 `cargo check` 通过。
- 前端生产构建和字体、色板、构建指纹校验通过。
- 原有项目文件在目录更名前后核对一致；仅此前明确修改的命名与文档发生变化。
- Windows 安装包构建与运行未在这台 Mac 上执行。

共享作品集索引的附加检查未通过：既有项目 10 指向不存在的 `projects/10-sunwoda-public-opinion-monitor/project.json`。该索引及项目目录均未由本次任务修改；此问题已记入本项目的本地维护日志。
