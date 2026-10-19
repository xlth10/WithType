# WithType pipeline benchmark

Label: optimized-r2; platform: macos; material: synthetic speech.

Execution: audio-to-real-asr-to-real-model

Source: 534b3d7f067355934760190badc391f5b0baaa40

Completed 16/16; automatic checks passed 9. Human semantic review remains required.

| Case | Status | Auto checks | ASR ms | Text ms | File submit to ready ms |
|---|---|---|---:|---:|---:|
| short-simple | completed | true | 429.2430877685547 | 0 | 437 |
| short-correction | completed | true | 131.0790777206421 | 1090 | 1226 |
| weekday-correction | completed | false | 217.4469232559204 | 1036 | 1257 |
| negation-money | completed | true | 218.4070348739624 | 868 | 1099 |
| number-correction | completed | false | 257.1300268173218 | 1143 | 1406 |
| negative-deadline | completed | false | 303.66504192352295 | 1156 | 1469 |
| proper-names | completed | false | 613.239049911499 | 2465 | 3096 |
| mixed-identifiers | completed | false | 829.7159671783447 | 8826 | 9668 |
| emphasis | completed | true | 267.1470642089844 | 2560 | 2844 |
| list | completed | true | 426.5190362930298 | 1193 | 1631 |
| question-is-text | completed | true | 314.1310214996338 | 2715 | 3053 |
| code-token | completed | true | 575.2500295639038 | 1778 | 2373 |
| conditional-promise | completed | true | 395.1759338378906 | 1120 | 1526 |
| long-withdrawal | completed | false | 3337.6541137695312 | 4307 | 7683 |
| paragraph-fidelity | completed | true | 1479.198932647705 | 3943 | 5464 |
| polish-fidelity | completed | false | 874.6739625930786 | 3266 | 4218 |

- 合成语音不能代替真人口音、噪声和麦克风测试。
- 自动断言只检查局部事实和格式，需人工复核语义。
- 文件识别计时不代表录音中预识别后的松手延迟。
- 既有WAV的文件识别；没有实测录音中分段预识别。
- 投递使用输出收集器，未触发剪贴板、焦点捕获或OS粘贴。
- 温度沿用产品0.2；单次结果仍受模型服务波动影响。

Full stage text and service-call timings: results.jsonl.

Timing scope: existing audio-file submission to complete text; no recording-time ASR overlap or OS delivery measured.
