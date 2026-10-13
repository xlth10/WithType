# HUD 专项补审 · 2026-10-11

来源：最新 `/Users/outsider/SEVB/Type`，基线 c84d53d 加 2026-10-10 前端修正。此前审查只有单张录音模拟截图，本次补充静音、说话、悬停/聚焦、处理、完成、错误状态及原生窗口代码。

使用 Taste Skill 的统一视觉、可读性、反馈与减少动态效果原则；HUD 是桌面浮层，不机械套用营销页结构。

## 结果

墨珠、纸色胶囊与当前界面一致。可见区域 176×54，按钮 34×34，名称为“结束录音”“取消或关闭”；无水平溢出。静音收成中心墨点，录音电平驱动五珠，处理中动作克制，成功与错误具有文字和符号。聚焦控制后出现可见焦点环。源码包含减少动态效果分支与逐帧清理。

## 建议处理

| 编号 | 优先级 | 证据与影响 | 建议 |
| --- | --- | --- | --- |
| H1 | P2 | App.jsx 的可见短文案在 processing 时只区分 phase === asr，其余全部“整理中”；statusLabel 则区分 classify、ask、translate。截图中的 processing 默认 phase idle 甚至出现区域名称“正在识别”而可见“整理中”。真实 text/classify 阶段的细分只经过源码检查，未声称浏览器演示了这些阶段。 | 使用同一份状态文案映射，明确显示判断、识别、回答、翻译、整理。浏览器预览支持 intent/phase 参数后可逐项复验。 |
| H2 | P2 | DOM 中没有 aria-live 或 role=status；状态仅改变区域 aria-label 和普通 span。存在名称不等于能保证持续状态被辅助技术自动播报。 | 为离散状态变化提供温和播报，电平动画保持 aria-hidden；避免每帧播报。需要 Windows 辅助技术复验，当前不判定完整 WCAG 失败。 |
| H3 | 建议 | 悬停与 focus-within 将状态和墨珠降至 0.06，控制按钮替换整个信息区。这是明确的紧凑布局取舍，但用户无法同时观察阶段与控制。 | 后续布局允许时保留短状态与控制并列，或在处理/错误状态保留文字。不是录音功能故障。 |

原生配置 focus:false、focusable:false；启动时再次 set_focusable(false)。这是保持目标输入框焦点的设计，因此浏览器 Tab 能聚焦 HUD 按钮不能证明原生浮层支持同样的 Tab 操作。原生用户仍有全局快捷键和托盘控制。

## 原生路径检查

- 196×74 逻辑像素窗口，176×54 可见胶囊与10px留白；透明、无装饰/系统阴影、置顶、跳过任务栏。
- floating.rs 按目标显示器 DPI 转换为物理像素，工作区底部居中并留18逻辑像素，处理任务栏与负坐标。
- set_overlay_state 在会话内保留显示器；状态变化显示浮层后恢复 Windows 前台窗口，没有改动 focusable 边界。
- frontend 通过 dictation-state 接收 state/intent/phase，通过 dictation-level 接收录音电平；动画 RAF 在卸载清理。

## 验证边界

截图是 240×160 浏览器画布中对 HUD 与留白的 196×74 CSS 裁剪，不是原生 Windows 截图。检查了 DOM、真实浏览器布局和源码；未启动真实麦克风，未点击会发送原生 stop/cancel 的按钮，没有验证 Windows 透明合成、焦点恢复、任务栏、多屏 DPI 与辅助技术朗读。减少动态效果的运行边界由既有 voice-motion 测试和源码核对，未声称在 Windows 设置里实测。

本次 HUD 是审查，未改录音控制、窗口焦点或状态代码。整改建议与新图标交付分开记录。

![录音](/Users/outsider/SEVB/Type/docs/design/hud-audit-2026-10-11/recording.png)

![控制焦点](/Users/outsider/SEVB/Type/docs/design/hud-audit-2026-10-11/recording-focus.png)

![处理](/Users/outsider/SEVB/Type/docs/design/hud-audit-2026-10-11/processing.png)

![完成](/Users/outsider/SEVB/Type/docs/design/hud-audit-2026-10-11/done.png)

![错误](/Users/outsider/SEVB/Type/docs/design/hud-audit-2026-10-11/error.png)
