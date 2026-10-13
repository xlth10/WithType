from pathlib import Path
import shutil
stage=Path('/private/tmp/typefree-desktop-stage');repo=Path('/Users/outsider/SEVB/Type')
files=['src/App.jsx','src/styles.css','src-tauri/src/lib.rs','src-tauri/src/floating.rs','src-tauri/tauri.conf.json','src-tauri/capabilities/default.json','index.html','package.json','package-lock.json','README.md','research.md','THIRD_PARTY_NOTICES.md','scripts/package-windows.ps1','.github/workflows/build-windows.yml','docs/windows-remediation.md','docs/design/desktop-parity-2026-10-10.md','tests/desktop-ui-contract.test.mjs','scripts/prepare_ui_font.py','public/fonts/OFL-NotoSansSC.txt','public/fonts/COPYRIGHT-NotoSansSC.txt','public/fonts/manifest.json','public/fonts/README.md']
for name in files:
 src,dst=stage/name,repo/name;s=src.read_text()
 if dst.exists() and b'\r\n' in dst.read_bytes():s=s.replace('\n','\r\n')
 dst.parent.mkdir(parents=True,exist_ok=True);dst.write_bytes(s.encode())
shutil.copy2(stage/'public/fonts/noto-sans-sc-variable.woff2',repo/'public/fonts/noto-sans-sc-variable.woff2')
print('Synced',len(files),'source/doc/license files and WOFF2; temporary TTF/WOFF excluded.')
