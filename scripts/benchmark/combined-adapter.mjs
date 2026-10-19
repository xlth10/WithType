#!/usr/bin/env node
// Dispatch Apple fixture ASR to a LaunchServices-owned probe and text to the product Rust client.
import {spawn} from "node:child_process";
import {createInterface} from "node:readline";
const args=process.argv.slice(2);
const option=(name,fallback)=>{const i=args.indexOf(name);return i>=0?args[i+1]:fallback;};
const commands={asr:JSON.parse(option("--asr-command","[]")),text:JSON.parse(option("--text-command","[]"))};
const children=new Map();let sequence=0;
function childFor(kind){
 if(children.has(kind))return children.get(kind);
 const command=commands[kind];if(!command.length)throw new Error("adapter command is missing");
 const child=spawn(command[0],command.slice(1),{stdio:["pipe","pipe","pipe"],windowsHide:true});
 const pending=new Map();
 const fail=()=>{for(const p of pending.values())p.reject(new Error(kind+" adapter exited"));pending.clear();};
 child.on("error",fail);child.on("exit",fail);child.stderr.on("data",()=>{});
 const lines=createInterface({input:child.stdout,crlfDelay:Infinity});
 lines.on("line",(line)=>{let result;try{result=JSON.parse(line);}catch{return;}const p=pending.get(result.id);if(!p)return;pending.delete(result.id);result.ok?p.resolve(result.result):p.reject(new Error(result.error||"adapter failed"));});
 const bridge={child,call:(command,args)=>new Promise((resolve,reject)=>{const id="combined-"+(++sequence);pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({id,command,args})+"\n");})};
 children.set(kind,bridge);return bridge;
}
const input=createInterface({input:process.stdin,crlfDelay:Infinity});
for await(const line of input){
 let message;
 try{
  message=JSON.parse(line);let result;
  if(message.command==="health"){
   const apple=await childFor("asr").call("health",message.args||{});
   result={transport:"apple-native-probe-and-product-text-client",serviceCallsAreReal:true,nativeClientValidated:false,appleSpeech:apple,
     scope:"Apple bridge + real product text HTTP client; no WithType microphone, clipboard or OS delivery validation"};
  }else if(message.command==="transcribe_audio"){
   const request=message.args?.request||message.args;
   result=await childFor("asr").call("transcribe_audio",{audioBase64:request.audioBase64,audioPath:request.audioPath,locale:request.locale,hotWords:request.hotWords||[]});
  }else result=await childFor("text").call(message.command,message.args);
  process.stdout.write(JSON.stringify({id:message.id,ok:true,result})+"\n");
 }catch(error){process.stdout.write(JSON.stringify({id:message?.id,ok:false,error:String(error.message||"adapter failed")})+"\n");}
}
for(const {child}of children.values()){child.stdin.end();child.kill();}
