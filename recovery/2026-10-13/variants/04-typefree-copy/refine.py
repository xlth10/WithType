from pathlib import Path
import hashlib
import json

root=Path('/Users/outsider/SEVB/Type')
stage=Path('/private/tmp/typefree-copy/staged')
pending=[]

def edit(relative, transform):
    path=root/relative
    raw=path.read_bytes()
    ending='\r\n' if b'\r\n' in raw else '\n'
    source=raw.decode().replace('\r\n','\n')
    result=transform(source)
    assert source!=result, relative
    data=result.replace('\n',ending).encode()
    target=stage/relative
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_bytes(data)
    pending.append({'path':relative,'before':hashlib.sha256(raw).hexdigest()})

def replace(text, old, new):
    assert old in text, old[:100]
    return text.replace(old,new)

def changes(text, pairs):
    for old,new in pairs:
        text=replace(text,old,new)
    return text

def terms(text):
    for old,new in [('随便问','提问'),('技能','写法'),('语音命令','语音指令'),('智能整理','自动整理')]:
        text=text.replace(old,new)
    return text

def app(text):
    text=terms(text)
    text=changes(text,[
      ('import { AppIcon } from "./components/AppIcon.jsx";', 'import { AppIcon } from "./components/AppIcon.jsx";\nimport { BRAND } from "./ui/brand.js";'),
      ('original: { label: "原文", detail: "保留原句，使用个人词库"', 'original: { label: "保留原文", detail: "保留句子与措辞，仍应用词库"'),
      ('corrected: { label: "术语纠错", detail: "本地词典替换"', 'corrected: { label: "保留原文", detail: "保留句子与措辞，仍应用词库"'),
      ('detail: "去口头禅与断句"', 'detail: "去掉明显赘词，规范标点"'),
      ('detail: "短句直接输出，长句调用文字模型"', 'detail: "短句直接输出，长句整理成文"'),
      ('detail: "持续使用所选写法"', 'detail: "按所选场景组织内容"'),
      ('dictation: { label: "口述"', 'dictation: { label: "语音输入"'),
      ('请检查 ASR 密钥或权限','请检查语音服务的密钥与权限'),
      ('`上屏 ${timings.pasteMs} ms`','`输入 ${timings.pasteMs} ms`'),
      ('return intent === "ask" ? "正在听你提问" : "正在录音";', 'return "正在录音";'),
      ('return "正在判断口述类型";', 'return "正在判断处理方式";'),
      ('["home", House, "概览"]','["home", House, "开始"]'),
      ('模型配置','服务设置'),
      ('<strong>typefree</strong><span>非官方 · 声音写作</span>', '<strong>{BRAND.name}</strong><span>{BRAND.description}</span>'),
      ('音频发送到已配置的语音服务','录音发往所选语音服务'),
      ('ASR 服务正常','语音服务已通过测试'),
      ('尚未测试连接','语音服务尚未测试'),
      ('请先填写要保存的 ASR API Key','请先填写语音 API 密钥'),
      ('ASR API Key 已保存到系统凭据库','语音密钥已保存到 Windows 凭据库'),
      ('01 · 从声音到文字','01 · 识别录音'),
      ('语音输入、提问和写法都先在这里转写录音。','所有语音入口都先使用这项服务识别录音。'),
      ('online ? "语音测试通过" : "语音待测试"','online ? "测试通过" : "尚未测试"'),
      ('OpenAI 兼容 WAV 接口','兼容 OpenAI 的语音服务'),
      ('上传 16 kHz 单声道 PCM16 WAV','需要支持 WAV 录音识别。'),
      ('语音 API 地址','服务地址'),
      ('填写到 /v1 即可，例如 http://10.0.0.8:8000/v1','通常填写到 /v1，具体以服务说明为准。'),
      ('语音模型名称','模型名称'),
      ('默认设备会跟随 Windows 系统设置；设备断开时会提示并保留已录内容。','默认设备跟随 Windows 设置。设备断开时保留已录内容。'),
      ('语音 API Key','API 密钥'),
      ('填写后点击保存；已保存的密钥可留空，Windows 凭据库独立保存','已有密钥时留空即可；替换密钥后点击保存。'),
      ('已保存则留空','已有密钥可留空'),
      ('正在测试语音','正在测试…'),
      ('保存中…','正在保存…'),
      ('测试连接会向所填模型发送一段 1 秒测试音频；服务能正常接收并返回 text 字段即视为连接成功。','测试会发送 1 秒测试音频，确认服务能接收并返回识别结果。'),
      ('音频发送范围','音频去向'),
      ('音频会发送到上方填写的地址。建议使用 HTTPS，或确保设备位于可信 VPN/局域网。','录音会发送到你填写的语音服务。请使用 HTTPS 或可信的内网连接。'),
      ('让声音与文字接上服务','连接服务'),
      ('在一页配置语音识别和文字处理。两类服务可以使用相同或不同地址，密钥分别保存。','连接语音识别与文字处理服务，两项服务的地址和密钥分别设置。'),
      ('填写转写模型','尚未设置模型'),
      ('浏览器用于界面预览。服务连接和 Windows 凭据保存需在桌面应用中确认。','当前为浏览器预览。连接测试和密钥保存请在桌面应用中完成。'),
      ('日常写法','日常语音输入'),
      ('<h1>整理到刚刚好。</h1>','<h1>文字整理</h1>'),
      ('从保留原文到重新组织，选一种你常用的处理程度。第三个快捷键另设。','选择语音输入后的处理方式，提问和动作快捷键单独设置。'),
      ('  const skills = skillOptions(customSkills);','  const skills = skillOptions(customSkills);\n  const selectedMode = settings.processingMode === "corrected" ? "original" : settings.processingMode;'),
      ('{PROCESSING_MODES.map((id) => {','{PROCESSING_MODES.filter((id) => id !== "corrected").map((id) => {'),
      ('settings.processingMode === id ? "selected"','selectedMode === id ? "selected"'),
      ('aria-pressed={settings.processingMode === id}','aria-pressed={selectedMode === id}'),
      ('{settings.processingMode === id && <span className="check-mark">','{selectedMode === id && <span className="check-mark">'),
      ('const mode = MODE_META[settings.processingMode] || MODE_META.original;','const mode = MODE_META[settings.processingMode === "corrected" ? "original" : settings.processingMode] || MODE_META.original;'),
      ('持续使用写法','默认写法'),
      ('自动整理和写法都需要文字模型；缺少配置时会保留原文并提示。','自动整理长句和使用写法需要文字服务；未配置时按原文处理。'),
      ('普通口述的写法','所用写法'),
      ('仅当上方选择「按写法整理」时持续生效','选择“按写法整理”后，后续语音输入持续使用。'),
      ('尚未配置文字模型地址或模型名称，这两种模式暂时会按原文处理。可前往「服务设置 → 文字处理」填写。','尚未配置文字服务。请在“服务设置 → 文字处理”填写地址与模型名称。'),
      ('按键与动作','录音与输入'),
      ('<h1>按一次开始，再按一次完成。</h1>','<h1>快捷键</h1>'),
      ('按下全局快捷键开始录音，再按同一个键处理文字。点选按键位可以修改组合键；按 Esc 取消录制新键。','按一次开始录音，再按一次结束并处理。点击组合键可修改，按 Esc 取消设置。'),
      ('已暂停录制：焦点离开了设置窗口。点回来继续，或按 Esc 取消。','设置窗口失去焦点，已暂停。返回窗口继续，或按 Esc 取消。'),
      ('还在准备全局键盘钩子，请稍候再按一次。','快捷键正在准备，请稍后再按一次。'),
      ('预览已更新；全局快捷键需在安装版验证','预览已更新，桌面应用中的全局快捷键需另行验证'),
      ('把常用动作放在第三个键上','动作快捷键'),
      ('默认翻译；也可以换成一个写法或语音指令。','可用于翻译、按写法整理，或按口述要求生成文字。'),
      ('运行写法','按写法整理'),
      ('结果自动输入','自动输入结果'),
      ('关闭后复制到剪贴板；提问始终只显示卡片。','开启后输入到光标处；关闭后复制到剪贴板。提问结果显示为卡片。'),
      ('实验功能：会增加一次文字模型请求。关掉后仍可在第三个入口选择语音指令。','实验功能：自动区分直接输入与生成要求，会额外调用文字服务。'),
      ('登录 Windows 后启动','登录后启动'),
      ('随当前 Windows 用户登录启动本程序。','登录 Windows 后自动启动落墨。'),
      ('<span className="eyebrow">回看</span><h1>最近说过的话</h1>','<span className="eyebrow">本机记录</span><h1>历史记录</h1>'),
      ('保留最近 50 条。Windows 历史使用系统数据保护加密，应用与窗口名称不发送给模型。','保留最近 50 条。Windows 版在本机加密保存记录，应用与窗口名称不发送给模型。'),
      ('保留后续录音','保存录音'),
      ('默认关闭；开启后可从历史重新转写，录音与历史一同到期。','开启后保存新的录音，可从历史重新识别。录音与记录一同到期。'),
      ('这里还没有记录。按快捷键开始录音。','还没有记录。完成一段语音输入后，结果会保存在这里。'),
      ('用当前模型重新转写','用当前模型重新识别'),
      ('<span className="eyebrow">从开口开始</span><h1>说出来，写下去。</h1>','<span className="eyebrow">{BRAND.name}</span><h1>{BRAND.tagline}</h1>'),
      ('一段话，可以直接落字，也可以先问、先整理。选好入口，再开口。','用声音输入文字，也可以提问、翻译或按写法整理。'),
      ('语音服务待测试','语音服务尚未测试'),
      ('<h2>{recording ? `${INTENT_META[intent]?.label || "口述"}录音中` : "让思绪，自然落在纸上。"}</h2>', '<h2>{recording ? "正在录音" : busy ? statusLabel(state, intent, phase) : !speechReady ? "先连接语音服务" : "说一段话"}</h2>'),
      ('先填写语音服务地址和模型名称，再测试连接。配置完成后，就可以用快捷键开始口述。','填写服务地址与模型名称，测试通过后即可开始语音输入。'),
      ('在任意应用按一次快捷键说话，再按一次，文字进入光标处。','按快捷键开始说话，再按一次结束。结果会按你的设置输入或复制。'),
      ('在任意应用按一次快捷键说话，再按一次完成口述。提问和动作还需配置文字服务。','按快捷键开始说话，再按一次结束。提问、翻译和写法还需连接文字服务。'),
      ('配置语音服务','设置语音服务'),
      ('声音，正在成为文字','墨珠随声音变化'),
      ('从一小段话开始','按快捷键开始'),
      ('同一个键结束','再按一次结束'),
      ('<small>当前模式</small>','<small>处理方式</small>'),
      ('<h2>最近一次</h2>','<h2>最近结果</h2>'),
      ('还没有输入记录','还没有结果'),
      ('设置语音服务后，第一段口述会显示在这里。','连接语音服务后，第一段语音输入会显示在这里。'),
      ('有 ${loaded.rejected} 个自定义 Skill 未通过校验，已跳过。','有 ${loaded.rejected} 个自定义写法未通过校验，已跳过。'),
      ('之前选择的 Skill 已不存在，文字整理已回退为「自动整理」。','之前选择的写法已不存在，已恢复自动整理。'),
      ('已删除，不再自动学习这条纠正','词条已删除，不再自动学习这项纠正'),
      ('语音服务在线','语音服务已通过测试'),
      ('语音服务待连接','语音服务尚未测试'),
      ('语音识别没有完成','语音识别未完成'),
      ('文字整理没有完成','文字处理未完成'),
      ('可恢复的录音','待处理录音'),
      ('重新转写','重新识别'),
      ('正在转写','正在识别'),
      ('请先配置文字模型','请先设置文字服务'),
    ])
    return text

def skill_editor(text):
    text=text.replace('技能','写法').replace('智能整理','自动整理').replace('模型配置','服务设置')
    return changes(text,[
      ('把话整理成你需要的样子','固定场景'),
      ('<h1>选个场景，再开口。</h1>','<h1>写法</h1>'),
      ('写法是一种固定写法。先看看效果，再决定用一次，还是留给快捷键。','把口述整理为邮件、汇报或纪要。可以用一次，也可以设为默认写法。'),
      ('常用场景','常用写法'),
      ('创建一种写法','新建写法'),
      ('什么时候使用','适用场景'),
      ('写清使用场景、输出结构和需要保留的信息。','说明使用场景、整理方式和需要保留的信息。'),
      ('用这个写法说一段','按此写法录音'),
      ('本次先在卡片查看，不改变你的绑定。','本次结果显示为卡片，快捷键设置保持原样。'),
      ('常用入口与整理规则','默认用法与整理要求'),
      ('动作快捷键完成后','结果去向'),
      ('输入光标处','输入到光标处'),
      ('先在卡片查看','显示为卡片'),
      ('绑定动作快捷键','用于动作快捷键'),
      ('已用于动作快捷键','已用于动作快捷键'),
      ('普通口述不受影响','语音输入单独设置'),
      ('日常口述正在使用 · 点击恢复自动整理','已用于语音输入 · 点击恢复自动整理'),
      ('设为日常口述写法','设为默认写法'),
      ('持续生效，直到切换模式','后续语音输入持续使用'),
      ('查看整理规则','查看整理要求'),
      ('静态示例帮助理解写法；试用会调用你配置的文字模型。','可参考下方示例，也可以用自己的文字试用。'),
      ('你说的内容','试用文字'),
      ('本次试用结果 · 未输入任何窗口','试用结果 · 未自动输入'),
      ('试用没有完成','试用未完成'),
      ('输出示例 · 静态参考','参考示例'),
      ('使用当前文字模型；不会保存历史或自动输入。','试用会调用当前文字服务，不保存历史或自动输入。'),
      ('先在“服务设置 → 文字处理”填写服务地址和模型名称。','请先在“服务设置 → 文字处理”填写地址与模型名称。'),
      ('保存中…','正在保存…'),
    ])

def text_settings(text):
    return changes(text,[
      ('随便问','提问'),('技能','写法'),('智能整理','自动整理'),
      ('Bearer Token（Authorization 头）','API 密钥（Bearer）'),
      ('无认证（内网服务不需要密钥）','无需密钥'),
      ('请先填写要保存的 API Key','请先填写文字 API 密钥'),
      ('文字模型 API Key 已保存到系统凭据库','文字密钥已保存到 Windows 凭据库'),
      ('02 · 从文字到成稿','02 · 整理文字'),
      ('自动整理、提问、翻译和写法使用这里的服务；仅转写录音时可留空。','用于自动整理、提问、翻译和写法；只做语音输入时可留空。'),
      ('文字测试通过','测试通过'),('文字测试失败','测试未通过'),('文字待测试','尚未测试'),
      ('OpenAI 兼容文字接口','兼容 OpenAI 的文字服务'),
      ('使用 /chat/completions；提问支持流式回答，不支持时回退完整响应。','提问时可逐步显示回答；服务不支持时等待完整结果。'),
      ('文字 API 地址','服务地址'),
      ('填写到 /v1 即可，例如 http://10.0.0.9:8000/v1；留空则不启用文字整理','通常填写到 /v1；留空时不启用文字服务。'),
      ('文字模型名称','模型名称'),
      ('例如 Qwen3-8B、deepseek-v3；留空则不启用文字整理','填写服务提供的模型名称；留空时不启用文字服务。'),
      ('意图判断与翻译优先使用；留空时使用主模型。','判断处理方式和翻译时优先使用；留空则使用上方模型。'),
      ('响应超时','等待时限'),
      ('文字 API Key','API 密钥'),
      ('保存后写入 Windows 凭据库，不进入配置文件与浏览器存储','已有密钥时留空即可；替换密钥后点击保存。'),
      ('已保存则留空','已有密钥可留空'),
      ('正在测试文字','正在测试…'),('保存中…','正在保存…'),
      ('密钥不进配置文件','密钥保存'),
      ('语音识别与文字模型各自使用独立的凭据项，二者互不覆盖。切换为「无认证」时不会读取已保存的密钥；\n            模型名称同样留空即视为不启用，不会退回默认服务。','语音与文字密钥分别存入 Windows 凭据库，不写入配置文件。选择“无需密钥”后不会读取已存密钥；\n            服务地址或模型名称留空时，不启用文字服务。'),
      ('连接测试会发送一段真实文本','文字去向'),
      ('测试请求会走完整的整理链路（含认证），只有拿到合法的模型回复才算通过；\n            超时、401/403、空响应会分别报出原因，错误信息不会回显密钥。','整理、提问与翻译会把文字发送到你填写的服务。连接测试也会发送一段测试文字，\n            收到有效回复后显示“测试通过”。错误提示不显示密钥。'),
    ])

def vocabulary(text):
    return changes(text,[
      ('越用越懂你的词','常用词'),
      ('你纠正过的人名、产品名和术语，在下一次口述中自动使用。','保存常用词的正确写法，用于后续语音输入。'),
      ('自动学习纠正','自动学习词条'),
      ('同一改法在两次口述后出现，才会加入词库。关闭后保留已学词条。','同一短词在两次语音输入中被纠正后，加入词库。关闭后保留已有词条。'),
      ('主动纠正','手动纠正'),('自动学到','自动学习'),
      ('已经记住','已保存词条'),('等待再次纠正','待确认词条'),
      ('自动纠正和主动教学共用这份词库，不会改动你的手动词典。','自动学习和手动纠正都保存在这里，手动规则单独设置。'),
      ('还没有学到词汇。照常说话，遇到误识别时纠正它。','还没有词条。遇到误识别时，可以在输入框或历史记录中纠正。'),
      ('这些候选尚未生效，只有再次遇到相同纠正才会记住。','再次出现相同纠正后才会生效，30 天内未确认则移除。'),
      ('暂无候选。','没有待确认的词条。'),
      ('手动词典','手动规则'),
      ('每行一条：正确写法=误写1|误写2。手动词优先。','每行一条：正确写法=误写1|误写2。手动规则优先。'),
    ])

def answer(text):
    return changes(text,[
      ('技能','写法'),('随便问','提问'),
      ('整理完成 · 核对后再使用','整理完成 · 可复制使用'),
      ('留一点空间，把问题想清楚','可以继续追问'),
      ('正在想…','正在回答…'),
      ('输入追问…（Enter 发送）','继续提问，按 Enter 发送'),
      ('不会输入当前窗口','回答仅显示在卡片中'),
    ])

def config(text):
    return changes(text,[
      ('"productName": "typefree"','"productName": "落墨"'),
      ('"title": "typefree"','"title": "落墨"'),
      ('typefree · 录音','落墨 · 录音'),
      ('typefree · 随便问','落墨 · 提问'),
      ('typefree 非官方语音输入版','落墨 · 语音输入与整理'),
      ('用语音输入文字、翻译或提问。','用声音输入、整理文字、翻译或提问。基于 Typefree 的独立版本。'),
    ])

def rust(text):
    return changes(text,[
      ('"随便问"','"提问"'),
      ('"退出 typefree"','"退出落墨"'),
      ('.tooltip("typefree")','.tooltip("落墨")'),
      ('"第三个快捷操作"','"动作快捷键"'),
      ('"取消当前录音 / 处理"','"取消当前任务"'),
      ('尚未保存 ASR API Key','尚未保存语音 API 密钥'),
      ('保存 API Key 失败','保存 API 密钥失败'),
      ('请先填写 ASR 地址和模型名称','请先填写语音服务地址与模型名称'),
      ('ASR 服务','语音服务'),
    ])

def pipeline(text):
    return changes(text,[
      ('|API Key|凭据库','|API Key|API 密钥|凭据库'),
      ('所选 Skill 已不可用，请重新选择','所选写法已不可用，请重新选择'),
      ('请先选择要预览的 Skill','请先选择要试用的写法'),
      ('尚未配置文字模型','尚未配置文字服务'),
      ('提问或语音命令失败时不会把原文插入当前窗口','提问或语音指令未完成，原文不会自动输入'),
    ])

def desktop_test(text):
    text=replace(text,'import { createHash } from "node:crypto";', 'import { createHash } from "node:crypto";\nimport { BRAND } from "../src/ui/brand.js";')
    start=text.index('test("display name is typefree')
    end=text.index('\ntest("offline variable font',start)
    return text[:start]+'''test("visible product identity matches the frontend and native windows while saved identity remains compatible", async () => {
  assert.equal(config.productName, BRAND.name);
  assert.equal(config.mainBinaryName, "typefree");
  assert.equal(config.identifier, "app.typefree.windows.unofficial");
  assert.equal(config.app.windows.find((window) => window.label === "main").title, BRAND.name);
  assert.ok(config.app.windows.every((window) => window.title.startsWith(BRAND.name)));
  assert.ok((await read("index.html")).includes(`<title>${BRAND.name}</title>`));
  const app = await read("src/App.jsx");
  assert.match(app, /<strong>\\{BRAND.name\\}<\\/strong>/);
  assert.ok((await read("src-tauri/src/lib.rs")).includes(`.tooltip("${BRAND.name}")`));
  assert.match(await read("src-tauri/src/lib.rs"), /const SERVICE_NAME: &str = "app\\.typefree\\.windows\\.unofficial"/);
});
''' + text[end:]

edit('src/App.jsx',app)
edit('src/components/SkillEditor.jsx',skill_editor)
edit('src/components/TextSettings.jsx',text_settings)
edit('src/components/VocabularySettings.jsx',vocabulary)
edit('src/components/AnswerCard.jsx',answer)
edit('src/components/HistoryCorrection.jsx',lambda t: replace(t,'改正识别错误，短词纠正会立即记住','改正识别错误，保存后记住可学习的短词'))
edit('src/text/builtinSkills.js',lambda t: replace(t,'name: "Vibe Coding"','name: "开发需求"'))
edit('src/text/skillScenarios.js',lambda t: changes(t,[
  ('已经知道要表达什么，希望写成一封得体的邮件。','把口述要点整理成邮件。'),
  ('准备周报、进度同步，或把散乱的工作记录讲清楚。','整理工作进展、结果与下一步。'),
  ('会后口述复盘，留下明确的结论与待办。','整理会议内容、结论与待办。'),
  ('把口述想法变成能交给开发者或 AI 编程助手的需求。','把口述想法整理成开发需求。'),
]))
edit('src/text/skillValidation.js',lambda t: replace(t,'自定义 Skill','自定义写法'))
edit('src-tauri/src/skills.rs',lambda t: replace(t,'自定义 Skill','自定义写法'))
edit('src/text/settingsMigration.js',lambda t: terms(t).replace('「原文」','「保留原文」'))
edit('src/dictation/pipeline.js',pipeline)
edit('src-tauri/src/lib.rs',rust)
edit('src-tauri/tauri.conf.json',config)
edit('index.html',lambda t: replace(t,'<title>typefree</title>','<title>落墨</title>'))
edit('tests/desktop-ui-contract.test.mjs',desktop_test)
edit('tests/skill-schema.test.mjs',lambda t: t.replace('自定义 Skill','自定义写法').replace('["builtin.vibe-coding", "Vibe Coding"]','["builtin.vibe-coding", "开发需求"]'))
edit('tests/pipeline.test.mjs',lambda t: changes(t,[
  ('所选 Skill 已不可用，请重新选择','所选写法已不可用，请重新选择'),
  ('请先选择要预览的 Skill','请先选择要试用的写法'),
  ('  assert.equal(classifyAsrError("ASR 服务返回 HTTP 401 Unauthorized"), "auth");', '  assert.equal(classifyAsrError("ASR 服务返回 HTTP 401 Unauthorized"), "auth");\n  assert.equal(classifyAsrError("尚未保存语音 API 密钥"), "auth");\n  assert.equal(classifyAsrError("尚未保存 ASR API Key"), "auth");'),
]))
edit('README.md',lambda t: changes(t,[
  ('# typefree（非官方开发版）','# 落墨（独立开发版）'),
  ('应用显示名称统一为 `typefree`；','应用显示名称为「落墨」，用于语音输入与整理。'),
]))

brand=stage/'src/ui/brand.js'
brand.parent.mkdir(parents=True,exist_ok=True)
brand.write_bytes(Path('/private/tmp/typefree-copy/brand.js').read_bytes())
pending.append({'path':'src/ui/brand.js','before':None})
(stage/'manifest.json').write_text(json.dumps(pending,ensure_ascii=False,indent=2))
print('Prepared '+str(len(pending))+' files; all replacement checks passed')

