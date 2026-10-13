from pathlib import Path
root=Path('/Users/outsider/SEVB/Type')
updates={
 'src/components/VocabularySettings.jsx':[
  ('候选 30 天过期，删除的纠正不会再自动学入。','待确认词条 30 天内未再次纠正则移除；删除的词条不会再次自动加入。'),
  ('你配置的文字模型','你配置的文字服务'),
 ],
 'src/components/SkillEditor.jsx':[
  ('? "动作快捷键" : "日常口述"','? "动作快捷键" : "语音输入"'),
 ],
 'src/text/skillValidation.js':[
  ('"名称不能为空"','"请填写写法名称"'),
  ('"整理要求不能为空"','"请填写整理要求"'),
  ('"已有同名的自定义写法"','"已有同名写法，请换一个名称"'),
 ],
 'src-tauri/src/skills.rs':[
  ('"名称不能为空"','"请填写写法名称"'),
  ('"整理要求不能为空"','"请填写整理要求"'),
  ('"已有同名的自定义写法"','"已有同名写法，请换一个名称"'),
 ],
 'tests/skill-schema.test.mjs':[
  ('"名称不能为空"','"请填写写法名称"'),
  ('"整理要求不能为空"','"请填写整理要求"'),
  ('"已有同名的自定义写法"','"已有同名写法，请换一个名称"'),
 ],
}
changes=[]
for relative,pairs in updates.items():
 path=root/relative; raw=path.read_bytes(); ending='\r\n' if b'\r\n' in raw else '\n'
 text=raw.decode().replace('\r\n','\n')
 for old,new in pairs:
  assert old in text,(relative,old)
  text=text.replace(old,new)
 changes.append((path,text.replace('\n',ending).encode()))
for path,data in changes:path.write_bytes(data)
print('Polished the remaining vocabulary labels and actionable form validation')
