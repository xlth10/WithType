# 输入投递与恢复交互审计

本报告为修复前基线，保留当时的源码行号和证据。后续核心修复与验收边界见 [交互优化说明](interaction-optimization.md)。

日期：2026-10-11。基于当前工作区源码，包含上一轮尚未提交的长文本优化。只读检查产品代码，只新增审计文档与离线证据。未启动 Windows EXE、未操作用户剪贴板、未录音、未发送模型请求。

## 结论与优先级

目前投递动作是“写剪贴板 → 等 70 ms → 向当前前台输入流发送 Ctrl+V → 异步等待 900 ms 尝试恢复旧纯文本”。录音开始的应用信息只是历史元数据，没有绑定投递窗口或控件。最优先的交互缺口是目标切换、取消竞态，以及把按键发送成功当成文字输入成功。取消 ASR/文字阶段、保存粘贴失败结果等路径已有保护，应保留。

P1 表示可能写入错误位置、取消后仍输入或核心投递结果错误；P2 表示恢复、反馈或特定操作状态下的失败。以下“静态成立”表示源码路径/状态模型可以确认，不表示已经在 Windows 实机重现。

| 编号 | 优先级 | 问题 | 证据状态 |
| --- | --- | --- | --- |
| I1 | P1 | 没有保存或校验投递目标，处理期间切换应用会把结果发送到另一处；历史仍记原应用 | 静态成立，目标应用实际行为需实机验证 |
| I2 | P1 | SendInput 成功即标记 pasted，未确认输入框接受文本；无光标缺少明确复制退路 | 静态成立，具体控件行为需实机验证 |
| I3 | P1 | cancel_paste 在 paste_text 登记前到达会丢失取消；登记还清除取消标记 | 状态模型确认，实际 IPC 排程需验证 |
| I4 | P2 | 剪贴板只备份纯文本；图片、文件列表、富文本和空剪贴板不能完整恢复 | 本项目与已锁定依赖源码确认 |
| I5 | P2 | 两次投递在恢复窗口内交叠，可能把剪贴板恢复成上一次口述文字 | 状态模型确认，触发频率未知 |
| I6 | P2 | 用户仍按住 Alt/Shift/Win 等键时可能改变 Ctrl+V；未等修饰键释放 | 源码与 Microsoft API 契约确认，实机待测 |
| I7 | P2 | 复制模式写剪贴板失败被吞掉，仍报告完成；明确“插入原文”操作在此模式实际只复制 | 静态成立，权限失败触发条件需验证 |
| I8 | P2 | 粘贴失败没有直接复制 fallback，结果需去历史取回 | 静态成立；已有历史保存，未丢失结果 |

## I1：投递目标没有绑定

**触发**：在应用 A 的输入框开始录音，停止后在识别/整理期间切到应用 B；或在本应用主窗口点“重试”“插入原文”，然后等待完成。

开始时仅获取 `ActiveWindowContext { app, title }`，没有 HWND、线程 ID 或 UIA 控件标识。[lib.rs:110](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/lib.rs:110)、[lib.rs:131](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/lib.rs:131)。前端快照保存此对象，但投递参数仅为 text/learn/sessionId，原生最终 `send_ctrl_v` 不接收目标。[pipeline.js:83](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/dictation/pipeline.js:83)、[pipeline.js:587](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/dictation/pipeline.js:587)、[lib.rs:568](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/lib.rs:568)。重试/插入原文只是创建新任务并沿用历史 windowContext，没有恢复或重新确认目标。[pipeline.js:633](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/dictation/pipeline.js:633)、[pipeline.js:662](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/dictation/pipeline.js:662)。

**影响**：结果可能输入 B、另一输入框或本应用当前聚焦的设置控件，历史仍显示 A。若产品选择跟随当前光标，也需要明确显示/确认实际去处，不能把录音开始的元数据当成已投递目标。建议把任务目标策略写清楚，并在发送前校验应用/控件；目标改变时保留结果并提供复制或重新选定去处。

**限制**：没有实测具体程序是否接受 Ctrl+V；“缺少目标绑定”本身已确认。

## I2：按键成功不等于已输入，无光标退路不足

**触发**：录音结束后焦点在只读控件、窗口空白处或应用按钮，Windows 接受四个键盘事件，但控件忽略 Ctrl+V。

`send_ctrl_v` 只检查 `SendInput` 返回数是否等于 4，并返回 `Result<(),String>`。[lib.rs:487](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/lib.rs:487)。Microsoft 定义返回值为成功加入输入流的事件数，并不承诺目标已粘贴文本。[官方 SendInput 文档](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput)。`paste_text` 成功后，pipeline 不读取目标内容，直接 `pasted=true`，触发 done。[pipeline.js:601](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/dictation/pipeline.js:601)。900 ms 后旧文本可能被恢复，结果不会保留为当前剪贴板。[lib.rs:588](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/lib.rs:588)。

UIA 的密码框、当前进程、只读排除用于词汇学习观察，并不约束投递：`prepare` 返回 None 后仍无条件执行 `paste_to_foreground`。[uia.rs:40](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/uia.rs:40)、[uia.rs:75](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/uia.rs:75)、[lib.rs:521](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/lib.rs:521)。词汇观察在投递后能验证范围，但它不向 pipeline 回传投递结果，也不为失败路径提供复制。[correction_monitor.rs:237](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/correction_monitor.rs:237)。

**影响与建议**：HUD 可报完成但目标没有文字。应区分“已复制”“已发送粘贴”“已确认输入”；不可编辑、焦点失效或无法确认时保留结果并提供明确复制结果。UIA 不可读取不等于不可输入，不能简单把所有不可访问控件禁用。

## I3：取消先于投递登记可能失效

**触发条件**：pipeline 已提交异步 paste_text，用户取消；若 cancel_paste 的原生命令先于 paste_text 异步函数登记 active 运行，取消不被保存。

`cancel_paste` 只有 active 中包含 sessionId 才记录取消；`paste_text` 登记时无条件清除 cancelled 中同 ID。[lib.rs:547](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/lib.rs:547)、[lib.rs:514](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/lib.rs:514)。前端取消会清空 currentId 并发送 cancel_paste，后续 guard 能阻止 done/历史，却不能撤销已发送的 Ctrl+V。[pipeline.js:126](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/dictation/pipeline.js:126)、[pipeline.js:604](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/dictation/pipeline.js:604)。

**离线验证**：按现有分支做状态模型，顺序 `cancel(id) → enterPaste(id) → pasteWasCancelled(id)` 得到 false。它证明取消状态没有覆盖预登记阶段，不证明 Windows IPC 必然采取该排程。

**影响与建议**：极窄竞态下，UI 显示取消但仍输入文字，且结果不进入历史。应保存有界取消 tombstone，并使同一 sessionId 的投递不能自行复活。现有发送前/70 ms 后两次检查有效覆盖已登记阶段，值得保留；SendInput 之后无法承诺回滚。

## I4–I5：剪贴板恢复不是完整事务

**I4 触发**：原剪贴板为图片、文件列表、富文本，或没有文本；进行一次自动输入。备份只有 `get_text().ok()`，恢复只有 `Some(previous)` 分支。[lib.rs:574](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/lib.rs:574)、[lib.rs:593](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/lib.rs:593)。锁定的 arboard 3.6.1 Windows text 方法调用 clipboard-win::raw::set_string；后者先使用 DoClear，再仅写 CF_UNICODETEXT。[arboard 源码](/Users/outsider/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/arboard-3.6.1/src/platform/windows.rs:674)、[clipboard-win 源码](/Users/outsider/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/clipboard-win-5.4.1/src/raw.rs:556)、[DoClear](/Users/outsider/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/clipboard-win-5.4.1/src/raw.rs:587)。因此不能称“完整恢复剪贴板”；无文本时取消分支也会留下口述文本。[lib.rs:579](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/lib.rs:579)。

**I5 触发**：初始剪贴板 P；投递 A，900 ms 恢复前再次投递 B。B 备份 A；A 的恢复看到 B 后跳过；B 的恢复随后把内容改回 A。离线执行同一比较/恢复逻辑得到“dictation A”，而非 P。恢复线程没有统一会话序列号或跨投递原始快照。[lib.rs:590](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/lib.rs:590)。是否能在正常语音流程快速触发依赖请求时延，未做实机重现。

**影响与建议**：旧剪贴板格式丢失或变成更早的口述结果。内容不同才恢复的保护可以避免覆盖多数新复制内容，值得保留；但它不是序列号保护，不能处理相同文本的新复制，也不能解决嵌套投递。建议统一串行投递与恢复所有权，明确支持的格式及空剪贴板恢复。

## I6：未检查用户仍按住的修饰键

**触发**：短句处理很快，用户按停止快捷键时仍保持 Alt/Shift/Win；或投递瞬间正在使用其它修饰键。发送序列只有 Ctrl↓、V↓、V↑、Ctrl↑，未查询或等待其它修饰键。[lib.rs:481](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/lib.rs:481)。Microsoft 说明 SendInput 不重置当前键盘状态，已按下的键可能干扰，应检查 GetAsyncKeyState。[官方文档](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput)。

**影响与建议**：变成 Ctrl+Alt+V 等组合，打开特殊粘贴或无操作，而客户端仍可能报完成。可在有界等待内检查修饰键释放；避免直接改变用户键盘状态。具体快捷键行为需在 Windows 记事本、浏览器和 Office 验证。

## I7–I8：复制与错误恢复反馈

**I7 触发**：关闭“结果自动输入”，本次完成后的 `navigator.clipboard.writeText` 拒绝。pipeline 此时只汇报 done/pasted=false，实际复制在 App 事件处理器；复制错误 `.catch(() => {})` 被吞，通知“已完成”提前发出。[pipeline.js:585](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/dictation/pipeline.js:585)、[App.jsx:834](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/App.jsx:834)。实际 WebView2 后台权限是否拒绝需要验证；已确认拒绝时没有失败反馈。UI 文案承诺“关闭后复制到剪贴板”。[App.jsx:438](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/App.jsx:438)

若同一模式下点“插入原文”，insertRaw 仍遵守 autoPaste=false，只复制，却由于 insertedRaw=true 通知“已插入识别原文”。[pipeline.js:662](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/dictation/pipeline.js:662)、[App.jsx:834](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/App.jsx:834)。应明确该按钮覆盖还是遵守投递设置，并按实际结果报告“已复制”或“已输入”。

**I8 触发**：原生剪贴板创建/写入或 SendInput 失败。pipeline 发 paste-failed，App 保存 lastResult/历史后直接 return，跳过下方复制逻辑。[pipeline.js:588](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/dictation/pipeline.js:588)、[App.jsx:807](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/App.jsx:807)、[App.jsx:828](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/App.jsx:828)。这是“自动输入失败后去历史复制”的现有路径，不是结果丢失；但缺少直接的结果复制/重新选择去处操作。建议在失败现场保留可复制正文，并报告复制是否成功。

## 已有有效保护与验证局限

- 任务快照固定模式/设置；guard 阻止迟到的 ASR、文字结果继续投递或写历史。命令与问答失败不会把原始指令输入目标；重试与插入原文共用唯一 deliver 路径。[pipeline.js:70](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/dictation/pipeline.js:70)、[pipeline.js:662](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/dictation/pipeline.js:662)
- 粘贴异常已有专门事件和历史保存，不会静默丢掉整理正文。[pipeline.js:592](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/dictation/pipeline.js:592)
- UIA/词汇观察绑定捕获的控件，检查 focus、插入范围和取消；超长/密码/不可读取控件跳过观察。它是学习保护，不是投递验证。[correction_monitor.rs:213](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/correction_monitor.rs:213)
- useNativeRecorder 按 sessionId 过滤电平和设备错误，start 有 generation 保护；stop 先清 sessionRef，但 pipeline.cancel 仍通过快照 requestId 取消停止中的原生会话，不能仅凭 ref 清空判定取消丢失。[useNativeRecorder.js:17](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/dictation/useNativeRecorder.js:17)、[useNativeRecorder.js:49](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/dictation/useNativeRecorder.js:49)、[pipeline.js:133](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/dictation/pipeline.js:133)。本轮未找到可确定的 recorder 输出错误，不把推测列成 bug。
- 独立离线状态模型仅验证 I3/I5 的状态迁移；没有执行真实 Windows API。可复查[脚本](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/interaction-evidence/native-delivery-state-probe.mjs)与[输出](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/interaction-evidence/native-delivery-state-results.json)。I7/I8 的 App handler 与实际 pipeline.insertRaw mock 由主线程核验，可复查[前端脚本](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/interaction-evidence/frontend-delivery-probe.mjs)与[输出](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/interaction-evidence/frontend-delivery-probe-results.json)；这些同样不证明 Windows API 实机结果。
- 实机验收应覆盖：A→B 焦点切换、同一窗口切换控件、无光标、密码/只读控件、从本应用点击重试、按住修饰键、取消发生于投递边界、连续两次投递、图片/文件列表/富文本剪贴板、后台复制失败及管理员窗口 UIPI。
