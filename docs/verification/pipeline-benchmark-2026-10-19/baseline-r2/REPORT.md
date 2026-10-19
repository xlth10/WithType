# WithType pipeline benchmark

Label: baseline-r2; platform: macos; material: synthetic speech.

Execution: audio-to-real-asr-to-real-model

Source: 534b3d7f067355934760190badc391f5b0baaa40

Completed 16/16; automatic checks passed 8. Human semantic review remains required.

| Case | Status | Auto checks | ASR ms | Text ms | File submit to ready ms |
|---|---|---|---:|---:|---:|
| short-simple | completed | true | 308.64906311035156 | 0 | 314 |
| short-correction | completed | false | 90.47102928161621 | 0 | 94 |
| weekday-correction | completed | false | 178.2439947128296 | 0 | 181 |
| negation-money | completed | true | 221.50206565856934 | 1734 | 1960 |
| number-correction | completed | false | 217.37098693847656 | 1129 | 1355 |
| negative-deadline | completed | false | 269.8019742965698 | 1092 | 1375 |
| proper-names | completed | false | 625.330924987793 | 1640 | 2274 |
| mixed-identifiers | completed | false | 907.5590372085571 | 4623 | 5542 |
| emphasis | completed | true | 354.92897033691406 | 1176 | 1558 |
| list | completed | true | 314.0310049057007 | 1091 | 1419 |
| question-is-text | completed | true | 266.5979862213135 | 3923 | 4197 |
| code-token | completed | true | 669.1180467605591 | 2354 | 3038 |
| conditional-promise | completed | true | 347.9069471359253 | 1842 | 2199 |
| long-withdrawal | completed | false | 972.0110893249512 | 3387 | 4396 |
| paragraph-fidelity | completed | true | 875.4589557647705 | 2325 | 3217 |
| polish-fidelity | completed | false | 491.06693267822266 | 5057 | 5566 |

- 合成语音不能代替真人口音、噪声和麦克风测试。
- 自动断言只检查局部事实和格式，需人工复核语义。
- 文件识别计时不代表录音中预识别后的松手延迟。
- 既有WAV的文件识别；没有实测录音中分段预识别。
- 投递使用输出收集器，未触发剪贴板、焦点捕获或OS粘贴。
- 温度沿用产品0.2；单次结果仍受模型服务波动影响。

Full stage text and service-call timings: results.jsonl.

Timing scope: existing audio-file submission to complete text; no recording-time ASR overlap or OS delivery measured.
