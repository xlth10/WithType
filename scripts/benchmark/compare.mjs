#!/usr/bin/env node
import {readFile,writeFile} from "node:fs/promises";
import {resolve,join} from "node:path";
const [beforePath,afterPath,outPath]=process.argv.slice(2);
if(!beforePath||!afterPath)throw new Error("Usage: node compare.mjs BASELINE_OUTPUT OPTIMIZED_OUTPUT [REPORT.md]");
async function load(path){return (await readFile(join(resolve(path),"results.jsonl"),"utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);}
const [before,after]=await Promise.all([load(beforePath),load(afterPath)]);
const lines=["# Before / after comparison","","Synthetic material only. Automatic checks are partial semantic checks, not an accuracy score. Changed outputs require human review.","",
"| Case | Before status / checks | After status / checks | File submit to complete text ms |","|---|---|---|---:|"];
const details=[];
for(const a of after){const b=before.find((x)=>x.caseId===a.caseId&&x.repeat===a.repeat);if(!b)continue;
 if(b.executionMode!==a.executionMode||b.audioSha256!==a.audioSha256)throw new Error("Unmatched material or execution mode: "+a.caseId);
 lines.push("| "+a.caseId+" | "+b.status+" / "+b.evaluation.automaticChecksPassed+" | "+a.status+" / "+a.evaluation.automaticChecksPassed+" | "+(b.timings.stopToReadyMs??"—")+" → "+(a.timings.stopToReadyMs??"—")+" |");
 details.push("### "+a.caseId,"","Before: "+(b.finalText||"(no result)"),"","After: "+(a.finalText||"(no result)"),"","Review: "+a.evaluation.reviewCriterion,"");
}
const report=[...lines,"",...details].join("\n")+"\n";
if(outPath)await writeFile(resolve(outPath),report);else process.stdout.write(report);
