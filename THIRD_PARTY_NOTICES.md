# 来源与许可

- `src/vocabulary/learning.js` 的纠正提取与近音判断移植自 [Typefree](https://github.com/kdsz001/typefree) 的 `HotWordsAutoLearner.swift` 与 `MishearingCheck.swift`，版本 `9d16762c52906f054285b630935017a431e9e627`。原作者 kdsz001 / Typefree contributors，遵循 [GNU GPL v3](LICENSES/Typefree-GPL-3.0.txt)；本项目修改同样按 GPL-3.0 提供。分发包含该派生代码的程序时必须遵守该许可的源码提供等要求。
- `src/text/builtinSkills.js` 的日常语音整理提示词改编自同一固定版本的 `AIPolisher.swift` 中 `cloudASRPolishPrompt`，同样遵循 GPL-3.0；增加的 Skill 和问答提示词属于此 Windows 实现。
- 基础 Tauri/React 实现与 `src/voice/motion.js` 的 D 墨珠算法来自用户提供的本机 `vibevoice-windows` 项目。未在该项目发现单独许可声明；外部分发前需确认其授权。
- `pinyin-pro`：zh-lx，MIT，负责本地拼音转换。其许可随 npm 包保留。
- 未使用 Typefree 原版图标或官网素材；界面明确标识非官方 Windows 实现。

- 界面字体使用 [Noto Sans SC](https://github.com/notofonts/noto-cjk)，固定 `Sans2.004` 中的 `NotoSansSC-VF.ttf`，转换为 WOFF2 容器，保留全部字形与原元数据；遵循 [SIL Open Font License 1.1](public/fonts/OFL-NotoSansSC.txt)。版权声明见 [COPYRIGHT-NotoSansSC.txt](public/fonts/COPYRIGHT-NotoSansSC.txt)，来源与 SHA-256 见 `public/fonts/manifest.json`。字体原作者归属保留，不作为本项目原创素材。
