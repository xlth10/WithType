# WithType pipeline benchmark

Label: optimized; platform: macos; material: synthetic speech.

Execution: audio-to-real-asr-to-real-model

Source: 534b3d7f067355934760190badc391f5b0baaa40

Completed 16/16; automatic checks passed 10. Human semantic review remains required.

| Case | Status | Auto checks | ASR ms | Text ms | File submit to ready ms |
|---|---|---|---:|---:|---:|
| short-simple | completed | true | 397.678017616272 | 0 | 405 |
| short-correction | completed | true | 132.92694091796875 | 991 | 1133 |
| weekday-correction | completed | false | 181.23602867126465 | 1299 | 1488 |
| negation-money | completed | true | 226.27902030944824 | 1329 | 1568 |
| number-correction | completed | true | 228.48904132843018 | 1091 | 1335 |
| negative-deadline | completed | false | 312.7009868621826 | 1026 | 1351 |
| proper-names | completed | false | 585.3840112686157 | 1976 | 2577 |
| mixed-identifiers | completed | false | 712.0890617370605 | 2145 | 2870 |
| emphasis | completed | true | 265.205979347229 | 1237 | 1513 |
| list | completed | true | 306.6220283508301 | 1256 | 1576 |
| question-is-text | completed | true | 270.25294303894043 | 1332 | 1615 |
| code-token | completed | true | 489.64202404022217 | 3636 | 4145 |
| conditional-promise | completed | true | 270.49100399017334 | 1180 | 1464 |
| long-withdrawal | completed | false | 1116.8090105056763 | 8063 | 9223 |
| paragraph-fidelity | completed | true | 757.0910453796387 | 2133 | 2923 |
| polish-fidelity | completed | false | 569.3520307540894 | 894 | 1479 |

- 合成语音不能代替真人口音、噪声和麦克风测试。
- 自动断言只检查局部事实和格式，需人工复核语义。
- 文件识别计时不代表录音中预识别后的松手延迟。
- 既有WAV的文件识别；没有实测录音中分段预识别。
- 投递使用输出收集器，未触发剪贴板、焦点捕获或OS粘贴。
- 温度沿用产品0.2；单次结果仍受模型服务波动影响。

Full stage text and service-call timings: results.jsonl.

Timing scope: existing audio-file submission to complete text; no recording-time ASR overlap or OS delivery measured.
