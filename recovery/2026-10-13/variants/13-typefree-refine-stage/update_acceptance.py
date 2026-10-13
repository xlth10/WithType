from pathlib import Path
root=Path('/private/tmp/typefree-refine-stage')
p=root/'docs/windows-acceptance.md'
s=p.read_text().replace('# Windows 验收 · 2026-09-29 更新','# Windows 验收 · 2026-10-10 更新')
s=s.replace('## 构建和启动','每项编号对应 [未通过验收时的处理方案](windows-remediation.md)。界面与 Skill 的细项见 [界面验收](design/windows-ui-skills-2026-10-10.md#windows-验收)。失败项修复后需按同一环境重新验收，不能用浏览器结果替代原生结果。\n\n## 构建和启动')
lines=s.splitlines(); prefix=None; counter=0
for i,line in enumerate(lines):
    if line.startswith('## '):
        prefix={'## 构建和启动':'B','## 语音处理与恢复':'A','## 三个入口':'E','## 墨珠 HUD':'H','## 自动学习':'L'}.get(line); counter=0
    if prefix and (line.startswith('- ') or (prefix=='L' and line[:1].isdigit() and '. ' in line)):
        counter+=1
        if line.startswith('- '): lines[i]=f'- **{prefix}-{counter:02d}** '+line[2:]
        else: lines[i]=line.split('. ',1)[0]+f'. **{prefix}-{counter:02d}** '+line.split('. ',1)[1]
s='\n'.join(lines)+'\n'
s=s.replace('「测试连接」发送','「模型配置 → 测试语音服务」发送')
s=s.replace('白色底板只比墨迹略宽：横向留白约为墨迹宽度的三成以内，上下不出现大片空白。','墨珠遵循现有动效；HUD 可见底板为 176×54 逻辑像素，容纳墨珠、状态与控制按钮，原生透明窗口为 196×74（四周阴影边距 10）。')
p.write_text(s)
p=root/'docs/design/windows-ui-skills-2026-10-10.md'; s=p.read_text(); start=s.index('## Windows 验收'); end=s.index('## 本轮实现与检查结果',start); block=s[start:end]
lines=block.splitlines(); n=0
for i,line in enumerate(lines):
    if line.startswith('- '): n+=1; lines[i]=f'- **UI-{n:02d}** '+line[2:]
lines += ['- **UI-09** 新应用图标在桌面、任务栏、托盘、安装程序、侧栏与问答卡片保持相同的纸色/墨色和墨珠横线造型；16/20/32/48 px 可辨认。','- **UI-10** 侧栏只有“模型配置”；页内语音/文字各有地址、模型、密钥与测试按钮。改动一组配置不覆盖另一组；重启后保留原配置，密钥继续独立存入凭据库。','','每项失败时的处理与复验标准见 [Windows 未通过验收处理方案](../windows-remediation.md#界面与-skill)。','','']
s=s[:start]+'\n'.join(lines)+s[end:]; p.write_text(s)
