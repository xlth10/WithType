# Typeless Windows 2.8.2 ContextHelper.dll 焦点与可编辑性静态证据

范围：真实 Windows x64 PE（ImageBase 0x180000000）。未加载/执行 DLL。已以 pdata 切函数，以 Microsoft 官方 UIAutomationClient.h 按 STDMETHODCALLTYPE 方法顺序核对 vtable offset；不是仅凭 imports 或 strings 判断。

## 1. 焦点 API 路径（高置信度）

调用链：导出 `getFocusedElementInfoAsync` RVA `0x2a1d0` → `0xe1b0`，通过 worker `0x10b50`（`0xe47a` 将其地址作为任务参数）→ `0xd690` → `0x2e0c0`（call at `0xdae8`）→ `0x2d5f0`（call at `0x2e20a`）。

`0x2d5f0` 首选 `IUIAutomation.GetFocusedElement`（call RVA `0x2d6bb`, vtable +0x40）。失败/HRESULT<0/空元素时：

- `0x2d72d`: GetForegroundWindow。
- `0x2d744`: GetWindowThreadProcessId；`0x2d74d`: GetCurrentThreadId。
- 若线程不同，`0x2d769`: AttachThreadInput(current, foreground, TRUE)。
- `0x2d77e`: GetFocus（同线程或 attach 成功时）；为空/attach失败则 `0x2d7ce`: GetGUIThreadInfo(targetThread)。
- 读取 GUITHREADINFO.hwndFocus (`rsp+0x90`, struct+16)，为空读 hwndActive (`rsp+0x88`, struct+8)，再为空回退 foreground HWND。
- 若已 attach，`0x2d803`: AttachThreadInput(..., FALSE)。
- `0x2d81d`: IUIAutomation.ElementFromHandle (+0x30)。

**意义**：UIA 查询失败并不立刻结束；有基于 HWND/线程输入队列的真实降级链。读取 GetGUIThreadInfo 在这条路径用于 HWND 焦点，不可声称已经使用 rcCaret 获取文本光标坐标。

## 2. 焦点属性的二次校正（高置信度）

`0x2ddd6` 调用 metadata 函数 `0x331c0`。该函数 `0x334ed` 调用 Element.CurrentHasKeyboardFocus (+0xd0，具体行见摘录)；`0x3350e` 调用 CurrentNativeWindowHandle (+0x120)。如果有 HWND，取得线程，AttachThreadInput(TRUE)，GetFocus；必要时 GetGUIThreadInfo；HWND 相同或 IsChild(nativeHwnd, focusedHwnd) 则置 hasKeyboardFocus，最后 detach。

`0x33783/0x337ad` 实际 GetCurrentPattern(+0x80) Text=10014 与 Text2=10024，将任一种成功标记 hasTextPattern；`0x33811` Value=10002 标记 hasValuePattern。`0x3383c` 调用 `0x35110` 计算 editableElement。

## 3. 可编辑性判定（高置信度；算法完整边界仍保守）

函数 `0x35110`，日志名 IsElementEditable_Conservative。不是只有 Edit/ValuePattern 判断。

- 首先用 IUIAutomation.CompareElements(+0x18, call `0x35207`) 匹配已有缓存元素。
- Element.CurrentIsEnabled(+0xe0, `0x35251`) 成功且真才继续。
- CreateCacheRequest(+0xa0, `0x352b8`)；AddProperty 缓存 ControlType30003、IsEnabled30010、ValueIsReadOnly30046、RangeValueIsReadOnly30048、HasKeyboardFocus30008、Legacy role30095/state30096、ValueValue30045，另属性10018（其用途不明，不泛化解释）。AddPattern 缓存 Value10002/Text10014/Text2 10024/TextEdit10032。
- 使用 ControlType 条件 OR：Edit50004、ComboBox50003、Document50030、Text50020、Custom50025、Group50026、Window50032、Pane50033、DataItem50029。CreateOrConditionFromNativeArray (+0xf0, `0x35829`)。
- CacheRequest.TreeScope=3（Element|Children），`0x358ac` Element.FindAllBuildCache(scope=1 Element, ORcondition, cacheRequest)。**不要将此称为向父级遍历**。
- 候选 CachedControlType50004（Edit）可直接进入肯定候选分支 (`0x35b51` → `0x35f50`)。
- `0x35b9d` GetCachedPatternAs(Value10002), `0x35bbd` Value.get_CachedIsReadOnly (+0x38)，成功且false置可编辑候选。
- `0x35bfe` GetCachedPatternAs(Text10014)，QueryInterface 为 TextPattern2；`0x35c54` Text2.GetCaretRange(+0x50)。HRESULT成功、range非空、isActive真为肯定信号。
- 若不满足，`0x35ca7` Text.GetVisibleRanges(+0x30) → Array.Length/GetElement取最后一个 → `0x35d25` TextRange.GetAttributeValue(+0x48,40015 IsReadOnly)。值为VT_BOOL且不是true为肯定候选。
- `0x35d9a` GetCachedPatternAs(TextEdit10032)，成功非空为肯定信号。
- `0x35dd9` GetCachedPropertyValue(ValueIsReadOnly30046)、`0x35e19` RangeValueIsReadOnly30048，检查 readonly 值。
- `0x35e8d/0x35ed0` Legacy role/state 值；role41 被排除，state 位掩码被检查（0x40 read-only、1 unavailable、2 selected、0x200000 multi-selectable、0x100000 focusable；精确策略谨慎表述，不用这些位宣称内容插入）。
- 肯定候选 `0x35f67` 继续 Element.CachedHasKeyboardFocus(+0x1d0)，结果影响最终值（`0x36bcb` 使用状态返回）。
- UIA/cache失败路径 `0x36c5c` 取 CurrentNativeWindowHandle、IsWindow；`0x36ca0` 调用 thunk `0x3add0` → IAT OLEACC.AccessibleObjectFromWindow(hwnd, OBJID_CLIENT=-4, IID_IAccessible)。`0x36cd2` IAccessible.get_accFocus(+0x90)。成功焦点 child/object 后取 ProcessID、OpenProcess、QueryFullProcessImageNameW并比较 basename 白名单，初始化可见 `sublime_text.exe`、`atom.exe`（`0x37471/0x374a0`），命中返回true。这是有实现证据的兼容路径，但只在其前置条件满足下成立。

## 4. 高权限目标检测（高置信度）

焦点函数 `0x2d5f0` 的 `0x2dace` Element.CurrentProcessId → OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION0x1000)、OpenProcessToken(TOKEN_QUERY8)、GetTokenInformation(TokenElevation20)。结果串成 isAdmin；GetLastError=5(AccessDenied) 也作 elevated 信号。这是检测/字段，不是绕过 UIPI 或保证高权限应用插入。

## 5. Chromium 可访问性唤醒（高置信度）

导出 `setFocusedWindowEnhancedUserInterface` RVA `0x2a210` → `0x29000`。

- `0x290b0` 真实 SendMessageTimeoutW(foregroundHwnd,WM_GETOBJECT0x3d,wParam0,lParam1,SMTO_ABORTIFHUNG2,100ms,&result)。
- `0x29bed`（另失败路径 `0x29d97/0x29f05`）：NotifyWinEvent(event2,hwnd,OBJID_CLIENT=-4,child1)。
- 记录 result/error，日志称 Chrome-style AT detection protocol。

结论只说发出 AT 检测/可访问性请求；无法仅静态证明特定 Chromium版本一定打开 provider，不能以接口名 `EnhancedUserInterface` 等同真正 native caret恢复。

## 6. 不应过度解读

- ElementInfo metadata在 `0x2f433` 固定写 `"selected":false`，不是用户文本选区；光标/selection输入状态应另看 InputHelper。
- `bounds` 为控件 bounding rectangle，不一定是文本caret rectangle。
- ContextHelper无原生写入动作结论；插入机制须据InputHelper。
- 未实机运行，无法量化焦点查询、粘贴到达、特定应用兼容率。

证据文件：ContextHelper.annotated.txt，fn-2d5f0.txt，fn-331c0.txt，editable.txt，fn-29000.txt，uia-method-offsets.json。
官方头文件来源：[Microsoft UIAutomationClient.h](https://github.com/microsoft/win32metadata/blob/main/generation/WinSDK/RecompiledIdlHeaders/um/UIAutomationClient.h)
官方语义：[Microsoft GetFocus](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getfocus)
