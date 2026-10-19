# WithType pipeline benchmark

Label: optimized-v2-text; platform: macos; material: synthetic speech.

Execution: reference-text-to-real-model

Source: 534b3d7f067355934760190badc391f5b0baaa40

Completed 8/8; automatic checks passed 8. Human semantic review remains required.

| Case | Status | Auto checks | ASR ms | Text ms | Ready ms |
|---|---|---|---:|---:|---:|
| short-correction | completed | true | 0 | 749 | 751 |
| weekday-correction | completed | true | 0 | 598 | 598 |
| negation-money | completed | true | 0 | 992 | 992 |
| number-correction | completed | true | 0 | 733 | 733 |
| negative-deadline | completed | true | 0 | 842 | 843 |
| emphasis | completed | true | 0 | 1281 | 1281 |
| conditional-promise | completed | true | 0 | 957 | 957 |
| quoted-retraction | completed | true | 0 | 1242 | 1243 |

- Reference text supplied directly; ASR is not executed in this run.
- Real existing text model and actual source-tree pipeline route are executed.
- Checks are partial facts; human semantic review is required.
- ASR未执行，输入为固定口述参考文本，只比较真实文字模型和产品路由。
- 投递使用输出收集器，未触发剪贴板、焦点捕获或OS粘贴。
- 温度沿用产品0.2；单次结果仍受模型服务波动影响。

Full stage text and service-call timings: results.jsonl.
