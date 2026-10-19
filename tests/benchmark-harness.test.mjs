import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {evaluateCase,percentile} from "../scripts/benchmark/evaluate.mjs";
const corpus=JSON.parse(await readFile(new URL("../scripts/benchmark/manifest.json",import.meta.url),"utf8"));
test("synthetic corpus covers correction, fidelity, names and cross-segment withdrawal",()=>{
 assert.equal(corpus.material,"synthetic-speech");
 assert.ok(corpus.cases.length>=12);
 assert.equal(new Set(corpus.cases.map((x)=>x.id)).size,corpus.cases.length);
 for(const item of corpus.cases){assert.ok(item.spoken&&item.review&&item.checks.length);for(const rule of item.checks)if(rule.regex)new RegExp(rule.regex,rule.flags||"u");}
});
test("correction assertions allow wording variation and reject superseded facts",()=>{
 const item=corpus.cases.find((x)=>x.id==="short-correction");
 assert.equal(evaluateCase(item,"明天4点开会").automaticChecksPassed,true);
 assert.equal(evaluateCase(item,"明天三点，不对，四点开会").automaticChecksPassed,false);
 assert.equal(evaluateCase(item,"明天4点开会").manualReviewRequired,true);
});
test("negative safety assertion does not accept automatic payment authorization",()=>{
 const item=corpus.cases.find((x)=>x.id==="negation-money");
 assert.equal(evaluateCase(item,"1500元，等我确认，不要自动付款。").automaticChecksPassed,true);
 assert.equal(evaluateCase(item,"1500元，确认后自动付款。").automaticChecksPassed,false);
});
test("latency percentiles exclude missing measurements",()=>{
 assert.equal(percentile([null,10,20,30],.5),20);
 assert.equal(percentile([],.95),null);
});
