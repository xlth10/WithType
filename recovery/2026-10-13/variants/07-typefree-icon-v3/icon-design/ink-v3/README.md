# typefree · 宣纸跳墨 v3

理念由用户明确为“墨珠在宣纸上跳动”。浅宣纸、圆墨珠和轻盈的起落是主体；三颗墨珠集中成一个紧凑的图标，移除旧 v2 的长 S 轨迹与月牙高光。

使用 Taste Skill 的品牌保留、小尺寸可读性与整体一致性原则，配合 icon-designer 的 ChatGPT Images 2.0 工作流。实际调用内置 image_gen；具体模型版本未由工具暴露。首次探索方向随用户修订撤回，最终采用宣纸轮次 C，并完成针对性的材质修订。Windows 产品采用 PNG/ICO/SVG，未生成无关的 iOS 资产。

![最终图标](/Users/outsider/SEVB/Type/icon-design/ink-v3/selected/typefree-ink-v3-master.png)

资源：

- `selected/typefree-ink-v3-master.png`：1024×1024 RGBA，透明角、主体不透明。
- `selected/typefree-ink-v3.svg`：可编辑几何母版。
- `selected/small-size-comparison.png`：16–96px 对照。
- `public/assets/typefree-ink-v3.svg`：前端共用图标与浏览器 favicon。
- `src-tauri/icons/ink-v3/`：16/20/24/32/48/64/128/256/512px PNG；ICO 包含 16/20/24/32/48/64/128/256px 八帧。
- `exploration/`：产品分析、两轮方向、精确提示词、图像原稿与评分；被撤回的深色底方案仅作过程证据。
- `selected/asset-validation.json`：导出尺寸、透明意图与多帧核验。

复生成：`python3 scripts/generate_ink_v3_icon.py`，依赖 Pillow。旧资源与旧脚本保留；新的 AppIcon、favicon、Tauri bundle、托盘/窗口内嵌图标、NSIS installerIcon 指向 v3。

最终几何源属于对选定概念的生产重建，不依赖生成图作为运行资源，也不覆写用户原图或旧版资产。
