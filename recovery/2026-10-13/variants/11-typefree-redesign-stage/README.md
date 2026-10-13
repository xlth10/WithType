# Typefree Windows（非官方开发版）

基于 [Typefree](https://github.com/kdsz001/typefree) 的语音处理与词汇学习行为，结合本机 `vibevoice-windows` 的快捷键、墨珠动效和 Windows 构建方式。ASR 使用用户选定的通用 OpenAI 兼容 WAV 接口，文字服务自行配置。当前为源码开发版，目标程序名为 `typefree.exe`，尚未完成 Windows 实机验收。

## 交互与语音动效

采用 `vibevoice-windows` 的切换式交互：**按一次快捷键开始说话，再按同一个键结束并处理**。录音过程中按另一个入口不会结束当前录音。托盘和 HUD 可结束或取消；关闭设置窗口后仍保留托盘运行。没有原版 Typefree 的全局鼠标长按、拖动锁定或拖远取消。

| 快捷键 | 默认动作 |
| --- | --- |
| `Ctrl+Alt+Space` | 语音输入 |
| `Ctrl+Alt+Shift+Space` | 随便问，回答只显示在卡片 |
| `Ctrl+Alt+Shift+T` | 翻译，也可改成技能或语音命令 |

在「快捷键」页点击按键位后按新组合键即可修改。HUD 使用本机参考项目最新的 **D「墨珠」**：可见区域 176 × 54 逻辑像素（196 × 74 窗口含阴影留白），单色，静音收点，55 ms 短时电平驱动，两侧始终低于中央，无彩色长尾；处理阶段缓慢变化，尊重减少动态效果设置。

## 技能的使用方式

技能是把口述整理成固定写法的规则。内置邮件、工作汇报、会议纪要、开发需求四个场景，各有适用说明、口述提示和静态输出示例。

- **用一次**：在技能页点击「用这个技能说一段」，再次点击或使用 HUD 结束。结果先在卡片查看，不改变快捷键或日常模式。
- **动作快捷键**：在「常用入口与整理规则」绑定技能；可选择输入光标处或先在卡片查看。原有配置保持输入方式。
- **日常口述**：设为日常口述写法后，普通语音输入持续按该技能整理；点击已绑定的入口恢复智能整理，也可在「文字整理」切换。
- **试用与调整**：文字试用调用当前文字模型，不输入到任何窗口、不写历史。可复制内置技能调整，也可创建自定义技能。

技能页直接录音和动作快捷键均需语音模型与文字模型。技能只处理提供的内容，没有联网、文件读取或执行系统操作能力。删除自定义技能会安全恢复相关绑定。

主界面、HUD 和结果卡片共用墨色、纸色、圆角与本地字体。HUD 在录音开始时确定显示器，在识别与处理过程中保留；位置依据显示器工作区计算，避开任务栏。回答卡片初始 460 × 520，可拖动、缩放；Esc 关闭，回答中关闭会取消请求。详见 [本轮界面与技能说明](docs/design/windows-ui-skills-2026-10-10.md)。

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
2. 「文字模型」独立配置 `/v1/chat/completions` 服务、主模型、可选快速/备用模型及密钥。智能整理、技能、提问和翻译需要它。
3. 「文字整理」选择原文、术语纠错、轻度整理、智能整理或技能。新安装默认智能整理：有效字符 ≤10 的短句直出并去掉末尾句号；长句使用文字服务。已有配置按迁移规则保留。

Windows 正式录音使用 Rust/CPAL 的 WASAPI 共享采集，连续重采样到 16 kHz 单声道 PCM，约每 2 秒寻找停顿并串行提交完整 WAV 段；尾段在停止后处理，最终一次性上屏。失败音频以 Windows DPAPI 加密暂存，可重启恢复。浏览器预览使用 AudioWorklet。密钥保存在 Windows 凭据库，不写入设置文件。词库在最终成稿后再次纠正；通用 WAV 接口没有已确认的词汇上下文参数，因此未发送热词。输入框上下文不发送给模型。

普通口述开头或末尾可以说「用英文 / 日文 / 韩文 / 中文 / 法文 / 德文 / 西班牙文」翻译本次正文。普通口述的文字处理失败时自动输入识别原文并提示原因；提问与语音命令失败时不会把指令句输入到目标窗口。提问卡片支持流式回答与多轮追问；不支持流式的兼容服务回退普通响应。

## Windows 本机构建（参考 vibevoice-windows）

准备 Node.js 22、Rust、MSYS2 的 `mingw-w64-x86_64-toolchain`、WebView2 Runtime。使用 **Windows 的 MSYS2 / Git Bash**：

```bash
rustup toolchain install stable-x86_64-pc-windows-gnu
# 默认自动寻找 mingw64；自定义安装目录时指定：
TYPEFREE_MINGW_DIR=/c/msys64/mingw64/bin ./build-local.sh
```

脚本使用 GNU Rust、同一目录下的 gcc/ar/dlltool/windres 与 `-pipe`，先运行测试，再构建，不包含参考仓库里的个人用户名路径。此脚本不是 macOS 交叉编译脚本。

GNU 主程序在 `src-tauri/target/x86_64-pc-windows-gnu/release/typefree.exe`；安装包在该目录的 `bundle/` 下。便携压缩包在 `dist/windows/typefree-windows-x64-portable.zip`，校验文件为同名 `.sha256`。解压后保留整个文件夹，需要系统已安装 WebView2 Runtime。

## Windows MSVC 与 CI

安装 Visual Studio C++ Build Tools、Windows SDK、Node.js 22、Rust stable 与 WebView2 后，在项目根目录执行：

```powershell
npm ci
npm test
cargo test --manifest-path src-tauri/Cargo.toml --lib
npm run desktop:build
./scripts/package-windows.ps1 -ReleaseDir src-tauri/target/release
```

主程序位于 `src-tauri/target/release/typefree.exe`，NSIS/MSI 位于 `release/bundle/`。打包脚本核验 x64 PE 格式、EXE/DLL 类型与压缩包校验和。

`.github/workflows/build-windows.yml` 保留 Windows MSVC 构建、JS/Rust 测试和产物上传。本项目已成为独立仓库；GitHub 仓库可启用该工作流，GitLab 托管不会执行 `.github/workflows`。Windows 本机构建仍可使用上述命令。

## 当前验证范围

```bash
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --offline --lib
cargo check --manifest-path src-tauri/Cargo.toml --offline
```

当前 Mac 已验证 JS/Rust 逻辑与前端构建；WASAPI 音频模块、DPAPI 历史模块、登录启动模块分别做了 Windows x64 目标类型检查。**这不等于 Windows EXE 运行验证，当前尚无已构建验收的 EXE。** 本机缺少完整 Windows C/C++ SDK，不能完成整个 Tauri 应用的 Windows 链接。使用 Windows 虚拟机或 Windows 构建机，按 [Windows 验收说明](docs/windows-acceptance.md) 完成快捷键、麦克风、分段识别、跨应用粘贴、重启恢复及词汇学习实测。

逐项状态与已知缺口见 [目标完成度检查](docs/goal-audit.md)。原生取消与登录启动已有源码路径，仍需 Windows 设备和服务实测；不能将当前源码视为全部验收完成。

## 来源与许可

词汇提取和近音过滤移植自 Typefree 固定版本 `9d16762c52906f054285b630935017a431e9e627`，保留 GPL-3.0 许可与来源说明；基础桌面实现和墨珠动效来自用户提供的本机 `vibevoice-windows`。详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)、[research.md](research.md)。未使用原版图标或官网素材，界面标识为非官方版本。
