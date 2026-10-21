# WithType

本机正式维护目录：`/Users/outsider/codex_projects/emergence-lab/projects/15-withtype`。原先移入废纸篓的源码已逐项恢复、合并，独有原始版本保存在项目内；详见 [源码恢复记录](docs/source-recovery-2026-10-13.md) 和 [恢复档案](recovery/2026-10-13/README.md)。改名与兼容策略见 [版本整理记录](docs/withtype-consolidation.md)。

基于 [Typefree](https://github.com/kdsz001/typefree) 的语音处理与词汇学习行为，结合本机 `vibevoice-windows` 的快捷键、墨珠动效和 Windows 构建方式。ASR 使用用户选定的通用 OpenAI 兼容 WAV 接口，文字服务自行配置。当前为源码开发版，目标程序名为 `withtype.exe`，尚未完成 Windows 实机验收。

## 进入动画与欢迎语

正式主窗口采用已确认的 3.6 秒墨珠落纸、湿墨成字与界面展开动画。「外观」可自定义整句欢迎语，例如 `Welcome，outsider`，自动保存在本机；更换文字保留相同动作与镜头。支持跳过、减少动态和隐藏/最小化后经应用入口重播。

[动画对照](docs/design/app-opening-2026-10-12/preview.html?version=ink-welcome) 保留 A/B/C 历史版本；当前 C 与正式入口共用绘制器。实现、许可和验证范围见 [正式入口接入](docs/design/app-opening-2026-10-12/production-integration.md)。本轮按用户要求暂不做 Windows 实机验证，不把本机代码测试和构建称为 Windows 一比一验收。

## 交互与语音动效

采用切换式交互：**按一次快捷键开始说话，再按同一个键结束并处理**。主语音输入键也可结束任意入口正在进行的录音；其他入口只结束自己启动的录音。录音/处理期间可按 Esc 取消，也可使用托盘或 HUD；关闭设置窗口后仍保留托盘运行。没有原版 Typefree 的全局鼠标长按、拖动锁定或拖远取消。

| 快捷键 | 默认动作 |
| --- | --- |
| `Ctrl+Alt+Space` | 语音输入 |
| `Ctrl+Alt+Shift+Space` | 随便问，回答只显示在卡片 |
| `Ctrl+Alt+Shift+T` | 翻译，也可改成技能或语音命令 |
| `Ctrl+Alt+V` | 复制上次完成结果，可自定义 |

在「快捷键」页点击按键位后按新组合键即可修改。「快捷短语」可保存一段常用号码或文字，并绑定独立快捷键；正文按原样输入，不调用模型、不写入历史。HUD 使用本机参考项目最新的 **D「墨珠」**：140 × 64，单色墨珠，静音收点，处理时五珠轻跃，完成时落墨稍展，失败时退为空珠；短时电平驱动录音反馈，尊重减少动态效果设置。

后台输入增加 Rust 原生就绪检查与有界恢复：页面失联时重载/重建，睡眠或锁屏时中断旧任务并保留录音，唤醒后恢复入口。登录启动在已配置时静默进入托盘，尊重任务管理器禁用启动项；托盘可手动「恢复语音输入」。已通过逻辑测试和平台类型检查，Windows 长时间闲置与故障恢复仍待实机验收。行为、边界和验收矩阵见 [后台可用性说明](docs/background-availability.md)。

问答与投递结果共用卡片定位：优先放在当前文字光标下方，空间不足时放上方；未取得光标时，在鼠标所在显示器的工作区底部居中。按对应屏幕 DPI 计算并限制在工作区内，避开任务栏。同一张卡片在流式更新期间保持位置，正文在卡片内部滚动。

开始录音时记录预期输入框，自动输入前复核窗口、控件、可读正文与可获取的选区。没有有效目标、目标变化或无法确认输入时，保留完整正文并显示结果卡片；不会把发送 Ctrl+V 直接称为“已输入”。无法复制时也保留卡片和历史，可再次点击复制。重试、保留原文和历史重新转写只生成/复制结果；点击卡片的“3秒后输入”后，切到需要的输入框，倒计时结束再检测目标。手动重新输入不会启动自动词汇学习。

最终正文默认保留在系统剪贴板，不再延迟恢复旧内容。处理期间用户另行复制的新内容优先保留，语音正文改由卡片取回。最近完成结果独立保存在历史中，开始新录音、失败或取消不会清空上一份结果；重启后从历史恢复，可用快捷键或托盘重新复制。随便问的回答不会自动改写剪贴板。原生录音上限为 15 分钟，HUD 在最后一分钟显示倒计时。实现和 Windows 验收项见 [交互优化说明](docs/interaction-optimization.md)。

## 色彩与字体

按用户指定的本机 Type 最新版同步奶白、灰绿色色板和随包 Noto Sans SC Sans2.004 可变字体。主工作区为 `#f8f9f4`，面板为 `#fcfcf9`，侧栏为 `#efefe9`，主文字为 `#282c27`。三个窗口固定浅色主题，HUD 外部画布保持透明；当前录音、投递和卡片定位交互保留。

字体离线加载，许可和版权纳入打包配置。执行 `npm run build` 后运行 `npm run verify:appearance`，检查生产字体、色板和源码指纹；构建自动生成 `appearance-baseline.json`，便于核对 Windows 包是否使用同一套视觉基准。准确色值、文字规格、截图及 Windows 复核范围见 [前端视觉基准](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/frontend-appearance-baseline.md)。

## 自动学习词汇

1. 普通口述自动输入后，在原输入框里纠正识别错误，例如「徐向」改成「徐翔」。停止编辑并保持焦点至少 4 秒。
2. 第一次只记为候选。同一纠正在另一次口述中再次出现后自动记住；候选 30 天未再次出现就失效。这与当前 Typefree 源码一致。
3. 下一次口述自动应用已学规则，不要求调用文字模型。「个人词库」可查看已学词和候选，也可删除；删除后不再自动学入该纠正。
4. 在无法自动读取的应用中，可进入「历史记录」点击「纠正并记住」。这个明确教学入口一次生效，也可以在个人词库直接编辑手动词典。

学习只观察本次粘贴的输入框和投递范围，最长 60 秒；切换焦点、取消、开始新口述或关闭学习开关会结束观察。密码框、不可读取控件、插入范围不明确、超长内容跳过。仅学习不超过 12 字的短术语，自动过滤数字变化、语义同音字、整句改写以及非近音变更。中文近音判断使用本地拼音转换。

手动词典优先；自动学习和历史教学最多保存 60 条规则。关闭自动学习会保留已学词；要停用某条规则可以删除它。自动学习仅针对普通口述自动粘贴，提问/翻译/生成内容和仅复制模式不会触发输入框观察。从识别成稿挖词与风格画像不在本次范围内；当前 Typefree 上游也默认关闭成稿挖词，避免强化错误。

输入框全文只用于内存中的范围定位；磁盘保存短词规则、候选与忽略记录，不保存观察到的输入框上下文。正式词库位于应用配置目录的 `vocabulary.json`，采用原子替换保存。Windows 历史使用 DPAPI 加密文件，旧 localStorage 历史在新文件写入并验证后迁移；浏览器预览仍使用 localStorage。历史可配置保留期限、显式导出；可选保留录音供重新转写。清空历史不会删除已学词。

## 模型配置

1. 「语音模型」填入 OpenAI 兼容 ASR 地址（到 `/v1`）、模型名称和 API Key。默认模型为 `Qwen/Qwen3-ASR-1.7B`，地址留空。
2. 「文字模型」独立配置 `/v1/chat/completions` 服务、主模型、可选快速/备用模型及密钥。普通智能整理、翻译和意图判断优先使用快速模型；技能与问答使用主模型。快速模型留空则使用主模型。
3. 「文字整理」选择原文、术语纠错、轻度整理、智能整理或技能。新安装默认智能整理：有效字符 ≤10 的短句直出并去掉末尾句号；长句使用文字服务。已有配置按迁移规则保留。

Windows 正式录音使用 Rust/CPAL 的 WASAPI 共享采集，连续重采样到 16 kHz 单声道 PCM，约每 2 秒寻找停顿并串行提交完整 WAV 段；尾段在停止后处理，最终一次性上屏。失败音频以 Windows DPAPI 加密暂存，可重启恢复。浏览器预览使用 AudioWorklet。密钥保存在 Windows 凭据库，不写入设置文件。词库在最终成稿后再次纠正；通用 WAV 接口没有已确认的词汇上下文参数，因此未发送热词。输入框上下文不发送给模型。

长文本智能整理与翻译按句段边界拆分请求，完整覆盖原文；任何一段失败时，普通口述回退整条原文。需要全文规划的技能、命令与问答超出单次上限会明确提示分段运行，不静默裁尾。备用模型和分段共享文字阶段总等待预算；识别请求复用连接池。

「流式预览」默认开启，在概览显示成稿进展，完成后一次粘贴；兼容服务不支持流式时回退普通响应。「录音期间提前整理」默认关闭，开启后仅对普通智能整理提前处理稳定段，会增加文字请求；自动意图判断启用时不使用。开始时配置、段编号、未定尾段与原文始终保留，缓存失配或翻译口令会使其失效。整理段之间只使用最多 500 个 UTF-16 单元的录音前文作为衔接参考。

历史耗时改为停止录音后的实际墙钟等待，并保留识别就绪、分类、文字阶段、首字、投递与请求数量等指标；不把录音期间的 ASR 时间再加进停止后的总等待。实现与验证范围见 [长文优化说明](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/long-text-optimization.md)。

普通口述开头或末尾可以说「用英文 / 日文 / 韩文 / 中文 / 法文 / 德文 / 西班牙文」翻译本次正文。普通口述的文字处理失败时自动输入识别原文并提示原因；提问与语音命令失败时不会把指令句输入到目标窗口。提问卡片支持流式回答与多轮追问；不支持流式的兼容服务回退普通响应。

「整理模板」页提供邮件、工作汇报、会议纪要、开发需求和润色五个内置模板。润色保留原意与语气，优化措辞和行文，输出自然正文。可直接按所选模板录音，结果显示为卡片，不改变普通语音输入和第三个入口的设置；也可分别设为普通口述的默认模板或第三个快捷键的动作。

## Windows 本机构建（参考 vibevoice-windows）

准备 Node.js 22、Rust、MSYS2 的 `mingw-w64-x86_64-toolchain`、WebView2 Runtime。使用 **Windows 的 MSYS2 / Git Bash**：

```bash
rustup toolchain install stable-x86_64-pc-windows-gnu
# 默认自动寻找 mingw64；自定义安装目录时指定：
WITHTYPE_MINGW_DIR=/c/msys64/mingw64/bin ./build-local.sh
```

脚本使用 GNU Rust、同一目录下的 gcc/ar/dlltool/windres 与 `-pipe`，先运行测试，再构建，不包含参考仓库里的个人用户名路径。此脚本不是 macOS 交叉编译脚本。

GNU 主程序在 `src-tauri/target/x86_64-pc-windows-gnu/release/withtype.exe`；安装包在该目录的 `bundle/` 下。便携压缩包在 `dist/windows/withtype-windows-x64-portable.zip`，校验文件为同名 `.sha256`。解压后保留整个文件夹，需要系统已安装 WebView2 Runtime。

## Windows MSVC 与 CI

安装 Visual Studio C++ Build Tools、Windows SDK、Node.js 22、Rust stable 与 WebView2 后，在项目根目录执行：

```powershell
npm ci
npm test
cargo test --manifest-path src-tauri/Cargo.toml --lib
npm run desktop:build
./scripts/package-windows.ps1 -ReleaseDir src-tauri/target/release
```

主程序位于 `src-tauri/target/release/withtype.exe`，NSIS/MSI 位于 `release/bundle/`。打包脚本核验 x64 PE 格式、EXE/DLL 类型与压缩包校验和。

`.github/workflows/build-windows.yml` 保留 Windows MSVC 构建、JS/Rust 测试和产物上传。**当本项目目录成为独立仓库根目录时**可直接启用；当前在 Emergence Lab 子目录下，GitHub 不会自动发现嵌套工作流。没有擅自创建远程仓库或发布产物。

## 当前验证范围

```bash
npm test
npm run build
npm run verify:appearance
cargo test --manifest-path src-tauri/Cargo.toml --offline --lib
cargo check --manifest-path src-tauri/Cargo.toml --offline
```

当前 Mac 已验证 JS/Rust 逻辑与前端构建；WASAPI 音频、DPAPI 历史、登录启动、输入投递/UIA 模块分别做了 Windows x64 目标类型检查。**这不等于 Windows EXE 运行验证，当前尚无已构建验收的 EXE。** 本机缺少完整 Windows C/C++ SDK，不能完成整个 Tauri 应用的 Windows 链接。使用 Windows 虚拟机或 Windows 构建机，按 [Windows 验收说明](docs/windows-acceptance.md) 和 [交互验收清单](docs/interaction-optimization.md) 完成快捷键、麦克风、分段识别、跨应用粘贴、多屏卡片、重启恢复及词汇学习实测。

逐项状态与已知缺口见 [目标完成度检查](docs/goal-audit.md)。原生取消与登录启动已有源码路径，仍需 Windows 设备和服务实测；不能将当前源码视为全部验收完成。

## 来源与许可

词汇提取和近音过滤移植自 Typefree 固定版本 `9d16762c52906f054285b630935017a431e9e627`，保留 GPL-3.0 许可与来源说明；基础桌面实现和墨珠动效来自用户提供的本机 `vibevoice-windows`。详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)、[research.md](research.md)。WithType 是独立项目；未使用原版图标或官网素材，保留第三方来源与许可说明。

### 自定义整理模板

在「整理模板」中新建，填写名称和整理要求即可；适用场景与参考样例选填。每个模板可选择省略空栏目或标为待确认，并添加最多 3 组会参与生成的输入输出样例。试用结果可以修改后加入草稿，保存模板后生效；修改配置或试用文字后需重新试用。

旧模板迁移保留原来的缺项行为；新建模板默认省略空栏目。试用与正式模板任务使用同一套请求规则。浏览器预览只模拟交互，真实模型调用在桌面端或模型验证脚本中完成。

验证：`npm run test:skills`；完整结果、模型测试命令与人工验收步骤见 [Skill v2 测试报告](docs/verification/skill-v2-2026-10-20/report.md)。
