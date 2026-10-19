# WithType pipeline benchmark

Label: optimized-v2-audio; platform: macos; material: synthetic speech.

Execution: audio-to-real-asr-to-real-model

Source: 534b3d7f067355934760190badc391f5b0baaa40

Completed 16/16; automatic checks passed 11. Human semantic review remains required.

| Case | Status | Auto checks | ASR ms | Text ms | File submit to ready ms |
|---|---|---|---:|---:|---:|
| short-simple | completed | true | 396.2390422821045 | 0 | 403 |
| short-correction | completed | true | 130.22398948669434 | 876 | 1010 |
| weekday-correction | completed | true | 178.76899242401123 | 902 | 1088 |
| negation-money | completed | true | 267.9760456085205 | 1248 | 1528 |
| number-correction | completed | true | 219.07293796539307 | 1679 | 1910 |
| negative-deadline | completed | false | 399.1290330886841 | 910 | 1321 |
| proper-names | completed | false | 778.1870365142822 | 3035 | 3825 |
| mixed-identifiers | completed | false | 715.1210308074951 | 3037 | 3760 |
| emphasis | completed | true | 261.7230415344238 | 853 | 1122 |
| list | completed | true | 396.1360454559326 | 1407 | 1818 |
| question-is-text | completed | true | 226.42898559570312 | 1708 | 1947 |
| code-token | completed | true | 391.6879892349243 | 1311 | 1722 |
| conditional-promise | completed | true | 270.2399492263794 | 1176 | 1461 |
| long-withdrawal | completed | false | 941.6249990463257 | 4042 | 5022 |
| paragraph-fidelity | completed | true | 714.6199941635132 | 5189 | 5936 |
| polish-fidelity | completed | false | 482.8530550003052 | 2734 | 3231 |

- 合成语音不能代替真人口音、噪声和麦克风测试。
- 自动断言只检查局部事实和格式，需人工复核语义。
- 文件识别计时不代表录音中预识别后的松手延迟。
- 既有WAV的文件识别；没有实测录音中分段预识别。
- 投递使用输出收集器，未触发剪贴板、焦点捕获或OS粘贴。
- 温度沿用产品0.2；单次结果仍受模型服务波动影响。

Full stage text and service-call timings: results.jsonl.
