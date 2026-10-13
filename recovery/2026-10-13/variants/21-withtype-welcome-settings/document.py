from pathlib import Path
import json,re,shutil,hashlib
root=Path('/Users/outsider/SEVB/Type');stage=Path('/private/tmp/withtype-welcome-settings');dest=root/'docs/design/custom-welcome-2026-10-13';dest.mkdir(exist_ok=True)
for name in ['custom-welcome.jpg','appearance.jpg','long-welcome-minimum.jpg','browser-checks.json','unit-tests.log']:shutil.copy2(stage/name,dest/name)
name='docs/design/app-opening-2026-10-12/ink-welcome/comp.html';old=(stage/(name.replace('/','_')+'.before')).read_text();current=(root/name).read_text()
def function(s,name):
 m=re.search(r'function '+name+r'\([^\n]*?\)\s*\{',s);start=m.end()-1;n=0
 for end in range(start,len(s)):
  n+=int(s[end]=='{')-int(s[end]=='}')
  if n==0:return s[m.start():end+1]
checks={fn:function(old,fn)==function(current,fn) for fn in ['camera','dropAt','liquidAt','organic','drawInk','seek','tick','play']};assert all(checks.values())
checks['durationSame']='DURATION=3.6' in old and 'DURATION=3.6' in current
baseline=json.loads((root/'docs/design/app-opening-2026-10-12/ink-welcome/preservation-checks.json').read_text());archives={**{n:v for n,v in baseline['before'].items() if n.startswith('docs/')},**baseline['preservedC1']};assert all(hashlib.sha256((root/n).read_bytes()).hexdigest()==v for n,v in archives.items());checks['archiveFilesUnchanged']=len(archives)
(dest/'motion-preservation.json').write_text(json.dumps(checks,indent=2)+'\n')
(dest/'README.md').write_text('''# 自定义欢迎语 · 2026-10-13

在侧栏「外观」编辑完整欢迎语，例如 `Welcome，outsider`，再点击「预览进入动画」。最多 40 个 Unicode 字符，自动在本机保存。留空或无效旧值回退到 `Welcome, Ellen`，并提供恢复默认按钮。文字作为普通文本绘制，不插入 HTML。

![欢迎语设置](appearance.jpg)

欢迎语进入现有 settings 配置：浏览器使用原有 localStorage，Windows 使用原有 settings.json 命令。旧配置补默认值，不改变服务、快捷键或密钥处理。入口等待保存的欢迎语读取完毕，避免先播放默认名字再替换。

![自定义欢迎语的实际 C 版](custom-welcome.jpg)

C 第二稿从新的欢迎语生成字形距离场，仍以同一团湿墨分出笔画；字体、纸场、相位、镜头与 3.6 秒时间轴保持原方案。长文本按最接近镜头时的墨体宽度缩小，保持居中。正式入口 A 也读取该设置，保留自己的 1.4 秒动效。A/B/C1 历史版本的独立脚本继续保留，未把实验库引入生产。

验证：161 项单元测试通过，正式前端构建通过；实际 UI 修改、重播、重载保存、清空回退与恢复默认通过。C 自定义后的重播从 drop 到 ready，结束时间 3.6 秒。640×480 的 40 字中文问候自动缩小，未出现横向溢出；正式入口的预览也读取自定义文字。测试完成后恢复原欢迎语。

`browser-checks.json` 记录运行时观察，`motion-preservation.json` 核对 C 的 8 个动效函数与时长相同，并核对 63 个 B/C1 历史文件未变。`unit-tests.log` 记录测试结果。原 C2 文件夹中的 GIF/MP4 与校验文件属于欢迎语功能之前的默认 Ellen 美术基线，此文档与截图记录新增功能。Windows 安装版的点击和重启保存仍需实机验收；本轮以其共用配置代码、现有原生 JSON 保存接口与浏览器实际运行验证。
''')
p=root/'docs/design/app-opening-2026-10-12/ink-welcome/README.md';s=p.read_text();s+='''\n\n## 欢迎语设置 · 2026-10-13\n\n当前交互版本已支持在「外观」编辑完整欢迎语、自动保存和预览。字体大小与字形墨场按新文字重新计算，3.6 秒时间轴与镜头保持不变；入口等待保存设置读取完成后播放。实现与运行验证见 [自定义欢迎语](../../custom-welcome-2026-10-13/README.md)。本目录的静态 GIF、MP4 与 preservation-checks.json 是加入该功能前的 Ellen 美术基线，不能作为新增配置接线的当前校验。\n''';p.write_text(s)
p=root/'research.md';original=p.read_bytes();s=original.decode().replace('\r\n','\n');s+='''\n\n### 自定义欢迎语 · 2026-10-13\n\n用户要求欢迎语可改为 Welcome，outsider 等内容，同时保持当前动效。在外观页增加整句编辑、自动本机保存、恢复默认与即时预览，配置旧值安全补默认。生产入口与 C 第二稿共用规范化文字；C 等待配置和字体就绪后按新文字生成墨场，保持镜头、墨迹演变及 3.6 秒时间轴，长文字自动适应当前窗口。未把非商业动画库并入生产。161 项测试通过，实际 UI 验证修改、重播、重载、空值与恢复默认；640×480 最长中文欢迎语不横向溢出，正式入口 A 也读取同一设置。验证后恢复原欢迎语。证据在 docs/design/custom-welcome-2026-10-13/，Windows 实机重启验证仍待执行。\n''';p.write_bytes(s.replace('\n','\r\n').encode() if b'\r\n' in original else s.encode())
print('Documented custom welcome feature and unchanged motion; 63 archive file hashes verified.')
