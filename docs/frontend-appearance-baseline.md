# 前端色彩与字体基准

核对日期：2026-10-12。用户指定以本机 `/Users/outsider/SEVB/Type` 最新版本为视觉基准，同步色彩和字体，保留当前交互。本次只读参考该目录，并修改当前 Windows 项目。

## 已确认的差异与处理

此前 Windows 项目沿用 `vibevoice-windows` 的纯白、暖灰色板；本机 Type 已使用奶白、灰绿色色板。两套源码本身不同，因此首先统一源码基准。此前 Windows 项目虽然声明了 Inter，但没有随包字体，也没有 `@font-face`；中文和标题最终依赖两套系统的字体回退。

本次同步当前组件适用的色彩、Noto Sans SC 字体和文字规格，同时明确 HTML、CSS 和三个原生窗口的浅色主题。主窗口、卡片和 HUD 的背景分别配置，HUD 外部画布保持透明。录音快捷键、插入/复制路径、卡片定位、窗口尺寸和布局结构继续采用当前实现。

未取得历史 Windows 安装包、截图和显示设置，无法认定旧色差的唯一根因，也不能把本次 Mac 浏览器验证等同于 Windows 实机验收。

## 当前准确色值

CSS 色值按 sRGB 解释。下表是源码和实际浏览器计算样式共同核对的基准；完整机器可读记录随前端构建生成于 [appearance-baseline.json](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/public/appearance-baseline.json)。

| 用途 | 当前值 | 原 Windows 项目值 |
| --- | --- | --- |
| 主工作区 | `#f8f9f4` | `#ffffff` |
| 面板/输入框 `--surface` | `#fcfcf9` | `#ffffff` |
| 侧栏 `--sidebar` | `#efefe9` | `#f7f7f5` |
| 主文字 `--ink` | `#282c27` | `#202020` |
| 次要文字 `--muted` | `#676b63` | `#787774` |
| 辅助文字 `--faint` | `#686e62` | `#9b9a97` |
| 常规边框 `--line` | `#e5e6de` | `#e9e9e7` |
| 较强边框 `--line-strong` | `#d3d6cb` | `#d8d8d5` |
| 悬停 `--hover` | `#e7e9df` | `#efefed` |
| 选中 `--selected` | `#dfe3d7` | `#e8e8e5` |
| 成功状态 `--success` | `#2f7d55` | `#2f7d55` |

| 组件 | 色值 |
| --- | --- |
| 概览主卡片 | `#f0f2e9` |
| 回答/投递卡片及原生窗口 | `#fcfcf8` |
| 卡片标题区 | `#f1f4eb` |
| 问题区域 | `#ecefe5` |
| 追问区域 | `#f0f3e9` |
| 流式预览区域 | `#f4f6ef` |
| HUD 实体背景 | `#fafbf6` |
| HUD 外部 HTML/body/root 画布 | `rgba(0, 0, 0, 0)` |
| HUD 墨珠主色/辅助色 | `#41433f` / `#777a74` |
| HUD 动效纸色常量 | `#fbfbfa` |
| 滚动条 | `#c5cabd` |
| 键盘焦点轮廓 | `#56614b` |

顶栏为 `rgba(248,249,244,.96)`，带 12 px 背景模糊。其计算样式是带透明度的颜色，最终像素会与下方内容合成。状态提示的成功绿、错误红、深色 toast 等采用参考版对应的组件色。

## 字体与排版

使用参考版同一份 **Noto Sans SC Sans2.004 可变字体**，CSS 别名为 `WithType UI`，支持 100–900 字重，共 31,036 个字形。文件为 WOFF2，7,779,480 字节；从应用本地资源加载，离线可用。字体文件、版权和 SIL OFL 1.1 许可均保留在 [public/fonts](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/public/fonts/README.md)，便携包和安装包打包配置同时包含许可。

```text
WOFF2 SHA-256:
a5822f9d6ef83d113dd94741221c16ba7a321f63033a02bd164968188995d547

字体顺序:
"WithType UI", "Segoe UI", "Microsoft YaHei UI", sans-serif
```

| 文字角色 | 当前规格 |
| --- | --- |
| 根文字/输入框 | 14 px，根行高 1.5 |
| 页面标题 | 32 px，字重 650，行高 1.3 |
| 概览主卡片标题 | 28 px，字重 650 |
| 导航 | 14 px |
| 普通按钮 | 13 px，字重 600 |
| 回答正文 | 14 px，行高 1.85 |
| 卡片标题/辅助信息 | 15 px / 13 px |

标题、快捷键、指令文本和表单控件都使用该字体；`font-synthesis: none` 避免合成粗体。HTML 预加载字体，`font-display: swap` 保持启动时文字可读。缺失字形仍可能回退系统字体。

## 跨平台约束

HTML 提前声明 `color-scheme: only light`，CSS 使用相同值，三个 Tauri 窗口均显式设为 `theme: Light`。原生主窗口背景为 `#f8f9f4`，回答窗口为 `#fcfcf8`，HUD 原生背景为完全透明。启动时根据窗口标签设置画布底色，防止三个窗口共用错误背景；HUD 的根节点取消 320 px 最小宽度，避免小浮窗产生横向溢出。

Tauri 未指定窗口主题时默认跟随系统；WebView2 的 Auto 配色也跟随系统。显式浅色配置可以减少系统深色模式和浏览器原生控件造成的差异。相关依据：[Tauri WindowConfig](https://v2.tauri.app/reference/config/#windowconfig)、[WebView2 PreferredColorScheme](https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2profile.preferredcolorscheme)、[CSS color-scheme](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/color-scheme)。已同时核对本项目锁定的 Tauri 2.11.6 / Wry 0.55.1 本地实现。

系统强制高对比模式继续生效。相同色值和字形文件也不保证 Mac/Windows 截图像素相同：字体光栅化、DPI、显示器色彩配置、HDR 和护眼设置仍会影响最终观感。

## 本次验证与证据

- Mac 浏览器主窗口 1060 × 720、最小窗口 860 × 620、模型表单和快捷键页：实际加载随包字体，未出现横向溢出。
- 420 × 320 的投递卡片与问答卡片：正文、追问框和底部操作可见；投递卡片底部为 311 px，处于视口内。
- HUD：HTML/body/root 的计算背景均为完全透明，实体背景为 `rgb(250,251,246)`。检查工具把 176 × 54 请求限制为 240 × 160；截图只证明浏览器预览和背景配置，原生 176 × 54 仍需 Windows 验收。
- 生产构建、字体/许可字节校验、13 个色板 token、字体预加载、浅色声明和源码指纹一致性检查通过。163 项 JS 测试通过；Mac `cargo check --offline` 通过。
- 未运行 Windows EXE，也未在 Windows/PowerShell 中执行本次便携包脚本。现有 Vite 大包提示及 Rust 警告仍存在。

实际计算样式见 [computed-styles.json](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/appearance-evidence/computed-styles.json)，生产资源验证见 [build-verification.json](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/appearance-evidence/build-verification.json)。截图为 JPEG，准确色值以计算样式及源码为准。

![主界面](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/appearance-evidence/main-1060.jpg)

![问答卡片](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/appearance-evidence/ask-420.jpg)

## Windows 复核顺序

1. 使用本次源码重新构建，运行 `npm run verify:appearance`；核对便携包内 `appearance-baseline.json` 与本次基准的字体哈希、色板和源码指纹，排除旧包混用。
2. 在系统浅色与深色两种设置下查看主窗口、原生表单控件、问答卡片和 HUD，确认应用都采用固定浅色；强制高对比模式单独验收。
3. 先以同样的 100% 缩放核对上述色值与字体加载，再检查 150% / 200% 缩放、混合 DPI 多屏上的文字换行、控件裁切和卡片大小。
4. 若 DOM 计算色值正确但肉眼颜色仍不同，再对齐两端显示器的 HDR、色彩配置和护眼设置；若中文形态不同，检查本地 WOFF2 是否加载成功及对应字符是否发生字体回退。

构建检查命令：

```bash
npm run build
npm run verify:appearance
```

`prebuild` 自动记录源码基准。校验命令会拒绝过期基准、缺失/变化的字体和许可、色板不符、缺少预加载或浅色声明的生产资源。最终发布包还需在 Windows 对 EXE 内嵌资源及实际窗口进行验收。
