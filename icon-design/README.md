# 应用图标 · ink-path v2

依据用户上传的墨珠与笔迹图像重构，非 Typefree 官方图标。保留三个递减墨珠沿连续笔迹前行的意象；与当前暖纸、墨色界面一致。侧栏、问答卡片和 Windows 原生资产使用同一几何造型。

![最终图标](selected/typefree-ink-v2-master.png)

## 来源与流程

本轮使用 icon-designer 的 **ChatGPT Images 2.0 工作流**，实际调用内置 `image_gen`；工具未提供可核验的具体模型版本，因此不将版本名作为生成事实。先生成四个方向，再修订五珠方向；用户随后指定上传图像，最终方向转为三珠笔迹，并通过图像编辑生成简化概念。提示词记录见 `prompts.json`，选择和评分见 `visual-review.md`，修订见 `iteration.md`。

最终 SVG 是根据选定概念重新绘制的本项目几何资源；PNG/ICO 从该几何导出。没有把生成的栅格图假称为 SVG，没有修改或覆盖用户原图与生成概念。项目目标是 Windows，因此将技能默认的 iOS 导出步骤调整为 Windows PNG/ICO 和前端 SVG。

## 交付资源

- `selected/typefree-ink-v2-master.png`：1024×1024 RGBA master。
- `selected/typefree-ink-v2.svg`：128 单位几何源。
- `selected/ink-path-generated-v2.png`：图像工具生成的概念原图。
- `../public/assets/typefree-ink-v2.svg`：前端、问答卡片、浏览器 favicon。
- `../src-tauri/icons/ink-v2/`：16、20、24、32、48、64、128、256、512px PNG；`icon.ico` 含 16/24/32/48/64/128/256px 七帧。
- `concepts/`：四个探索稿、五珠修订稿和用户参考原图，均未集成到应用。

原有图标与 `scripts/generate_icon.py` 保留。v2 复生成（依赖 Pillow）：

```bash
python scripts/generate_ink_icon.py
```

## 集成与检查

- `AppIcon.jsx` 供侧栏 Logo 与问答卡片共用，保持原始色彩，无灰度滤镜。
- Tauri bundle / NSIS installerIcon 和 `lib.rs::APP_ICON` 都指向 `ink-v2`；沿用最大 ICO 帧解码路径，避免 16px 帧放大模糊。
- 已核验 master 尺寸、PNG 格式/RGBA、透明角和 ICO 七个尺寸；直接查看 master 和 20/32/48px 成稿；实际侧栏与问答卡片的 SVG 也已在浏览器确认加载。
- Windows 桌面、任务栏、托盘与安装器尚待 UI-09 实机验收，旧固定快捷方式可能仍显示缓存图标，处理见 `docs/windows-remediation.md`。
