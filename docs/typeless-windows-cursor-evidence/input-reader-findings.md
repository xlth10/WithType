# Typeless Windows InputHelper.dll 光标/选区读取补充

仅静态证据。ImageBase0x180000000；vtable offset已按Microsoft官方UIAutomationClient.h核对。

调用链主线程已追：getCurrentInputState导出0xf440→0xf6c0→0x10760→0x14e10。

## 文字容器定位

- `0x14f93`: IUIAutomation.GetFocusedElement(+0x40)，得到focused element。此处失败/空进入无焦点错误路径，尚未看到ContextHelper那条HWND降级在该函数中直接重用。
- `0x15200`: call `0x12600` 尝试寻找Text provider。
- `0x12654`: call`0x16ec0`，后者`0x16ef3/0x16f1d`实际GetCurrentPattern(Text10014/Text2 10024)。当前元素支持时AddRef并返回。
- 不支持时 `0x126b2` Automation.get_RawViewWalker(+0x80)；`0x126de` TreeWalker.GetParentElement(+0x18)，父元素检查Text/Text2 (`0x12714/0x12740`)。
- 还未找到则 `0x12812` Automation.CreateTrueCondition(+0xa8)；`0x12843` focusedElement.FindAll(+0x30,scope2 Children,trueCondition)；逐子元素检查 Text/Text2 (`0x128e4/0x1290e`)。
- 再尝试 `0x129fc` focusedElement.GetCurrentPattern(TextChild10029)，QueryInterface为TextChild；`0x12a4e` TextChild.get_TextContainer(+0x18)，检查该container Text/Text2 (`0x12a87/0x12ab4`)。

## 两种选区与周边读取实现

`0x14e10`的`0x15357`调用`0x12b80`；结果不为空标记ByRange (optimized version)。空结果且尚未超时（`0x15412` call timeout check `0x11d90`、检查返回值）则 `0x15451`调用`0x13d20`，标记ByUnit (fallback version)。不是只有策略字符串存在。

ByRange（RVA0x12b80）：

- `0x12c25`取Text10014、QI TextPattern；`0x12c6a`也取Text2 10024（这路未看到直接调用GetCaretRange）。
- `0x12cee` Text.DocumentRange(+0x38)。
- `0x12d30` Text.GetSelection(+0x28)。
- `0x12d6f` ranges.Length(+0x18)，非空；`0x12d93` ranges.GetElement(0,+0x20)；`0x12dc6` selectedRange.GetText(-1,+0x60)。
- `0x12f78`文档range.Clone(+0x18)；`0x12fa1` MoveEndpointByRange(+0x78)，doc.End1→selection.Start0，再`0x12fc0`GetText取before。
- `0x131d2`文档range.Clone；`0x131fb` MoveEndpointByRange，doc.Start0→selection.End1，再`0x1321c`GetText取after。

ByUnit（RVA0x13d20）：

- `0x13e91` DocumentRange；`0x13ed3` GetSelection；`0x13f12/0x13f36` Length/GetElement0；`0x13f6d`selected.GetText(-1)。
- `0x1411f/0x142c8` Clone；`0x14148/0x142f1` MoveEndpointByRange定位周边；`0x14174/0x1431d` MoveEndpointByUnit(+0x70,TextUnit.Character0)，再`0x1418c/0x14336`GetText读取。

`0x14e10`把两路结果串出 startIndex/endIndex/selectedText/beforeText/afterText（真实字符串拼接RVA0x15a8f起）；调用参数周边5000，存在长度限制/timeout位，但尚未完整核对所有裁切及Unicode索引算法，不把5000解读为系统timeout。

## 实施结论与边界

- 能证明：真实选区/文本光标状态通过UIA Text selection范围读取；补文本provider父级、子级、TextChild容器；优先按range读取，失败再character unit读取；有超时检查。
- 不可证明：由这些静态路径算出caret屏幕坐标、强制恢复原selection、自动插入后verify成功、跨应用精确UTF-16索引保证。
- GetSelection可以返回collapsed caret range，其行为由目标应用provider决定。不要把ElementInfo metadata的selected:false当用户选区。

证据：input-pattern.txt、input-range.txt、input-unit.txt和主线程input-function-0x14e10.txt。
