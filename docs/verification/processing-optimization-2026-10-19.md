# Mac / Windows 处理链路优化交付

日期：2026-10-19。原工作区仍在 main，本次没有覆盖原工作区、安装新应用或修改现有服务配置。当前未提交源码先以独立 index 保存为基线 `534b3d7f067355934760190badc391f5b0baaa40`，原 HEAD 和暂存区保持不变。

## 工作树与模型边界

| 用途 | 分支 | 工作树 |
| --- | --- | --- |
| Mac 优化 | `codex/processing-macos-20261019` | `/Users/outsider/.codex/worktrees/withtype-pipeline-macos/15-withtype` |
| Windows 优化 | `codex/processing-windows-20261019` | `/Users/outsider/.codex/worktrees/withtype-pipeline-windows/15-withtype` |
| 共用实现与实测归档 | `codex/processing-common-20261019` | `/Users/outsider/.codex/worktrees/withtype-pipeline-common/15-withtype` |
| 优化前基线 | `codex/processing-baseline-20261019` | `/Users/outsider/.codex/worktrees/withtype-pipeline-baseline/15-withtype` |

Mac 新装、缺省和没有配置云端地址的情况默认 Apple 本机 ASR；显式配置完整的兼容服务仍可选用。Windows 保留现有专有模型和 `model + file` 请求，没有加入未经服务验证的热词私有参数。文字主模型、快模型、备用模型、地址与认证方式不因升级改变；本机实测沿用现有 `deepseek-flash`。

共用实现提交为 `9bac94dad93e44b0ceb18edafaebfe6401b2d896`，分别同步到两端独立分支。平台逻辑通过原生 cfg 和平台归一化分开，共用文字规则保持一致。

## 已完成的改动

1. 录音结果明确区分完整、部分和失败。尾段失败保留错误和已识别文字，不再作为完整成功自动输入；设备中断时已有文字也按部分结果呈现。部分失败录音保留在可恢复暂存区，既不释放，也不写入会隐藏恢复项的 `history.keep`。
2. 默认整理按明确改口/撤回信号进入已有文字模型，简单短句继续直出。补充日期、时间、金额替换规则以及否定、强调、引用的正反例；不新增一轮意图分类，也不更换文字模型。
3. 自动纠正一次有效近音短词后保存正确热词，不生成新强制替换。手动和旧版替换规则保留；支持去重、删除后不自动学回、数量边界和持久化。Apple 在录音开始、分段及重试时接收同一快照的 `contextualStrings`。
4. 保留真正 ASR 返回、词库后、文字模型后三个阶段，历史可以查看处理前后。最终词库修正前的模型文字单独记录。
5. 后文出现明确撤回时废弃已提前整理的缓存，避免只处理尾部而保留被推翻的旧段。录音中提前整理仍默认关闭。
6. 提供隔离的真实服务测试工具、固定音频、源文件指纹及 Windows 一键验收入口。benchmark 二进制需要显式 feature，正式 Mac 包不包含它。

## 效果实测

材料为同一组16条固定合成语音；真实调用 Apple 设备端识别与现有文字模型。最终比较中基线和最终版各运行两轮，另保留中间版本迭代数据。

| 项目 | 基线 | 最终版 |
| --- | --- | --- |
| 每轮局部自动检查通过 | 8/16、8/16 | 11/16、11/16 |
| 明天三点，不对，四点开会 | 保留两个时间与改口过程 | 明天4:00开会 |
| 周三发版，改成周四 | 保留原句 | 周四发版 |
| 预算12000改10200，数量20 | 保留旧金额和改口过程 | 保留10200与20 |
| 部分专名 | 翟云、生间、HD PP | 翟昀、声笺、HTTP |

这是固定小样本的局部检查，不能解释成总体准确率。局部规则仍有格式漏报，自动检查通过也不意味着全文保真。残余包括“预览→玉兰”、品牌名/中英混说、岑溪误识，以及“不能只展示”丢失“只”；热词有偏置风险，并不能保证准确识别引用中的误写词。

基线两轮文件提交到完整成稿 p50 为3489/1960 ms，最终为1722/1822 ms；p95基线11578/5566 ms，最终5936/4661 ms。运行次数不足且服务有波动，不宣称稳定提速。这也不是麦克风停止到上屏的实际时延。

另以固定参考文字真实调用现有模型：8条保真案例、3条撤回及最终源码5条烟测的局部检查全部通过。缓存失效、取消、部分失败和恢复另由单元/集成测试验证，不混写为真实录音故障测试。

完整数据：[最终实测报告](pipeline-benchmark-2026-10-19/FINAL-v2.md)、[原始音频和hash](pipeline-benchmark-2026-10-19/audio/audio-manifest.json)。包括全部阶段文本、两轮基线、两轮中间版本、两轮最终版和人工复核。

## 工程验证与使用边界

- JavaScript：284项，280通过、4项Windows专用测试在Mac跳过。
- Rust原生：83项通过，含热词、取消、尾段边界和完整性状态。
- Mac前端生产构建、Tauri release App、外观校验与签名校验通过。目标为arm64、macOS14以上；正式包内只有withtype主程序。
- Windows完整交叉编译因本机缺Windows SDK的`assert.h`未通过。没有Windows设备、虚拟机或真实ASR地址；按用户最新指示，本轮暂缓Windows服务和客户端实测，未以Mac结果代替。
- 本轮使用文件识别和结果收集器，没有验收真实麦克风、快捷键、焦点、UIA或目标应用自动投递。独立测试App授权不等于产品App已获得Speech授权。
- 未自动开启正文上下文采集或尾段并发；这两项需要对应平台/服务的进一步实测，不以未经测量的改动换取表面指标。

Mac构建详情：[构建验证](../testing/macos-processing-build-2026-10-19.md)。Windows入口：[verify-windows-processing.ps1](../../scripts/verify-windows-processing.ps1)，具体待验收项见[Windows说明](windows-processing-2026-10-19.md)。

新Apple SpeechAnalyzer也做了只读探查：当前中文模块还需下载资源，未引入正式路径，保留macOS14兼容。详见[可行性证据](../testing/speech-analyzer-feasibility-2026-10-19.md)。
