# 来源与许可

- `src/vocabulary/learning.js` 的纠正提取与近音判断移植自 [Typefree](https://github.com/kdsz001/typefree) 的 `HotWordsAutoLearner.swift` 与 `MishearingCheck.swift`，版本 `9d16762c52906f054285b630935017a431e9e627`。原作者 kdsz001 / Typefree contributors，遵循 [GNU GPL v3](LICENSES/Typefree-GPL-3.0.txt)；本项目修改同样按 GPL-3.0 提供。分发包含该派生代码的程序时必须遵守该许可的源码提供等要求。
- `src/text/builtinSkills.js` 的日常语音整理提示词改编自同一固定版本的 `AIPolisher.swift` 中 `cloudASRPolishPrompt`，同样遵循 GPL-3.0；增加的 Skill 和问答提示词属于此 Windows 实现。
- 基础 Tauri/React 实现与 `src/voice/motion.js` 的 D 墨珠算法来自用户提供的本机 `vibevoice-windows` 项目。未在该项目发现单独许可声明；外部分发前需确认其授权。
- `pinyin-pro`：zh-lx，MIT，负责本地拼音转换。其许可随 npm 包保留。
- 随包界面字体：Noto Sans SC Sans2.004，字体元数据保留 Adobe 2014–2021 版权及 Reserved Font Name 'Source'，采用 [SIL Open Font License 1.1](public/fonts/OFL-NotoSansSC.txt)，保留 [版权信息](public/fonts/COPYRIGHT-NotoSansSC.txt)。资源从用户指定的本机 Type 项目同步，为 WOFF2 容器转换，原始字形与字体元数据未修改；来源、文件大小与 SHA-256 见 [字体清单](public/fonts/manifest.json)。安装包与便携包的打包配置均纳入许可和版权文件。
- WithType 是独立的 Windows 实现，未使用 Typefree 原版图标或官网素材；原作名称仅用于来源与许可归属。


## OneTake 历史动画实验

`docs/design/app-opening-2026-10-12/onetake/motion.js` 是保留的实验依赖，来源 https://github.com/feitangyuan/onetake ，许可为 PolyForm Noncommercial 1.0.0，完整许可在同目录 `LICENSE`。历史 B、C1 和批准参考页使用它，正式应用入口不导入该文件；生产绘制器由本项目实现，其运动值使用标准数学方程。

Required Notice: Copyright (c) 2026 Patrick. onetake is free for noncommercial use only.
