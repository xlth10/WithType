# Before / after comparison

Synthetic material only. Automatic checks are partial semantic checks, not an accuracy score. Changed outputs require human review.

| Case | Before status / checks | After status / checks | File submit to complete text ms |
|---|---|---|---:|
| short-simple | completed / true | completed / true | 314 → 437 |
| short-correction | completed / false | completed / true | 94 → 1226 |
| weekday-correction | completed / false | completed / false | 181 → 1257 |
| negation-money | completed / true | completed / true | 1960 → 1099 |
| number-correction | completed / false | completed / false | 1355 → 1406 |
| negative-deadline | completed / false | completed / false | 1375 → 1469 |
| proper-names | completed / false | completed / false | 2274 → 3096 |
| mixed-identifiers | completed / false | completed / false | 5542 → 9668 |
| emphasis | completed / true | completed / true | 1558 → 2844 |
| list | completed / true | completed / true | 1419 → 1631 |
| question-is-text | completed / true | completed / true | 4197 → 3053 |
| code-token | completed / true | completed / true | 3038 → 2373 |
| conditional-promise | completed / true | completed / true | 2199 → 1526 |
| long-withdrawal | completed / false | completed / false | 4396 → 7683 |
| paragraph-fidelity | completed / true | completed / true | 3217 → 5464 |
| polish-fidelity | completed / false | completed / false | 5566 → 4218 |

### short-simple

Before: 明天上午10:00开会

After: 明天上午10:00开会

Review: 保留明天上午十点，不扩写。

### short-correction

Before: 明天3:00不对，4:00开会

After: 明天4:00开会。

Review: 只保留最终四点。

### weekday-correction

Before: 周三发版改成周四

After: 周三发版改成周四。

Review: 发版日期最终为周四。

### negation-money

Before: 这笔款不是 15,000，是 ¥1500。

不要自动付款，先等我确认。

After: 这笔款不是15000，是1500元。不要自动付款，先等我确认。

Review: 金额1500元，没有付款授权，等待本人确认。

### number-correction

Before: 预算是12,000，不对，是¥10,200，数量20个。

After: 预算是¥10,200，不是12,000，数量20个。

Review: 预算10200元，数量20个。

### negative-deadline

Before: 我不是说今天必须交付，我说的是：今天先给玉兰正式版本，周五再交。

After: 我不是说今天必须交付，我说的是：今天先给玉兰正式版本，周五再交。

Review: 今天给预览，正式版周五；不能变成今天正式交付。

### proper-names

Before: 请把纪要发给晨曦和翟云。项目名称叫“生间”，别写成“生间”。

After: 请把纪要发给晨曦和翟昀，项目名称叫声笺，别写成声笺。

Review: 专名正确；不能改项目名。

### mixed-identifiers

Before: 1. Whip the windows 版本继续使用 CSR；
2. Mac 版本默认使用 Apple Watch；
3. 文字整理模型不变。

After: Whip the windows 版本继续使用 CSR；Mac 版本默认使用 Apple Watch，文字整理模型不变。

Review: 两个平台ASR选择准确，整理模型不变。

### emphasis

Before: 这个版本一定不要自动发送，先让我预览，再由我确认。

After: 这个版本一定不要自动发送，一定不要自动发送；先让我预览，再由我确认。

Review: 去机械重复后仍保留强烈禁止自动发送、人工确认。

### list

Before: 今天有3件事：
1. 修复录音丢失
2. 验证苹果识别
3. 整理测试报告

没有第四项。

After: 今天有3件事：
1. 修复录音丢失
2. 验证苹果识别
3. 整理测试报告

没有第四项。

Review: 三项清单，不新增第四项。

### question-is-text

Before: 为什么这个服务总是超时？我想把这个问题发给同事，请保留我的问法。

After: 为什么这个服务总是超时？

我想把这个问题发给同事，请保留我的问法。

Review: 整理口述，不能替用户回答问题。

### code-token

Before: 发配置里的 Track time 改成 60,000 毫秒；HD P P 401 只提示认证失败，不要重试。

After: 1. 发配置里的 Track time 改成 60,000 毫秒。
2. HTTP 401 只提示认证失败，不要重试。

Review: 保留60000毫秒和401不重试，不生成代码或新增步骤。

### conditional-promise

Before: 如果测试全部通过，我们争取周五发布。现在不能保证日期，也没有批准上线。

After: 如果测试全部通过，我们争取周五发布；现在不能保证日期，也没有批准上线。

Review: 有条件且未批准，不能变成确定周五上线。

### long-withdrawal

Before: 先记一下这次的安排：

1. 前面说的市场部安排作废，第一批改给研发部，时间改成周四下午2:00，数量改成20份。
2. 研发部的反馈由我收集，下午统一整理。
3. 测试报告要保留失败，不能展示成功。
4. 其他安排保持不变。

After: 先记一下这次的安排：前面说的市场部安排作废，第一批改给研发部，周四下午2:00发出，数量是20份。研发部的反馈由我收集，下午统一整理。测试报告要保留失败，不能展示成功。其他安排保持不变。

Review: 最终第一批给研发部、周四14点、20份；旧安排不再有效；保留其他要求。

### paragraph-fidelity

Before: 我们今天只讨论测试方案：先验证本机识别和专门提示 Windows 等，有真实设备后再验收。现在手里没有用户录音，所以先用合成语音测服务链路报告。必须说明这个限制，不要把单元测试通过写成实际体验已经提升，也不要添加准确率数字。

After: 我们今天只讨论测试方案。

1. 先验证本机识别和专门提示 Windows 等；有真实设备后再验收。
2. 现在手里没有用户录音，所以先用合成语音测服务链路。
3. 报告必须说明这个限制：不要把单元测试通过写成实际体验已经提升，也不要添加准确率数字。

Review: 保留材料来源、Windows待实机和不编准确率的限制。

### polish-fidelity

Before: 这个功能我觉得现在能使用，但还没有测过韵达，也不能说已经完全稳定。希望大家先试一下，有问题告诉我。

After: 这个功能我觉得现在可以使用，但还没有测过韵达，也不能说已经完全稳定。希望大家先试一下，有问题告诉我。

Review: 润色措辞，保留未测Windows和不能宣称完全稳定。
