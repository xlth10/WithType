# WithType pipeline benchmark

Label: baseline; platform: macos; material: synthetic speech.

Execution: audio-to-real-asr-to-real-model

Source: 534b3d7f067355934760190badc391f5b0baaa40

Completed 16/16; automatic checks passed 8. Human semantic review remains required.

| Case | Status | Auto checks | ASR ms | Text ms | File submit to ready ms |
|---|---|---|---:|---:|---:|
| short-simple | completed | true | 357.7239513397217 | 0 | 365 |
| short-correction | completed | false | 90.55805206298828 | 0 | 95 |
| weekday-correction | completed | false | 171.7679500579834 | 0 | 174 |
| negation-money | completed | true | 177.15907096862793 | 11396 | 11578 |
| number-correction | completed | false | 225.12900829315186 | 7901 | 8142 |
| negative-deadline | completed | false | 397.737979888916 | 7484 | 7895 |
| proper-names | completed | false | 743.278980255127 | 7806 | 8571 |
| mixed-identifiers | completed | false | 807.0100545883179 | 4414 | 5235 |
| emphasis | completed | true | 266.64507389068604 | 1980 | 2264 |
| list | completed | true | 312.52598762512207 | 1710 | 2035 |
| question-is-text | completed | true | 506.13200664520264 | 3563 | 4082 |
| code-token | completed | true | 1037.7110242843628 | 2438 | 3489 |
| conditional-promise | completed | true | 303.84504795074463 | 1108 | 1431 |
| long-withdrawal | completed | false | 1147.3439931869507 | 1874 | 3058 |
| paragraph-fidelity | completed | true | 707.2240114212036 | 5432 | 6162 |
| polish-fidelity | completed | false | 619.4299459457397 | 3228 | 3866 |

- 合成语音不能代替真人口音、噪声和麦克风测试。
- 自动断言只检查局部事实和格式，需人工复核语义。
- 文件识别计时不代表录音中预识别后的松手延迟。
- 既有WAV的文件识别；没有实测录音中分段预识别。
- 投递使用输出收集器，未触发剪贴板、焦点捕获或OS粘贴。
- 温度沿用产品0.2；单次结果仍受模型服务波动影响。

Full stage text and service-call timings: results.jsonl.

Timing scope: existing audio-file submission to complete text; no recording-time ASR overlap or OS delivery measured.
