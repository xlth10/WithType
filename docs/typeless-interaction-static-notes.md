# Typeless 2.8.1：交互与结果投递的静态核查

核查日期：2026-10-11。对象是 `/Applications/Typeless.app` 的本机副本，版本 2.8.1 / build 2.8.1.130。只读取打包 JavaScript 与既有静态派生文件；未启动 Typeless、录音、模型请求，也未读取用户历史记录。以下描述是代码中可追踪的分支，不是实际运行观察。

沿用既有 `source-ledger.json` 的限制：本机应用签名校验异常，原因未知；完整 ASAR 校验此前被无关的 better-sqlite3 成员校验错误阻挡。因此结论限定于这个本机副本，不能证明官方全部版本或 Windows 构建具有相同运行行为。

## 结论

1. 交互以三个明确的 mode 入口组织：听写、Ask Anything、翻译。客户端 `voice_command` 实际发给服务端的 mode 名是 `ask_anything`；当前核查的客户端不是任意工具执行框架。
2. **结果完成时重新读取当前焦点 → 先尝试插入 → 再依据可编辑性与兼容名单决定是否显示卡片。** 卡片不是经验证的“插入失败回退”，客户端不核验目标应用实际收到了文字。
3. 当前完成链未见自动永久写入系统剪贴板。明确的 Copy 按钮有独立复制路径；原生插入所需的临时剪贴板使用应与用户主动 Copy 分开理解。
4. 取消提示中的 Undo 是重试最新历史音频，不是撤销目标应用中的已插入文本。历史也有显式重试、复制、查看 Ask 答案等入口。
5. `pasteLastTranscript` 有默认配置，但在本轮有界搜索范围内没有闭合的消费者链；不能仅凭名称断言此快捷键可用或有独立的永久“上次结果”缓存。

## 文件与方法

既有输入位于 `/private/tmp/typeless-context-analysis/`。本轮另从 ASAR 的 `dist/renderer/static/js/` 只读提取 Ce、交互卡片与 Hub 模块至同一个临时目录；软件源文件未复制进项目。Babel 仅解析 AST/token，没有执行目标代码。renderer 格式化只在 token 边界加入换行；主进程派生文件沿用既有惰性字符串表替换，等价性没有运行测试。

原始 SHA-256：

| 代号 | ASAR 成员 | SHA-256 |
| --- | --- | --- |
| M | `dist/main/index.js` | `7b87e1578597b6fce6b6589a2f8aa18496e9513f0e74d0b8b26186a641b59ade` |
| Q | `dist/renderer/static/js/qA149QP2.mjs` | `40723210d92894508ad2d8672f51023e5e5f43f259d43c85bc21b293c4c6e84a` |
| U | `dist/renderer/static/js/UfR9-a2Z.js` | `efba7d2db84c1da476b521c84cd38446d594ffd4f0d8e59cac85e7ec7d6ae49a` |
| C | `dist/renderer/static/js/CeQePRHT.js` | `0b54274b73a569bc7739f7823279a2ae974fb615900bf42bdd35b5db82e1d40a` |
| P | `dist/renderer/static/js/DPebRPWn.mjs` | `0af7cdf192c1f7e658e96c667d08058ca3c6f5671b3ef24a7ea9c9fcac158ac6` |
| A | `dist/renderer/static/js/D1Ts5YWP.js` | `fb0ac2ecefd93e2b396e599ee62998ee13a6e361bca0a6ff2bdead2d81c49727` |
| H | `dist/renderer/static/js/DNMdpbnK.mjs` | `86fa0e0d3bc22d43d07f3cf7d1730018c5e4b022ce884baa21b4a80f3eaa7913` |

检查视图 SHA-256，代号顺序同上：

```text
M dd31f4c2903801d1f563d6ddaa6b40de300708ebdfde812764a6de703be7053a
Q d97160c26d165a70fdffffd1a4024da4e961a8f015882de0e591d903edffc2e8
U 625f8296a1baf2d98c6e687624569a32fd61e2a919231422536a71a54245c5f4
C 6381ea13bed7c9ea5f0a88fb21dcc912a00d3e8c2ec4c5267d3bd6f436acfe04
P 581dd3691bcf5efc186f1337add6512a0edf3eebb75646a720053fe3a0e51250
A 2bf450012e0d7ed2865de5758e8929686c90d79ac3d8bb2042732de17cff1858
H 892e4bffc2b9c9e29fe6d511c7d47b7f7bc4e5bf8feba29dd98ae3f4dcfa1c91
```

以下 anchor 的原始区间为 **UTF-8 字节、零起点、尾端不含**；检查视图的行号为一基。映射方法：按同一 Babel token 规则重建格式化文本并检查逐字节一致，移除所加换行；M 再按 `decode-provenance.json.mapping` 反向映射字符串替换。可复查脚本是临时研究工具 `/private/tmp/typeless-interaction-map.mjs`。

| Anchor | 检查视图行 | 原始字节区间 | 可定位的符号/用途 |
| --- | --- | --- | --- |
| M-KEYS | M 2856–2864 | 129467–129969 | 默认 mode / pasteLastTranscript 快捷键 |
| M-KEYBOARD | M 8360–8456 | 344426–349410 | `Tf`，广播键状态、reload、insertText/insertRichText |
| M-COPY | M 11901–11916 | 569469–569823 | `Vm`，clipboard:write-text |
| M-HISTORY | M 12050–12085 | 574068–576344 | `Zm`，历史 IPC |
| M-RETENTION | M 5042–5073 | 212738–214465 | deleteByDuration |
| Q-RECORD | Q 2576–2678 | 110042–113977 | mode 映射、Recorder、历史重试 actor |
| Q-SESSION | Q 3005–3080 | 128789–131852 | `ne`，内存 session 与 DB placeholder |
| Q-DELIVERY | Q 3182–3268 | 136125–140326 | `Ko/$o/Xo/Jo/dr/ur`，完成投递与重新采集焦点 |
| Q-FALLBACK | Q 3290–3310 | 141676–142949 | `fr/hr`，兼容名单判定、编辑跟踪 |
| Q-COMPLETE | Q 3392–3412 | 144948–145505 | onRefineCompleted：先发状态事件，异步投递、保存 |
| Q-MODE | Q 3518–3570 | 149196–151626 | selected_text / output_language 的 set_mode_config |
| Q-INIT | Q 3710–3752 | 156339–158432 | `ca` 初始化检查，20/30 秒 refine 基准超时 |
| Q-START | Q 4175–4330 | 172735–177067 | idle、初始化、tap/long hold 状态 |
| Q-STOP | Q 4345–4560 | 177427–183320 | 录音、停止、finishing、error/failure、retrying |
| Q-HOLD | Q 4561–4668 | 183320–186889 | `la/da`，600ms LONG_HOLD 事实 |
| Q-HOTKEY | Q 4719–4842 | 188587–192843 | `pa`，feature → key down/up 事件 |
| U-UNDO | U 435–449、741–801 | 21489–22227、36982–39732 | `zt/Wo/Go/zo`，取消 Undo / 错误 Retry |
| U-COPY | U 643–675、1112–1132 | 33484–34412、50845–51649 | `Uo/us`，结果卡片与主动复制按钮 |
| U-CARD | U 1448–1463 | 64583–65176 | `xs`，page:open-interactive-card |
| U-RACE | U 6588–6640、6832–6848 | 283184–285814、294852–295984 | startRefineRace / handleRefineCompleted |
| C-COPY | C 11705–11731 | 684885–685747 | `a9/co`，IPC copy → DOM copy fallback |
| C-INSERT | C 15129–15166 | 913276–914517 | `xi/l9/o9`，plain/rich 插入与异常处理 |
| P-CARD | P 16–66 | 317–2117 | `z`，payload、Escape 关闭、动态窗口高度 |
| A-COPY | A 181–194、486–507 | 14368–14710、24843–26483 | Answer copy、选区 copy 去 citation 节点 |
| H-COPY | H 85874–85903 | 7285401–7286263 | `Mf1`，历史主动复制 |
| H-RECOVERY | H 86211–86259 | 7303555–7306128 | `jf1`，历史音频重试与保存 |
| H-LATEST | H 89665–89707 | 7485862–7488004 | `mH1`，db:history-latest 用于反馈 |

检查文件链接：[M](/private/tmp/typeless-context-analysis/main.decoded.js)、[Q](/private/tmp/typeless-context-analysis/renderer/qA149QP2.mjs.formatted.js)、[U](/private/tmp/typeless-context-analysis/renderer/UfR9-a2Z.js.formatted.js)、[C](/private/tmp/typeless-context-analysis/renderer/CeQePRHT.js.formatted.js)、[P](/private/tmp/typeless-context-analysis/renderer/DPebRPWn.mjs.formatted.js)、[A](/private/tmp/typeless-context-analysis/renderer/D1Ts5YWP.js.formatted.js)、[H](/private/tmp/typeless-context-analysis/renderer/DNMdpbnK.mjs.formatted.js)。这些临时路径可能随后被清理，成员路径、hash 与字节区间用于长期定位。

## 快捷键、状态与浮条

- 默认 Mac：`Fn` 听写、`Fn+Space` Ask、`Fn+LeftShift` 翻译；同一代码列出的 Windows 默认值为 `RightAlt`、`RightAlt+Space`、`RightAlt+RightShift`。这是 Mac 打包产物中的配置表，**未测试 Windows 可用性**。（M-KEYS）
- 主进程 `Tf` 把 native 键状态广播至窗口；renderer `pa` 将三种 feature 转成 `PRIMARY/HANDSFREE/TRANSLATION_KEY.DOWN/UP`，录音机据事件转换状态。（M-KEYBOARD、Q-HOTKEY）
- 当前入口先开始 Recorder 并并行做登录、联网、Accessibility、麦克风检查；tap 释放后进入 handsFree，再次按任一 mode 快捷键结束，浮条 Finish 也结束。代码保留 pushToTalk 状态，但本版可达 tap 流程及 `LONG_HOLD` → `long_pressing` 会停止录音并提示不要长按，因此不能写成“所有按住录音路径均可用”。长按检测阈值 600ms，听写重复 keydown 有 300ms 节流。（Q-INIT、Q-START、Q-STOP、Q-HOLD、Q-HOTKEY）
- handsFree/translation 的 Cancel 与 Escape 进入 stopping，结束后 idle；finishing 的 Escape 将该 audioId 标为 dismissed，并显示取消提示。状态机区分 recoverable error 与 fatal failure，两者允许重新按 mode 键开始；它不是所有错误都自动重试。（Q-STOP）
- `_a` 将状态映射成 `idle-hidden/hover/starting-microphone/recording/hands-free/*-dictating/error` 等浮条显示态，暴露波形 stream、countdownText、isRefining、dictationMode。代码有 9 分钟录音上限、最后 1 分钟倒计时，低音量检测可转入 no-speech 错误。未验证布局、动画、音效与提示文案的实际呈现。（Q-RECORD；Q 检查视图 4999–5165）

## 三种 mode 与完成后的投递

`VOICE_TRANSCRIPT/VOICE_COMMAND/VOICE_TRANSLATION` 分别映射服务端 `transcript/ask_anything/translation`。Ask 在录音开始时取得选区并发 `selected_text`；翻译发 `output_language`。服务端返回的 `delivery` 决定 Ask 的处理，客户端这里不进行自由形式 intent 分类。（Q-RECORD、Q-MODE、Q-DELIVERY）

| 分支 | 真实可追踪序列 | 静态证据边界 |
| --- | --- | --- |
| 听写 / 翻译 | `Ko → dr`：`ur()` 重新读取 focused app + input → `Ce.l9 → xi.insertText → keyboard-input:insert-text → main Tf.insertText → InputHelper` → 再读取这次结果的 `is_editable`，真时 200ms 后 startTrack，假时按名单决定显示 click-to-copy 卡片 | 插入调用在可编辑性分支之前；无目标内容成功验证 |
| Ask `delivery=replace` | `Ko → $o → Jo`：同样重新取焦点 → `Ce.o9` Markdown 转 HTML 与纯文本 → insertRichText；异常时尝试 plain insert → 再据 editable/名单决定跟踪或 interactive-card | 不保证结果仍写回开始录音时的对象；初始 selectedText 仍可用于卡片显示 |
| Ask `delivery=reply` | `$o → Xo → Uf.xs → page:open-interactive-card`，payload 含 userPrompt、answer、webMetadata、selectedText | 此分支直接打开答案卡片，无插入调用 |
| Ask `delivery=external` | `$o → zo → page:open-url(externalAction.target)` | 所证范围是 URL 打开，不能推广成任意应用动作、脚本或 tool execution |

出处：Q-DELIVERY、Q-FALLBACK、C-INSERT、U-CARD、M-KEYBOARD。`ur()` 是完成时重新读取当前应用/输入，不是仅沿用开始录音时的 editable 判断；若焦点期间变化，代码没有在此处验证 app/element 与开始时一致。

`fr()` 只有 app/url **既不在 best-effort blacklist、也不在 guaranteed-writable whitelist** 时返回真，才显示上述非 editable 卡片；配置可由服务端刷新。故不是“不可编辑一律卡片”，也不是以 native insert return 值决定卡片。（Q-FALLBACK；Q 检查视图 3099–3170）

`Ce.l9` 捕获插入 IPC 异常后只记录 `error_monitoring_keyboard_paste_failed`，不把成功/失败结果返回给 `dr`。`Ce.o9` 仅在 rich insert 抛异常时 fallback plain insert。主进程 `Tf` await InputHelper 但丢弃其返回值。结合另支线的原生证据，不能把“调用完成”“历史 completed”或“没有卡片”当作已经成功投递。（C-INSERT、M-KEYBOARD；原生实证另见[插入核查](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/docs/typeless-insertion-interaction-notes.md)，本文件未重做原生分析）

尤其是 `ia.onRefineCompleted` **先**发送 `WEBSOCKET.REFINE_COMPLETED`，状态机转 idle；随后发起 `Ko(...).catch(...)` 与 `_0x503957` 保存，二者没有在该 callback 被 await。`vo` 保存 refined_text/status=completed 与 ai_result，并清除内存 session；这些标志描述模型结果生命周期，不能证明外部输入已完成。（Q-COMPLETE、Q-SESSION；Q 检查视图 2808–2819、3385–3410）

## Copy、历史与恢复

- 非 editable 听写卡片显示摘要和 Copy 按钮，默认展示时长 999 秒。它本身没有调用复制；点击 `Uo` 才调用 `Ce.a9`：`clipboard:write-text` → main Electron `clipboard.writeText`，失败/异常再用隐藏 textarea 的 `document.execCommand('copy')`。这是一条明确的主动复制路径，不能将 native paste 临时剪贴板误称为自动永久 copy。（U-COPY、C-COPY、M-COPY）
- Ask answer 卡片有主动 Copy，Markdown 转 HTML 后用 DOM `execCommand('copy')`；用户选区复制时去掉 citation UI 节点，再写 text/plain 与 text/html。Escape/Close 关闭卡片。未见本轮卡片组件的通用“执行任意动作”入口。（A-COPY、P-CARD）
- Cancel 提示 `Wo` 的 Undo 和错误/超时提示的 Retry 都调用 `zt`：`db:history-latest-id` → `voice-record-retry` → retry actor 读取 `db:history-get` → 历史含 audio 时进入 finishing → `sendRetryRequest` 压缩历史音频并调 `audio:ai-voice-flow`。这里 Undo 是重新处理音频。另有 dictionary-auto-added Undo 回调，属于不同功能。（U-UNDO、Q-RECORD、Q-STOP；U 检查视图 6516–6586）
- 普通完成采用 WebSocket/延迟 HTTP fallback 的 Promise.race；WebSocket 赢时取消 fallback。`completedAudioIds` 防止同一 audioId 的后续结果重复触发完成 callback。弱网络可立即走 fallback；这证实请求恢复机制，不能证明所有错误下不会重复插入。（U-RACE）
- Hub 历史项可主动复制、重试该条 audioId、下载已有音频、删除；Ask 历史可查看保存的答案，外部动作 `open_url` 可重新打开 URL。历史 Copy 也是独立点击处理。feedback “last transcript” 读取 `db:history-latest`，不是单独的 clipboard 缓存。（H-COPY、H-RECOVERY、H-LATEST；H 检查视图 86259–86285）
- 主进程历史默认 `historyDurationSeconds=-1`，`deleteByDuration(-1)` 不按时间清理；其他值按 created_at 截止时间删除，自动清理保留部分近期未完成记录，启用云同步时跳过该本地定时清理。实际用户设置、组织策略、当前数据库内容均未检查，不能称为实际“永久保存”。（M-RETENTION；M 检查视图 2899–2900、9010–9030）
- `pasteLastTranscript` 默认 Mac `Ctrl+Cmd+V` / Windows `LeftCtrl+RightShift+V`。`Tf.reloadKeyboardShortcuts` 明确排除这个 feature；renderer `pa` 只消费三种 mode feature。本轮对 main、已提取模块和 renderer 成员的 literal 名称作有界检索，仅找到配置/设置显示，没有闭合的执行入口。可能存在未追踪的动态消费者，故 **快捷键实际效果、独立缓存与生命周期未知**。（M-KEYS、M-KEYBOARD、Q-HOTKEY）

## 对 Typefree 的推论与未覆盖项

以上公开产品副本的静态实现可作为设计参照：mode 入口、录音状态、结果载体、主动 Copy、历史重试需要各自明确；“模型已完成”与“文字已写入目标”应成为不同状态。Typefree 若采用上下文结果投递，应明确目标是否锁定，以及何时重新取焦点。结果卡片可成为找回入口，但其显示条件应与真实投递确认分开设计。这些是本项目建议，不是 Typeless 已被运行验证的质量结论。

本轮未覆盖：服务端 prompt/模型决策、Ask delivery 的服务端分类规则、任意平台实际快捷键表现、插入失败率、焦点竞争的实际表现、个人历史/用户设置、全部 UI 路由、完整 Windows 构建与所有动态 shortcut 消费者。没有把 UI 文案、变量名、配置存在或 IPC resolve 冒充实际运行证据。

## 回答卡片的位置（2026-10-11 补核）

`page:open-interactive-card → st.openOrUpdate → If` 的定位依据是**鼠标所在显示器的工作区，底部居中**。这条链没有使用输入光标/选区坐标或当前应用窗口坐标。

- `getTargetDisplay` 调 `screen.getCursorScreenPoint → getDisplayNearestPoint`，读取失败时回退主显示器。这里是鼠标坐标，Electron 明确其返回值为设备无关像素 DIP。[Electron screen](https://www.electronjs.org/docs/latest/api/screen#screengetcursorscreenpoint)
- `buildBounds` 将 800 DIP 宽的透明窗口容器在 workArea 中水平居中；窗口底部设为工作区底部减 20 DIP。高度受工作区约束，x/y 也有边界限制；代码没有把宽度随极窄工作区缩小。
- `setupMouseTracking` 每 100ms 检查鼠标所在显示器；显示器 ID 改变时调用 `moveWindowToDisplay`，卡片移动到新屏底部中央。鼠标在同一屏移动不触发持续贴着鼠标的定位。关闭卡片时停止该定时器。
- 卡片组件自身设宽 744 CSS px，高度下限 400、上限 700；回答区可以滚动。透明窗口外层另有 `24px 8px 64px` 留白，所以正常布局中可见卡片底部比窗口底部再上移 64 DIP。
- renderer 用隐藏测量区域与 ResizeObserver 报告内容高度；主进程以 80ms 防抖更新窗口高度，保持底部锚点不变。变化在 2 DIP 内不重新 setBounds。新建窗口先有初始尺寸，随后按测量结果调整；已有窗口只更新 payload/show，再由内容测量修正尺寸。
- `If` 窗口无边框、透明、置顶、不可调整大小，配置 focusable=true；macOS 路径还设所有工作区/全屏可见。没有把这些配置解读为实际不会抢焦点或各平台均表现相同。

补充锚点仍使用上文 M/P/A 的原始 SHA-256；本次重算派生 hash 与上文一致。以下原始字节区间零起点、尾端不含，脚本 `/private/tmp/typeless-card-placement-map.mjs` 按既有 token/替换规则核对映射：

| Anchor | 检查视图行 | 原始字节区间 | 内容 |
| --- | --- | --- | --- |
| M-CARD-LAYOUT | M 8208–8298 | 336900–341257 | 屏幕选择、鼠标跟踪、底部锚点和窗口选项 |
| M-CARD-UPDATE | M 8299–8354 | 341257–343699 | 尺寸防抖、更新 payload、关闭与停止跟踪 |
| M-CARD-IPC | M 12504–12508 | 592999–593594 | 卡片开启/关闭/高度更新 IPC |
| P-CARD-MEASURE | P 14–66 | 252–2117 | 留白常量、ResizeObserver 内容测量 |
| P-CARD-CONTAINER | P 80–108 | 2334–3708 | 底部对齐的透明容器 |
| A-CARD-STYLE | A 490–510 | 25018–26688 | 744px 卡片宽度与 min/max 高度引用 |

400/700 高度常量在 A 检查视图 line 16，滚动回答区域在 line 553。以上仍是本机 macOS 2.8.1 副本的静态事实，没有跨显示器实机观察。
