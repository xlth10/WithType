from pathlib import Path
import shutil
stage=Path('/private/tmp/typefree-refine-stage')
repo=Path('/Users/outsider/SEVB/Type')
text_files=['src/App.jsx','src/components/AppIcon.jsx','src/components/AnswerCard.jsx','src/components/TextSettings.jsx','src/components/SkillEditor.jsx','src/styles.css','src-tauri/src/lib.rs','src-tauri/tauri.conf.json','index.html','scripts/generate_ink_icon.py','README.md','research.md','docs/windows-acceptance.md','docs/windows-remediation.md','docs/design/windows-ui-skills-2026-10-10.md','public/assets/typefree-ink-v2.svg']
text_files += [str(p.relative_to(stage)) for p in (stage/'icon-design').glob('*.md')]
text_files += ['icon-design/prompts.json','icon-design/selected/typefree-ink-v2.svg']
for name in text_files:
 src,dst=stage/name,repo/name
 content=src.read_text()
 if dst.exists() and b'\r\n' in dst.read_bytes(): content=content.replace('\n','\r\n')
 dst.parent.mkdir(parents=True,exist_ok=True);dst.write_bytes(content.encode())
for folder in ['src-tauri/icons/ink-v2','icon-design/concepts','icon-design/selected']:
 for src in (stage/folder).glob('*'):
  if src.suffix=='.svg': continue
  dst=repo/src.relative_to(stage);dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dst)
print('Synced',len(text_files),'text files and versioned icon assets; legacy assets preserved.')
