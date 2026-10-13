from pathlib import Path
path=Path('/Users/outsider/SEVB/Type/src/App.jsx')
raw=path.read_bytes(); text=raw.decode().replace('\r\n','\n')
for old,new in [
 ('说完后输入到当前窗口。','说完后按设置输入或复制文字。'),
 ('使用绑定的动作，不改变普通口述。','使用所选动作，语音输入单独设置。'),
 ('link.download = "typefree-history.json";','link.download = `${BRAND.name}-历史记录.json`;'),
 ('>插入原文</button>','>输入原文</button>'),
 ('"无法插入原文"','"未能输入原文"'),
]:
 assert old in text,old
 text=text.replace(old,new)
path.write_bytes(text.replace('\n','\r\n').encode())
print('Unified input actions and the visible history export filename')
