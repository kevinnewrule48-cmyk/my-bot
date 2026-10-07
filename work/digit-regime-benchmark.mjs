import {performance} from 'node:perf_hooks';
import {DigitRegimeEngine} from '../public/digit-regime-engine.js';
import {writeFile} from 'node:fs/promises';
const results=[];
for(const windows of [[25,50,100,200],[25,50,100,200,400,800,1000,2000]]){
 const e=new DigitRegimeEngine({windows}),times=[];let seed=104729;
 for(let i=1;i<=6000;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const start=performance.now();e.observe({market:'BENCHMARK',digit:seed%10,time:1000+i,sequence:i});if(i>1000)times.push(performance.now()-start);}
 times.sort((a,b)=>a-b);results.push({windows,ticksMeasured:times.length,meanMs:times.reduce((a,b)=>a+b)/times.length,p50Ms:times[Math.floor(times.length*.5)],p95Ms:times[Math.floor(times.length*.95)],p99Ms:times[Math.floor(times.length*.99)],maxMs:times.at(-1)});
}
const report={node:process.version,platform:process.platform,generatedAt:new Date().toISOString(),results,note:'Engine computation only, local Node runtime; browser rendering and IndexedDB latency are not included. Synthetic data, no broker orders.'};
console.log(JSON.stringify(report,null,2));if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(report,null,2));
