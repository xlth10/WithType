# WithType pipeline benchmark

Label: optimized-v2-withdrawal; platform: macos; material: synthetic speech.

Execution: reference-text-to-real-model

Source: 534b3d7f067355934760190badc391f5b0baaa40

Completed 3/3; automatic checks passed 3. Human semantic review remains required.

| Case | Status | Auto checks | ASR ms | Text ms | File submit to ready ms |
|---|---|---|---:|---:|---:|
| discard-earlier | completed | true | 0 | 1123 | 1125 |
| previous-unused | completed | true | 0 | 1204 | 1205 |
| all-withdrawn | completed | true | 0 | 1230 | 1230 |

- 固定参考文字，不执行ASR。
- 调用真实现有文字模型，不代表录音中增量缓存已完成实机验收。
- 局部语义断言之外仍需人工复核。
- ASR未执行，输入为固定口述参考文本，只比较真实文字模型和产品路由。
- 投递使用输出收集器，未触发剪贴板、焦点捕获或OS粘贴。
- 温度沿用产品0.2；单次结果仍受模型服务波动影响。

Full stage text and service-call timings: results.jsonl.
