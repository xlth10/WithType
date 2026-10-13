from pathlib import Path
import hashlib,shutil

root=Path('/Users/outsider/SEVB/Type')
stage=Path('/private/tmp/typefree-icon-v3')
for source,target in [(stage/'icon-design/ink-v3',root/'icon-design/ink-v3'),(stage/'src-tauri/icons/ink-v3',root/'src-tauri/icons/ink-v3'),(stage/'hud-audit',root/'docs/design/hud-audit-2026-10-11')]:
    assert not target.exists(), f'Version already exists: {target}'
    shutil.copytree(source,target)
for source,target in [(stage/'scripts/generate_ink_v3_icon.py',root/'scripts/generate_ink_v3_icon.py'),(stage/'public/assets/typefree-ink-v3.svg',root/'public/assets/typefree-ink-v3.svg')]:
    assert not target.exists(), f'Asset already exists: {target}'
    shutil.copy2(source,target)

def replace(name,replacements):
    p=root/name;b=p.read_bytes();s=b.decode().replace('\r\n','\n')
    for old,new,count in replacements:
        assert s.count(old)==count,(name,old,s.count(old))
        s=s.replace(old,new)
    p.write_bytes(s.replace('\n','\r\n').encode() if b'\r\n' in b else s.encode())

replace('src/components/AppIcon.jsx',[('typefree-ink-v2.svg','typefree-ink-v3.svg',1)])
replace('index.html',[('typefree-ink-v2.svg','typefree-ink-v3.svg',1)])
replace('src-tauri/src/lib.rs',[('icons/ink-v2/icon.ico','icons/ink-v3/icon.ico',3)])
replace('src-tauri/tauri.conf.json',[
 ('icons/ink-v2/32x32.png','icons/ink-v3/32x32.png',1),
 ('icons/ink-v2/128x128.png','icons/ink-v3/128x128.png',1),
 ('icons/ink-v2/128x128@2x.png','icons/ink-v3/256x256.png',1),
 ('icons/ink-v2/icon.ico','icons/ink-v3/icon.ico',2)])
replace('tests/desktop-ui-contract.test.mjs',[
 ('typefree-ink-v2','typefree-ink-v3',2),
 ('icons/ink-v2/icon.ico','icons/ink-v3/icon.ico',1),
 ('  const portable = await read("scripts/package-windows.ps1");','  assert.match(await read("index.html"), /href="\\/assets\\/typefree-ink-v3\\.svg"/);\n  assert.match(await read("src-tauri/src/lib.rs"), /include_bytes!\\("\\.\\.\\/icons\\/ink-v3\\/icon\\.ico"\\)/);\n  assert.ok(config.bundle.icon.every((path) => path.startsWith("icons/ink-v3/")));\n  const portable = await read("scripts/package-windows.ps1");',1)])
replace('README.md',[
 ('新版图标根据用户提供的“墨珠沿笔迹前行”意象重构：暖纸底、深墨珠与流动笔迹，在小尺寸省去飞溅和纸张纹理。侧栏、问答卡片、浏览器标识与 Windows EXE / 托盘 / 安装程序共用 v2 资源。旧图标文件保留，新文件位于 `public/assets/typefree-ink-v2.svg` 和 `src-tauri/icons/ink-v2/`。设计来源、取舍、导出和复生成命令见 [图标交付记录](icon-design/README.md)。',
 'v3 按用户明确的“墨珠在宣纸上跳动”理念重构：浅宣纸、悬空主墨珠与两颗起落侧珠，去掉长曲线和高光，以清晰间隔适配小尺寸。侧栏、问答卡片、浏览器与 Windows EXE / 托盘 / 安装器共用版本化 v3 资源，旧版保留。来源、图像探索、几何母版、PNG/ICO 导出与复生成见 [v3 图标交付记录](icon-design/ink-v3/README.md)；[v2 历史记录](icon-design/README.md) 保留。HUD 的静音、录音、处理、完成、错误与原生窗口路径补审见 [HUD 专项审查](docs/design/hud-audit-2026-10-11/report.md)。',1)])
print('Integrated versioned rice-paper ink-v3 assets and HUD audit; retained ink-v2 and existing frontend edits.')
