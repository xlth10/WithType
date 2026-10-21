# 词库重新测试 · 2026-10-21

- 本轮实际执行，两端前端各 303 项：299 通过、0 失败、4 跳过。跳过项均依赖 Windows PowerShell，部分还需 Windows Credential Manager。
- Mac 原生库 89 通过、0 失败。
- 17 个共享源码文件：与原清单和两个分支均一致。工作树均干净。
- Mac App 主二进制及 ZIP 哈希匹配原清单；App codesign 深度严格校验退出码 0。
- Windows 相关模块隔离交叉类型检查：退出码 0，31.16 秒，只有一个 unused_imports 警告。包含词库、UIA、投递、监控、历史和 Tauri 命令；日志/原子存储边界为编译替身。
- 没有运行 Windows 应用，没有调用专有 ASR，没有访问个人词库/历史/凭据，没有修改产品代码。
- 完整 Windows 构建和运行仍未验收；此次未重复缺少 Windows SDK 的完整交叉构建。

完整新日志与源码/制品指纹核对见本目录的 .txt/.json 文件。
