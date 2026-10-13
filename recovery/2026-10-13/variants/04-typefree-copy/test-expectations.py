from pathlib import Path
root=Path('/Users/outsider/SEVB/Type')
for file,pairs in {
 'tests/pipeline.test.mjs':[
  ('提问或语音命令失败时不会把原文插入当前窗口','提问或语音指令未完成，原文不会自动输入'),
  ('尚未配置文字模型','尚未配置文字服务'),
 ],
 'tests/settings-migration.test.mjs':[
  ('文字整理已切换为「原文」','文字整理已切换为「保留原文」'),
 ],
}.items():
 path=root/file
 raw=path.read_bytes(); ending='\r\n' if b'\r\n' in raw else '\n'
 text=raw.decode().replace('\r\n','\n')
 for old,new in pairs:
  assert old in text
  text=text.replace(old,new)
 path.write_bytes(text.replace('\n',ending).encode())
print('Updated the four exact wording assertions; behavior assertions preserved')
