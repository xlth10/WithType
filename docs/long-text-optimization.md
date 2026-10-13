# 长文本完整性与时延优化

实施日期：2026-10-11。用户授权依据为 Typeless 对照研究；本次优化当前 Typefree Windows 项目，没有修改参考仓库或外部应用。

## 已实施

- 普通智能整理优先使用配置中的快速模型，技能、生成命令和问答保留主模型路由；快速模型未配置时使用主模型。
- 智能整理与翻译超长输入按语义边界分段，保留每一个原文单元、Unicode 与顺序。请求包含最多 500 个 UTF-16 单元的前一段录音文本作为参考；分段结果按顺序合并，只有全部成功才投递。需要全文规划的任务超限明确失败，普通口述可保留完整原文。
- 分类、分段与备用模型共享一个文字阶段截止时间；每次调用按剩余模型数分配剩余预算。JS 和 Rust 都限制本次调用，Rust 限制也覆盖不支持 SSE 时的普通响应回退。语音识别使用共享 HTTP Client，ASR 继续串行提交 WAV。
- 增加普通文字任务的 SSE 预览。调用 ID 与录音任务 ID 分开，迟到调用的流式消息会被拒绝；不会将预览直接写入目标窗口。流结束缺少完成标记、finish_reason 指示截断/过滤、输出超过上限时判为失败，避免半篇成功。
- 可选录音中提前整理：仅普通智能整理且自动意图关闭时，原生 ASR 发出稳定文本事件；至少积累 300 个有效字符并保留最后一句未定尾段，文字请求串行执行。结束时验证缓存前缀与最终原文一致，复用成功段，处理剩余尾段。失配、失败、翻译口令或取消时不投递缓存草稿。
- 停止按键到识别就绪、完整成稿、粘贴完成分别计时；记录分类耗时、文字请求数、模型列表、输入输出长度、首字耗时与复用段数，随历史保存。原生 stop 中的 ASR 等待不再记成编码耗时，也不累加录音期间的 ASR 请求时间作为最终等待。

## 使用

在「文字模型」填写适合普通整理的快速模型，主模型用于更复杂的任务。总等待预算作用于整个文字阶段；若配置多个备用模型，各次尝试不再独占完整预算。

流式预览默认开启，可在概览查看，最终一次粘贴。「录音期间提前整理」默认关闭，可在该页开启；会增加请求，应先用少量长文核对模型吞吐、数字、否定与跨段衔接质量。它在浏览器预览、复杂 skill、翻译和自动意图判断中不提前处理。

当前没有添加厂商私有推理参数、预测输出或目标输入框/剪贴板/屏幕内容上传。这些需要额外服务契约或产品边界设计。本轮增加的衔接上下文只来自本次录音原文。

## 验证

基线 138 个 JS 测试通过。先用新增回归测试复现了裁尾、smart 未使用快模型、备用请求未共享总预算，再实施修复。

覆盖的关键路径包括超长原文覆盖、Unicode 分段、后段失败整体回退、复杂任务超限、提前整理复用、最终 ASR 前缀修改、末尾翻译口令、后台取消、流式迟到与截断、停止后真实计时、配置持久化。

测试使用合成文本和注入式服务，没有调用真实付费模型、读取用户密钥、录音或向目标应用投递测试文字。

- `npm test`：152 个测试通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --offline --lib`：22 个测试通过。
- `npm run build` 与 `cargo check --manifest-path src-tauri/Cargo.toml --offline`：通过。
- 修改后的真实 `audio.rs` 在独立 Windows MSVC 类型检查环境中通过；仅替换未改动的加密/HTTP依赖为签名相同的检查 stub，没有将其称作 Windows 运行验收。
- 本地浏览器核对文字模型设置页，确认快模型提示、预算、流式开启和提前整理关闭可见，未触发模型连接测试或麦克风权限。

完整 Windows 项目类型检查在 `ring` 的 C 编译处失败：此 Mac 缺少 Windows SDK 的 `assert.h`。没有构建或运行 Windows EXE。真实服务下的完整成稿速度、模型质量、设备和跨应用投递仍需 Windows 实机测试；本次不声明固定秒数或倍数提升。

## 相关源码

- [任务与缓存生命周期](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/dictation/pipeline.js)
- [原文分段](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src/text/segments.js)
- [文字请求与流式传输](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/text_api.rs)
- [流式完成状态](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/src-tauri/src/text_stream.rs)
- [回归测试](/Users/outsider/codex_projects/emergence-lab/projects/15-withtype/tests/text-latency.test.mjs)
