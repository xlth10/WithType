#!/usr/bin/env node
// Loads the actual createPipeline implementation. Network/ASR calls use a real adapter.
// Clipboard delivery is a retained-output sink; this is not OS paste/UIA acceptance.
import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { evaluateCase, percentile } from "./evaluate.mjs";
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const sourceRoot = resolve(option("--source-root", "."));
const output = resolve(option("--output", "/private/tmp/withtype-benchmark-output"));
const manifestPath = resolve(option("--manifest", new URL("./manifest.json", import.meta.url).pathname));
const audioDir = resolve(option("--audio-dir", "/private/tmp/withtype-benchmark-audio-2026-10-19"));
const settingsPath = option("--settings", "");
const label = option("--label", "unlabelled");
const platform = option("--platform", process.platform === "darwin" ? "macos" : process.platform);
const isolatedText = args.includes("--text-only");
const selected = option("--case", "").split(",").filter(Boolean);
const repeats = Math.max(1, Math.min(10, Number(option("--repeat", "1")) || 1));
const adapterCommand = JSON.parse(option("--adapter-command", "[]"));
if (!adapterCommand.length) throw new Error("--adapter-command must be a JSON array of executable and arguments");
if (!settingsPath) throw new Error("--settings is required (non-secret settings JSON)");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const rawSettings = JSON.parse(await readFile(resolve(settingsPath), "utf8"));
// A strict allowlist avoids carrying unrelated settings or secret-looking fields to artifacts.
const settingNames = ["asrEndpoint","asrModel","appleSpeechLocale","textEndpoint","textModel","textFastModel","textFallbackModels","textTimeoutMs","textAuthMode","vocabulary","learnedEntries"];
const safeSettings = Object.fromEntries(settingNames.filter((key) => rawSettings[key] !== undefined).map((key) => [key, rawSettings[key]]));
const { createPipeline } = await import(pathToFileURL(join(sourceRoot,"src/dictation/pipeline.js")));
const { DEFAULT_SETTINGS } = await import(pathToFileURL(join(sourceRoot,"src/text/settingsMigration.js")));
const skills = await import(pathToFileURL(join(sourceRoot,"src/text/builtinSkills.js")));
const settings = {...DEFAULT_SETTINGS,...safeSettings, asrProvider:platform === "macos" ? "apple" : "openai", autoPaste:false, autoLearn:false,
  autoIntent:false,textStreaming:false,textIncremental:false,keepHistoryAudio:true,processingMode:"smart"};
let revision = "unknown";
try { revision = execFileSync("git",["rev-parse","HEAD"],{cwd:sourceRoot,encoding:"utf8",stdio:["ignore","pipe","ignore"]}).trim(); } catch {}
await mkdir(output,{recursive:true});
await writeFile(join(output,"results.jsonl"),"");
const child = spawn(adapterCommand[0],adapterCommand.slice(1),{stdio:["pipe","pipe","pipe"],windowsHide:true});
const lines = createInterface({input:child.stdout,crlfDelay:Infinity});
let sequence=0, health=null, adapterDiagnostics=false;
const pending = new Map();
child.stderr.on("data",()=>{adapterDiagnostics=true;}); // Never persist arbitrary stderr; it could contain credentials.
function failPending(message) { for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error(message));}pending.clear(); }
child.on("error",()=>failPending("benchmark adapter无法启动"));
child.on("exit",(code)=>failPending("benchmark adapter已退出("+code+")"));
lines.on("line",(line)=>{
  let value;try{value=JSON.parse(line);}catch{return;}
  const p=pending.get(value.id);if(!p)return;
  clearTimeout(p.timer);pending.delete(value.id);
  value.ok?p.resolve(value.result):p.reject(new Error(String(value.error||"adapter调用失败")));
});
function rpc(command,payload={}) {
  const id="bench-"+(++sequence);
  const timeout=Number(option("--adapter-timeout-ms","130000"));
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error("benchmark adapter响应超时"));child.kill();},timeout);
    pending.set(id,{resolve,reject,timer});
    child.stdin.write(JSON.stringify({id,command,args:payload})+"\n");
  });
}
const sourceFingerprints = {};
for (const name of ["src/dictation/pipeline.js","src/text/builtinSkills.js","src/vocabulary/rules.js","src/text/dictationRouting.js","src/text/settingsMigration.js","src/dictation/asrProvider.js","src-tauri/native/apple_speech.m","src-tauri/src/apple_speech.rs","src-tauri/src/text_api.rs","src-tauri/src/lib.rs","src-tauri/src/audio.rs","src/vocabulary/learning.js","src/vocabulary/store.js"]) {
  try { sourceFingerprints[name] = createHash("sha256").update(await readFile(join(sourceRoot,name))).digest("hex"); } catch { sourceFingerprints[name] = null; }
}
const benchmarkStartedAt = new Date().toISOString();
const runs=[];
let fatal=null;
try {
  health=await rpc("health",{locale:settings.appleSpeechLocale||"zh-CN"});
  caseLoop: for(const item of manifest.cases.filter((x)=>!selected.length||selected.includes(x.id))) for(let repeat=1;repeat<=repeats;repeat++){
    const run={caseId:item.id,category:item.category,label,repeat,material:manifest.material,executionMode:isolatedText?"reference-text-to-real-model":"audio-to-real-asr-to-real-model",
      nativeClientValidated:health?.nativeClientValidated===true,osDeliveryValidated:false,asrText:null,correctedText:null,polishedText:null,finalText:null,serviceCalls:[],events:[]};
    const localSettings={...settings,vocabulary:[settings.vocabulary,item.vocabulary].filter(Boolean).join("\n")};
    // Use the product's existing polish Skill; baseline and optimized must select the same task.
    if(item.mode==="polish"){
      const skill=skills.BUILTIN_SKILLS.find((x)=>/润色/.test(x.name||x.title||""));
      if(!skill)throw new Error("当前源树没有可选的润色模板");
      localSettings.processingMode="skill";localSettings.selectedSkillId=skill.id;
    }
    let audio={filename:item.id+".wav",audioBase64:"",audioMs:0,encodeMs:0};
    if(!isolatedText){
      const wav=await readFile(join(audioDir,item.id+".wav"));
      const meta=JSON.parse(await readFile(join(audioDir,"audio-manifest.json"),"utf8")).audio.find((x)=>x.id===item.id);
      const hash=createHash("sha256").update(wav).digest("hex");
      if(meta?.sha256!==hash)throw new Error("音频hash不匹配："+item.id);
      audio={...audio,audioBase64:wav.toString("base64"),audioMs:meta.audioMs};run.audioSha256=hash;run.audioMs=meta.audioMs;
    }
    const started=performance.now();
    const pipeline=createPipeline({onEvent:(event)=>{
      // Text and stage data belong to synthetic fixtures only.
      run.events.push(event);
    },invoke:async(command,payload={})=>{
      if(["copy_text","paste_text"].includes(command)) return {status:"copied",copied:true,pasted:false,message:"benchmark retained-output sink"};
      if(["cancel_text_request","cancel_paste","cancel_audio_session","retain_native_audio","release_native_audio"].includes(command))return {};
      if(command==="capture_input_target")return{reason:"benchmark",elapsedMs:0,message:"benchmark output sink"};
      if(!["transcribe_audio","process_text"].includes(command))throw new Error("unsupported benchmark pipeline call: "+command);
      if(command==="transcribe_audio"&&isolatedText){run.asrText=item.spoken;return{text:item.spoken,durationMs:0};}
      const request=payload.request||{};
      const call={stage:command==="transcribe_audio"?"asr":"text",model:request.provider==="apple"?"Apple on-device Speech":request.model||null,hotWords:request.hotWords||[],startedMs:Math.round(performance.now()-started)};
      if(command==="process_text")call.inputText=request.rawText;
      run.serviceCalls.push(call);
      const callStarted=performance.now();
      try {
        const result=await rpc(command,payload);call.elapsedMs=Math.round(performance.now()-callStarted);call.ok=true;call.outputText=result.text;
        if(command==="transcribe_audio")run.asrText=result.text;
        else {run.correctedText??=request.rawText;run.polishedText=result.text;}
        return result;
      } catch(error){call.elapsedMs=Math.round(performance.now()-callStarted);call.ok=false;call.error=String(error.message);throw error;}
    }});
    const snapshot=pipeline.begin({intent:"dictation",settings:localSettings});
    pipeline.markStopped?.(snapshot);
    try{run.result=await pipeline.complete({snapshot,audio});}catch(error){run.result={ok:false,stage:"harness",error:String(error.message)};}
    run.wallMs=Math.round(performance.now()-started);
    const done=run.events.findLast((event)=>["done","paste-failed","text-failed","answer"].includes(event.type));
    run.correctedText??=done?.correctedText??done?.rawText??run.asrText;
    run.finalText=run.result?.text??done?.text??"";
    run.polishedText=done?.polishedText??run.polishedText??null;
    run.timings=run.result?.timings??done?.timings??{};
    run.evaluation=evaluateCase(item,run.finalText);
    const serviceFailure=run.serviceCalls.find((call)=>call.ok===false);
    run.status=serviceFailure?"blocked":run.result?.ok?"completed":"failed";
    run.warning=done?.warning||null;
    runs.push(run);await appendFile(join(output,"results.jsonl"),JSON.stringify(run)+"\n");
    process.stdout.write(label+" "+item.id+" "+run.status+" checks="+run.evaluation.automaticChecksPassed+"\n");
    if(serviceFailure&&!args.includes("--continue-on-service-error")){fatal=serviceFailure.error;break caseLoop;}
  }
} catch(error){fatal=String(error.message);} finally {child.stdin.end();child.kill();}
const completed=runs.filter((x)=>x.status==="completed");
const summary={schemaVersion:1,label,platform,sourceRoot,sourceRevision:revision,sourceFingerprints,corpusId:manifest.corpusId,material:manifest.material,
  executionMode:isolatedText?"reference-text-to-real-model":"audio-to-real-asr-to-real-model",startedAt:benchmarkStartedAt,completedAt:new Date().toISOString(),health,
  settings:{asrProvider:settings.asrProvider,asrModel:settings.asrModel,textModel:settings.textModel,textFastModel:settings.textFastModel,
    textFallbackModels:settings.textFallbackModels,textAuthMode:settings.textAuthMode,textStreaming:false,textIncremental:false},
  attempted:runs.length,completed:completed.length,blocked:runs.filter((x)=>x.status==="blocked").length,
  automaticChecksPassed:completed.filter((x)=>x.evaluation.automaticChecksPassed).length,manualReviewRequired:true,
  timings:{p50ReadyMs:percentile(completed.map((x)=>x.timings.stopToReadyMs),.5),p95ReadyMs:percentile(completed.map((x)=>x.timings.stopToReadyMs),.95)},
  serviceCalls:runs.reduce((n,x)=>n+x.serviceCalls.length,0),fatal,adapterDiagnosticsObserved:adapterDiagnostics,
  limitations:[...manifest.limitations,isolatedText?"ASR未执行，输入为固定口述参考文本，只比较真实文字模型和产品路由。":"既有WAV的文件识别；没有实测录音中分段预识别。",
    "投递使用输出收集器，未触发剪贴板、焦点捕获或OS粘贴。","温度沿用产品0.2；单次结果仍受模型服务波动影响。"]};
await writeFile(join(output,"summary.json"),JSON.stringify(summary,null,2)+"\n");
const report=["# WithType pipeline benchmark", "", "Label: "+label+"; platform: "+platform+"; material: synthetic speech.", "",
  "Execution: "+summary.executionMode, "", "Source: "+revision, "", "Completed "+summary.completed+"/"+summary.attempted+"; automatic checks passed "+summary.automaticChecksPassed+". Human semantic review remains required.", "",
  ...(fatal?["Blocked: "+fatal,""]:[]),"| Case | Status | Auto checks | ASR ms | Text ms | File submit to ready ms |","|---|---|---|---:|---:|---:|",
  ...runs.map((x)=>"| "+x.caseId+" | "+x.status+" | "+x.evaluation.automaticChecksPassed+" | "+(x.timings.asrMs??"")+" | "+(x.timings.textMs??"")+" | "+(x.timings.stopToReadyMs??"")+" |"),
  "", ...summary.limitations.map((x)=>"- "+x), "", "Full stage text and service-call timings: results.jsonl."].join("\n");
await writeFile(join(output,"REPORT.md"),report+"\n");
if(fatal)process.exitCode=2;
