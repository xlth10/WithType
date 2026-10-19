# WithType pipeline benchmark

Label: optimized-v2-audio-r2; platform: macos; material: synthetic speech.

Execution: audio-to-real-asr-to-real-model

Source: 534b3d7f067355934760190badc391f5b0baaa40

Completed 16/16; automatic checks passed 11. Human semantic review remains required.

| Case | Status | Auto checks | ASR ms | Text ms | File submit to ready ms |
|---|---|---|---:|---:|---:|
| short-simple | completed | true | 401.326060295105 | 0 | 411 |
| short-correction | completed | true | 134.41801071166992 | 1071 | 1213 |
| weekday-correction | completed | true | 223.47509860992432 | 920 | 1151 |
| negation-money | completed | true | 263.2640600204468 | 1781 | 2066 |
| number-correction | completed | true | 215.3940200805664 | 1297 | 1523 |
| negative-deadline | completed | false | 353.6059856414795 | 1172 | 1536 |
| proper-names | completed | false | 619.6930408477783 | 2090 | 2725 |
| mixed-identifiers | completed | false | 752.1610260009766 | 3744 | 4515 |
| emphasis | completed | true | 218.095064163208 | 1595 | 1822 |
| list | completed | true | 316.2959814071655 | 1140 | 1471 |
| question-is-text | completed | true | 268.42308044433594 | 1576 | 1858 |
| code-token | completed | true | 400.7300138473511 | 1900 | 2318 |
| conditional-promise | completed | true | 308.99500846862793 | 941 | 1263 |
| long-withdrawal | completed | false | 977.6359796524048 | 3653 | 4661 |
| paragraph-fidelity | completed | true | 794.9680089950562 | 1149 | 1975 |
| polish-fidelity | completed | false | 534.775972366333 | 2021 | 2567 |

- 合成语音不能代替真人口音、噪声和麦克风测试。
- 自动断言只检查局部事实和格式，需人工复核语义。
- 文件识别计时不代表录音中预识别后的松手延迟。
- 既有WAV的文件识别；没有实测录音中分段预识别。
- 投递使用输出收集器，未触发剪贴板、焦点捕获或OS粘贴。
- 温度沿用产品0.2；单次结果仍受模型服务波动影响。

Full stage text and service-call timings: results.jsonl.
