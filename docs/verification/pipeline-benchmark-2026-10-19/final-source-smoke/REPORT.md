# WithType pipeline benchmark

Label: final-source-smoke; platform: macos; material: synthetic speech.

Execution: reference-text-to-real-model

Source: 534b3d7f067355934760190badc391f5b0baaa40

Completed 5/5; automatic checks passed 5. Human semantic review remains required.

| Case | Status | Auto checks | ASR ms | Text ms | File submit to ready ms |
|---|---|---|---:|---:|---:|
| short-correction | completed | true | 0 | 430 | 432 |
| weekday-correction | completed | true | 0 | 571 | 572 |
| discard-earlier | completed | true | 0 | 1172 | 1172 |
| previous-unused | completed | true | 0 | 932 | 932 |
| all-withdrawn | completed | true | 0 | 942 | 942 |

- Reference-text isolation; no ASR or OS delivery in this run.
- ASR未执行，输入为固定口述参考文本，只比较真实文字模型和产品路由。
- 投递使用输出收集器，未触发剪贴板、焦点捕获或OS粘贴。
- 温度沿用产品0.2；单次结果仍受模型服务波动影响。

Full stage text and service-call timings: results.jsonl.
