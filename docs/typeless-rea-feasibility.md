# Typeless 本机安装包：REA 可分析性初步验证

核查日期：2026-10-10。本次只做本机安装包静态检查，范围为确认应用身份及 REA 的可分析性；没有完成上下文、语音识别或文本投递的功能追踪。

## 目标与身份

- 安装位置：`/Applications/Typeless.app`。
- Info.plist 标识：Typeless 2.8.1，build 2.8.1.130，bundle ID `now.typeless.desktop`。
- 包含 Electron helper、`Contents/Resources/app.asar`、主进程 JavaScript 及 preload。
- ASAR 大小：292,792,179 字节。
- 本机 ASAR SHA-256：`eb9bcc842478b12a7488d90778ad6b08e6788c8fa5e875782ec2af0387c6c80b`。

这些标识来自本地文件，不代表已核验该副本与厂商发布版本完全一致。

## 已执行及结果

1. REA `analyze_javascript_application` 直接读取 ASAR，返回 `artifact_integrity_mismatch`。首个报告对象为外置原生依赖 `node_modules/better-sqlite3/build/Release/better_sqlite3.node`：
   - 包内声明 SHA-256：`4c79e15889405bf635a16889b1f1c6945b4b2b65502919c8788ccc654c402bdd`。
   - 实际 SHA-256：`4c67d2910bdec92c967117f5e0497c87d925ccd6d6648c373c46a69ef5af8a9b`。
   - 这是校验器停止处，不能据此断言只有这一个文件不匹配。
2. `codesign --verify --deep --strict --verbose=2` 返回 `invalid signature (code or signature have been modified)`，architecture arm64。未查明原因，不能单凭此结果推断恶意修改。
3. 为开展独立的局部静态分析，只从 ASAR 提取 package.json、dist/main 与 dist/preload 中的五个打包文件，逐一核对其字节 SHA-256 与本地 ASAR member hash；均匹配。原生依赖和 renderer 不在该子集内。本地 member hash 相符不等于发布者真实性已验证。
4. 对上述五文件子集的 REA 返回超出工具传输上限（约 355 MB）；未获得可读取的完整结果，因此不把这一操作记为分析成功。
5. 将范围缩到单个原始 preload 文件后，REA 成功返回 JavaScript Application Graph。原文件为 `dist/preload/index.mjs`，11,362 字节，SHA-256 `0a26b48f21bf9d4c81615601f702db32a81e418c5a80690260b021774c770399`。

局部分析 Evidence ID：`ev_a9b5ff555fcb8e4d9c915d0f1efc39e2943e8caa433d21a8dc3ec8f8de0bebb4`。
完整工具 Evidence 临时保存于 `/private/tmp/typeless-rea-preload-evidence-20261010.json`；该文件是临时研究材料，可能被系统清理。

## 局部证据能说明什么

REA 图包含一个 JavaScript asset、三个 module 节点、两个 IPC channel、两个 IPC handler，共八条边。preload 存在 Electron IPC 包装代码；但这两个 channel 的表达式均被工具标记为 dynamic，无法静态配对。

原始代码有字符串表和 `_0x...` 形式的名称混淆。REA 明确将 AST coverage 标为不完整；执行可达性、动态属性取值、真正的 channel 名称及上下文数据来源仍未知。这不是“Typeless 没有某功能”的证据。

## 可行性结论与下一步边界

**已回答：** REA 可以用于分析该本机应用，Electron JavaScript 路径已有一次实际成功的局部静态分析。

**部分回答：** 原始完整 ASAR 的分析受哈希校验问题阻挡；较大 JavaScript 子集还有结果体积限制，需要缩小问题和模块范围，或采用将结果直接落盘的 CLI 路径。

**尚未回答：** Typeless 如何获取选区/剪贴板/当前应用、哪些上下文进入请求、语音识别与文本处理的本地/服务端分工，以及如何向输入框投递。后续应分别追踪调用链，不从字符串或依赖名称直接推断实际功能。服务端实现不能由客户端包完整恢复。

依据：[REA skill](/Users/outsider/.agents/skills/reverse-engineer-anything/SKILL.md)、本机 Info.plist / ASAR、上述 REA Evidence 与 codesign 输出。

