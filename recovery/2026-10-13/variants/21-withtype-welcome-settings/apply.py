from pathlib import Path
import shutil
root=Path('/Users/outsider/SEVB/Type');stage=Path('/private/tmp/withtype-welcome-settings')
def edit(name, transform):
 p=root/name;old=p.read_bytes();text=old.decode().replace('\r\n','\n');new=transform(text)
 assert new!=text,name
 (stage/(name.replace('/','_')+'.before')).write_bytes(old)
 p.write_bytes(new.replace('\n','\r\n').encode() if b'\r\n' in old else new.encode())
shutil.copy2(stage/'welcome.js',root/'src/ui/welcome.js')
shutil.copy2(stage/'AppearanceSettings.jsx',root/'src/components/AppearanceSettings.jsx')
shutil.copy2(stage/'welcome.test.mjs',root/'tests/welcome.test.mjs')
def settings(s):
 s=s.replace('// 配置的默认值、归一化与旧版本迁移。','import { BRAND } from "../ui/brand.js";\nimport { normalizeWelcomeText } from "../ui/welcome.js";\n\n// 配置的默认值、归一化与旧版本迁移。',1)
 s=s.replace('export const DEFAULT_SETTINGS = {','export const DEFAULT_SETTINGS = {\n  welcomeText: BRAND.welcome,',1)
 s=s.replace('    settings: {\n','    settings: {\n      welcomeText: normalizeWelcomeText(source.welcomeText),\n',1)
 return s
edit('src/text/settingsMigration.js',settings)
def app(s):
 s=s.replace('  PaperPlaneTilt,','  PaperPlaneTilt,\n  PaintBrush,',1)
 s=s.replace('import { TextSettings }','import { AppearanceSettings } from "./components/AppearanceSettings.jsx";\nimport { normalizeWelcomeText } from "./ui/welcome.js";\nimport { TextSettings }',1)
 s=s.replace('    ["history", ClockCounterClockwise, "历史记录"],','    ["history", ClockCounterClockwise, "历史记录"],\n    ["appearance", PaintBrush, "外观"],',1)
 s=s.replace('export function App() {','export function App({ onWelcomeChange, onReplayEntrance } = {}) {',1)
 s=s.replace('["shortcut", "vocabulary", "history", "skills", "writing", "model"].includes(previewPage)','["shortcut", "vocabulary", "history", "skills", "writing", "model", "appearance"].includes(previewPage)',1)
 s=s.replace('  const [hydrated, setHydrated] = useState(false);','''  const [hydrated, setHydrated] = useState(false);
  const welcomeText = normalizeWelcomeText(settings.welcomeText);
  useEffect(() => {
    if (hydrated) onWelcomeChange?.(welcomeText);
  }, [hydrated, welcomeText, onWelcomeChange]);''',1)
 s=s.replace('        {page === "home" && <Overview','        {page === "appearance" && <AppearanceSettings settings={settings} setSettings={setSettings} ready={hydrated} onReplayEntrance={onReplayEntrance} />}\n        {page === "home" && <Overview',1)
 return s
edit('src/App.jsx',app)
def main(s):
 marker='createRoot(document.getElementById("root")).render('
 s=s.replace(marker,'''function MainSurface() {
  const [welcome, setWelcome] = React.useState(null);
  const [replay, setReplay] = React.useState(0);
  return <AppEntrance welcomeText={welcome} ready={welcome !== null} replayToken={replay}>
    <App onWelcomeChange={setWelcome} onReplayEntrance={() => setReplay((value) => value + 1)} />
  </AppEntrance>;
}

'''+marker,1)
 s=s.replace('<AppEntrance><App /></AppEntrance>','<MainSurface />',1)
 return s
edit('src/main.jsx',main)
def entrance(s):
 s=s.replace('import { BRAND } from "./brand.js";','import { BRAND } from "./brand.js";\nimport { normalizeWelcomeText } from "./welcome.js";',1)
 s=s.replace('export function AppEntrance({ children }) {','export function AppEntrance({ children, welcomeText = BRAND.welcome, ready = true, replayToken = 0 }) {',1)
 s=s.replace('  const playing = useRef(opening);','  const playing = useRef(opening);\n  const lastReplay = useRef(replayToken);',1)
 s=s.replace('if (disposed || reducedPreview || reduced.matches || playing.current || frame !== null) return;','if (disposed || !ready || reducedPreview || reduced.matches || playing.current || frame !== null) return;',1)
 s=s.replace('    if (playing.current && frame === null) timer = setTimeout(finish, DURATION_MS);','''    const replayRequested = replayToken !== lastReplay.current;
    lastReplay.current = replayToken;
    if (ready && replayRequested) play();
    else if (ready && playing.current && frame === null) timer = setTimeout(finish, DURATION_MS);''',1)
 s=s.replace('  }, [frame, reducedPreview]);','  }, [frame, reducedPreview, ready, replayToken]);',1)
 s=s.replace('opening ? " is-entering" : ""','opening ? ready ? " is-entering" : " is-preparing" : ""',1)
 s=s.replace('{opening && <div','{opening && ready && <div',1)
 s=s.replace('{BRAND.welcome}</p>','{normalizeWelcomeText(welcomeText)}</p>',1)
 return s
edit('src/ui/AppEntrance.jsx',entrance)
def styles(s):
 s=s.replace('.app-entry { min-height: 100vh; background: #f8f9f4; }','.app-entry { min-height: 100vh; background: #f8f9f4; }\n.app-entry.is-preparing > .app-shell { visibility: hidden; }',1)
 s=s.replace('  margin: 0; padding: 0 24px; color: #484d42; text-align: center;','  margin: 0; padding: 0 24px; color: #484d42; text-align: center; overflow-wrap: anywhere;',1)
 return s
edit('src/styles.css',styles)
def comp(s):
 s=s.replace("import { BRAND } from '/src/ui/brand.js';","import { normalizeWelcomeText, fitWelcomeFontSize } from '/src/ui/welcome.js';",1)
 s=s.replace('let clock=0,raf=0,started=0,playing=false,ready=false;','let clock=0,raf=0,started=0,playing=false,ready=false;\nlet welcomeText=null,fontsReady=false,resolveReady;',1)
 s=s.replace('createRoot(ui).render(React.createElement(App));','',1)
 s=s.replace('  fontSize=Math.min(30,Math.max(24,W/28));','''  const preferredSize=Math.min(30,Math.max(24,W/28));
  const fontAt=size=>`420 ${size}px "Typefree UI", "Segoe UI", sans-serif`;
  fontSize=fitWelcomeFontSize(preferredSize,(W-64)/(2.12*1.06),size=>{
    rasterCtx.font=fontAt(size);return rasterCtx.measureText(welcomeText).width;
  });''',1)
 s=s.replace('const font=`420 ${fontSize}px "Typefree UI", "Segoe UI", sans-serif`;','const font=fontAt(fontSize);',1)
 s=s.replace('BRAND.welcome','welcomeText')
 s=s.replace('  cw=Math.ceil(textWidth+80);','  world.dataset.welcome=welcomeText;world.dataset.fontSize=String(fontSize);world.dataset.textWidth=String(textWidth);\n  cw=Math.ceil(textWidth+80);',1)
 old='''window.__ready=document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(resolve))).then(()=>{
  prepare();ready=true;world.dataset.ready='true';
  if(reduced.matches||query.has('reduced'))finish();else if(pinned)seek(Number(query.get('t')));else play();
  return true;
});'''
 new='''// Start with the saved greeting, never animate the default while settings hydrate.
function startWhenReady() {
  if(ready||!fontsReady||welcomeText===null)return;
  prepare();ready=true;world.dataset.ready='true';
  if(reduced.matches||query.has('reduced'))finish();else if(pinned)seek(Number(query.get('t')));else play();
  resolveReady(true);
}
function receiveWelcome(value) {
  const next=normalizeWelcomeText(value);
  if(next===welcomeText)return;
  welcomeText=next;
  if(ready){prepare();seek(clock);}else startWhenReady();
}
window.__ready=new Promise(resolve=>{resolveReady=resolve;});
createRoot(ui).render(React.createElement(App,{
  onWelcomeChange:receiveWelcome,
  onReplayEntrance:()=>{if(ready){prepare();play();}},
}));
document.fonts.load('420 30px "Typefree UI"').then(()=>document.fonts.ready)
  .then(()=>new Promise(resolve=>requestAnimationFrame(resolve))).then(()=>{
    fontsReady=true;startWhenReady();
  });'''
 assert old in s
 return s.replace(old,new,1)
edit('docs/design/app-opening-2026-10-12/ink-welcome/comp.html',comp)
print('Welcome preferences, appearance page and shared animation content wired.')
