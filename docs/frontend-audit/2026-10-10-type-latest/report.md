# typefree 最新前端 · Taste Skill 审查

日期：2026-10-10。审查对象：`/Users/outsider/SEVB/Type`，提交 `c84d53d143375e8feeda86d0c26048dde126ac8a`。通过既有 5173 预览进程的工作目录、Git 提交和实际页面确认来源；代码树在审查前后均无修改。

此前在 Emergence Lab 孵化目录启动的 5175 版本已撤回，不作为本报告的证据。本报告使用重新采集的 18 张截图及当前 DOM、CSS 和组件代码。

## 总体判断

纸色背景、墨色文字、本地中文字体、胶囊按钮和墨珠已经形成统一的视觉语言。建议保留这套方向，做针对性的可读性与操作空间修正。

[采用的 Taste Skill](https://github.com/Leonxlnx/taste-skill/blob/main/skills/taste-skill/SKILL.md) 主版本偏落地页。本项目是桌面工具，因此只采用其上下文判断、字体与对比度、布局、状态反馈、统一视觉和减少动态效果规则。没有把营销页图片、GSAP、布局多样性、标题字数或强制更换 UI 库作为本项目的验收标准。

设计判断：日常 Windows 语音工具，采用现有墨与纸的视觉语言。审查参数为布局变化 3、动效强度 2、信息密度 5；属于保留现有方向的局部改进建议。

## 优先修正

P1 表示应优先解决的可访问性问题；P2 表示明显的体验和布局问题。这里的优先级是建议的修复顺序，不代表 Windows 功能验收结果。

| 编号 | 优先级 | 发现与影响 | 建议 |
| --- | --- | --- | --- |
| F1 | P1 | 快捷键页三个通用开关没有可访问名称，辅助功能树只显示无名称的选中/未选中控件。整理模式、技能列表和侧栏的视觉选中状态也没有对应的语义状态。 | 让 Toggle 接收 label 或 labelledby；模式使用 radio/radiogroup 或明确的 aria-pressed；导航增加 aria-current；技能选择增加相应的选中语义。 |
| F2 | P1 | 文字模型的 12px 提示使用 #777b72，表单背景是 #fcfcf9，对比度为 4.203465:1；空状态在 #f8f9f4 上为 4.083465:1。普通文字未达到 4.5:1。 | 调深 --faint；复核提示、空状态和元信息。--muted 在表单背景上已达到约 5.29:1，可以作为调整基线。 |
| F3 | P2 | “整理要求”只占技能编辑器半列，默认 1060px 窗口宽约 256px；860px 窗口约 171px，旁边留着空列。历史纠正框在约 781px 宽的卡片里只有约 317px。 | 长文本字段跨满详情面板；历史内容区使用 flex: 1 / min-width: 0，让纠正框占满可用宽度。编辑时可收起不可操作的技能列表。 |
| F4 | P2 | 五个整理模式在默认窗口排成 4+1，最后一项孤立，卡片面积大于选择操作所需的空间。 | 按本地处理与文字模型处理分组，或使用更紧凑的单选列表。让响应式布局明确地选择合适的列数，不用补空卡片。 |
| F5 | P2 | 历史页“保留后续录音”、说明、开关直接挤在同一行，与快捷键页的设置行不一致。设置面板紧接第一条历史卡片，分组不清楚。 | 复用设置行布局：标题与说明纵向排列，开关右对齐；给历史列表增加组间距；元信息与“纠正并记住”分开排。 |
| F6 | P2 | 语音地址为空时首页仍显示“准备就绪”；点击录音后只给一条“请先配置”的提示，没有直接前往模型配置的操作。 | 区分待配置、待测试和可以录音；未配置状态的主要操作指向模型配置，并指出缺少语音服务或文字服务。 |
| F7 | P2 | 在应用允许的最小 640×480 窗口，“新建技能”按钮换成两行，编辑时已禁用的技能列表占据首屏。侧栏收成图标后也没有 hover 标题。 | 防止页头操作按钮收缩和换行；编辑时折叠场景列表；为图标导航提供工具提示。 |
| F8 | P2 | 回答卡片追问框可以通过 Tab 到达，但聚焦后 outline 样式仍为 none，box-shadow 为 none，外框不变化，反馈主要依赖细光标。 | 在 .answer-followup:focus-within 上增加清楚的边框/焦点环。此项是焦点反馈风险，不将光标本身存在的情况直接认定为完整 WCAG 失败。 |

F2 的阈值依据 [W3C WCAG 2.2：Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)。F1 的名称、角色和状态要求依据 [W3C：Name, Role, Value](https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html)。本报告没有把禁用控件的浅色直接判为文字对比度失败。

代码位置：

- F1：[Toggle](/Users/outsider/SEVB/Type/src/App.jsx:221)、[侧栏](/Users/outsider/SEVB/Type/src/App.jsx:201)、[整理模式](/Users/outsider/SEVB/Type/src/App.jsx:300)、[技能列表](/Users/outsider/SEVB/Type/src/components/SkillEditor.jsx:83)。
- F2：[颜色变量](/Users/outsider/SEVB/Type/src/styles.css:17)、[提示字号](/Users/outsider/SEVB/Type/src/styles.css:283)。
- F3：[技能长文本字段](/Users/outsider/SEVB/Type/src/components/SkillEditor.jsx:96)、[通用表单网格](/Users/outsider/SEVB/Type/src/styles.css:113)、[历史内容容器](/Users/outsider/SEVB/Type/src/App.jsx:492)。
- F4：[模式网格](/Users/outsider/SEVB/Type/src/styles.css:133)、[中等窗口规则](/Users/outsider/SEVB/Type/src/styles.css:382)。
- F5：[历史设置行](/Users/outsider/SEVB/Type/src/App.jsx:487)。
- F6：[首页](/Users/outsider/SEVB/Type/src/App.jsx:507)。
- F7：[页头](/Users/outsider/SEVB/Type/src/styles.css:255)、[窄窗口规则](/Users/outsider/SEVB/Type/src/styles.css:383)。
- F8：[追问框样式](/Users/outsider/SEVB/Type/src/styles.css:374)。

## 已有优点

- 正文和控件采用本地 Noto Sans SC，主要内容约 13–16px；不沿用旧版本“大量 8–10px”的结论。
- 主要按钮与正文墨色对比充分，图标来自同一套 Phosphor。
- 模型配置合在一页，语音与文字两类服务分工明确，密钥保存分开。
- 浏览器连接测试明确声明不会发起真实测试，不再误报服务在线；语音地址、模型或密钥变化时会清除旧的测试状态。
- 技能页有场景说明、口述提示、明确标注的静态样例、用一次与常用绑定的区别。
- 按钮具有统一的键盘焦点样式；词库学习开关和回答卡片主要操作具有名称。HUD 有状态文字与控制名称。
- 回答卡片在 460×520 和 360×320 下都保留追问和复制操作。
- CSS 与墨珠引擎都处理减少动态效果设置；实际 Windows 系统设置下的表现仍需实机验证。

## 审查步骤与截图

所有下列截图均已保存并重新打开检查。图中“示例”历史和回答属于应用浏览器预览样例，不代表真实识别或服务结果。

### 1. 概览与未配置入口：需要改善引导（F6）

![概览](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/frontend-audit/2026-10-10-type-latest/01-overview.jpg)

![点击录音后的配置提示](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/frontend-audit/2026-10-10-type-latest/02-overview-unconfigured.jpg)

### 2. 模型配置：结构清晰，辅助文字对比度待修（F2）

![模型配置的语音区域](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/frontend-audit/2026-10-10-type-latest/03-model-speech.jpg)

![通过页内链接到文字处理区域](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/frontend-audit/2026-10-10-type-latest/04-model-text.jpg)

### 3. 文字整理：模式布局与选中语义待修（F1、F4）

![五个模式的4加1布局](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/frontend-audit/2026-10-10-type-latest/05-writing-after-navigation.jpg)

### 4. 技能查看与编辑：场景表达清楚，编辑空间待修（F1、F3）

![技能场景页](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/frontend-audit/2026-10-10-type-latest/06-skills.jpg)

![默认窗口的技能编辑器](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/frontend-audit/2026-10-10-type-latest/07-skill-editor.jpg)

![860乘620窗口下的编辑器](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/frontend-audit/2026-10-10-type-latest/08-skill-editor-860.jpg)

### 5. 最小主窗口：操作按钮和编辑首屏待修（F7）

![640乘480最小主窗口](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/frontend-audit/2026-10-10-type-latest/09-min-window-navigation.jpg)

### 6. 个人词库：基本健康，浅色空状态仍受F2影响

![个人词库空状态](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/frontend-audit/2026-10-10-type-latest/10-vocabulary.jpg)

### 7. 快捷键：录制说明清楚，通用开关名称待修（F1）

![快捷键配置](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/frontend-audit/2026-10-10-type-latest/11-shortcuts.jpg)

![设置开关](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/frontend-audit/2026-10-10-type-latest/12-shortcut-toggles.jpg)

### 8. 历史与纠正：设置分组和长文本空间待修（F3、F5）

![历史列表和保留设置](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/frontend-audit/2026-10-10-type-latest/13-history.jpg)

![历史纠正框](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/frontend-audit/2026-10-10-type-latest/14-history-correction.jpg)

### 9. 回答卡片：主结构基本健康，追问焦点反馈可加强（F8）

![460乘520回答卡片](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/frontend-audit/2026-10-10-type-latest/15-answer-card.jpg)

![键盘聚焦追问框](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/frontend-audit/2026-10-10-type-latest/16-answer-keyboard-focus.jpg)

![360乘320最小回答卡片](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/frontend-audit/2026-10-10-type-latest/17-answer-min-window.jpg)

### 10. 墨珠HUD：视觉和状态表达基本健康，仅模拟状态核查

![录音HUD的浏览器模拟](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/frontend-audit/2026-10-10-type-latest/18-recording-hud.jpg)

HUD 截图实际是 240×160 的浏览器画布，不能当作原生 196×74 窗口截图。原生窗口尺寸及可见176×54墨珠区域来自 Tauri 配置与 CSS。没有启动真实录音，也没有检查多屏、透明合成、任务栏避让或录音电平响应。

## 证据和验证范围

- 主窗口：1060×720；中等窗口：860×620；最小窗口：640×480。
- 回答卡片：460×520 与 360×320。
- 已观察导航、页内跳转、未配置入口反馈、技能草稿打开/取消、历史纠正打开/取消、键盘聚焦与布局变化。
- 没有保存技能、修改模型、切换学习/隐私开关、导出或删除历史，也没有提交模型请求。
- 有名称缺失、颜色、字号和字段宽度的 DOM 证据，见同目录 JSON。
- 当前预览有已保存的个人偏好；不是重置安装后的完整首次运行测试。
- 没有 Windows 实机、真实识别/文字服务、凭据保存、跨应用粘贴、辅助技术完整朗读、200% 缩放或性能测量结果。不能声称产品通过完整 WCAG 或 Windows 验收。
- 本次只新增审查证据与报告，未修改 `/Users/outsider/SEVB/Type` 源码。

建议的下一步：先修 F1 和 F2，再集中调整 F3、F5、F7 的表单与小窗口空间。
