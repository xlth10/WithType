# KeyboardHelper.dll 自注入键盘事件过滤探针

只读静态检查；未执行 DLL，未调用 REA 会话工具，未安装工具。

- 目标：`/private/tmp/typeless-windows-20261014/extracted/resources/lib/keyboard-helper/build/windows/x64/KeyboardHelper.dll`
- SHA-256：`1112553a22909eb75e488c0134671706e90ab83fc764ad59b2126951d467d3a8`
- image base：`0x180000000`
- 反汇编命令：`/usr/bin/objdump --disassemble --x86-asm-syntax=intel <target>`
- PE 解析：既有 `pe-inspect.py`，Python 标准库解析 imports/exports/.pdata。
- `.pdata` callback 范围：`0x180018030 <= VA < 0x1800188bd`。
- 注意：objdump 显示的 `getKeyboardLayoutInfo+...` 是最近 export 的相对标签，不是这些内部函数的真实名称。

## 结论

**确认存在对 `dwExtraInfo == 0x54594c45` 的特殊过滤分支。**

1. `0x180005c77` 把 callback 指针 `0x180018030` 放入 `rdx`；`0x180005c7e` 把 `0xd` 放入 `ecx`；`0x180005c83` 调用 IAT `0x180040448`，PE import 精确映射为 `USER32!SetWindowsHookExA`。`0xd` 是 WH_KEYBOARD_LL。
2. callback 的 `0x180018055` 保存第三参数 `r8`（lParam）到 `rsi`。
3. `0x18001814c`：`cmp qword ptr [rsi + 0x10], 0x54594c45`；`0x180018154`：`je 0x1800187e6`。x64 KBDLLHOOKSTRUCT 的四个 DWORD 后即为 ULONG_PTR dwExtraInfo，因此 `+0x10` 确认为此字段。
4. 匹配标签的事件跳过 `0x18001815a` 至 `0x1800187e1` 的常规处理区，进入较短的查表/返回区。该分支在 `0x18001885c` 调用 IAT `0x1800403a0`，PE import 精确映射为 `USER32!CallNextHookEx`。

可作报告表述：**Typeless 的全局低层键盘 hook 识别自己打上的 0x54594c45 注入标签，并绕过常规键盘/快捷键处理路径；这与 InputHelper 给 Ctrl+V 事件加同标签的做法配套。**

限定：不能写成“所有匹配标签的事件无条件透传”。`0x1800187e6` 路径还有按键值查表；在 `0x18001884e` 某条件下直接到 `0x180018865`，返回先前初始化的 `r12=1`，另一分支才 CallNextHookEx。尚未进一步命名此容器/完整吞键策略。该探针也不证明插入本身成功。

另在 `0x1800189ad` 看见 `[r15+0x18]` 的同标签比较；未纳入此次结论，因为本任务仅核对键盘 callback。

## 微软 ABI 依据

[Microsoft KBDLLHOOKSTRUCT](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-kbdllhookstruct)

结构顺序为 vkCode/scanCode/flags/time（四个 DWORD）与 dwExtraInfo（ULONG_PTR）。页面最后更新 2021-04-02，核对日期 2026-10-14。

## 摘录

- `hook-registration.txt`
- `keyboard-callback-prologue-and-tag.txt`
- `keyboard-tag-branch-and-forward.txt`
- `selected-imports.json`
- 全量：`keyboard-disassembly.txt`、`keyboard-pe.json`
