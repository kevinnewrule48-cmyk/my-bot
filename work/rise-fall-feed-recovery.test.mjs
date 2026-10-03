import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RiseFallEngine,DEFAULTS} from '../public/rise-fall/engine.js';
import {RiseFallService} from '../rise-fall-service.mjs';
import {scanAnalysis} from '../rise-fall-market-selection.mjs';
import {recoverStaleFeed} from '../rise-fall-feed-recovery.mjs';
const time=1800001200000;
function engine(){const e=new RiseFallEngine('R_100');for(let i=0;i<600;i++)e.add({epoch:1800000002+i*2,quote:1000+i*.1});return e;}
test('unchanged scan reuses calculations, accepted tick and freshness boundary invalidate cache',()=>{
 const e=engine(),snapshot=e.snapshot.bind(e);let calls=0;e.snapshot=now=>{calls++;return snapshot(now);};const row={engine:e};
 const first=scanAnalysis(row,time);for(let i=0;i<100;i++)assert.equal(scanAnalysis(row,time+1),first);assert.equal(calls,1);
 e.add({epoch:1800001202,quote:1060});scanAnalysis(row,time+2000);assert.equal(calls,2);
 assert.equal(scanAnalysis(row,time+13000).winner,null);assert.equal(calls,3);scanAnalysis(row,time+14000);assert.equal(calls,3);
});
test('cached scan matches uncached analyzer across directional reversals and stale periods',()=>{
 const a=engine(),b=engine(),row={engine:a};for(let i=1;i<=150;i++){const tick={epoch:1800001200+i*2,quote:1060+(i<60?i:-i)*.1};a.add(tick);b.add(tick);const now=tick.epoch*1000;assert.deepEqual(scanAnalysis(row,now),b.snapshot(now));assert.deepEqual(scanAnalysis(row,now+11000),b.snapshot(now+11000));}
});
test('replay cache invalidates on replacement, malformed evidence or deletion',()=>{
 const dir=mkdtempSync(join(tmpdir(),'rf-evidence-')),file=join(dir,'evidence.json');try{
  const valid={profiles:[{name:'baseline',config:DEFAULTS}],realData:true,replayCompleted:true,symbols:['R_100','R_10'],validationTicks:3000,results:[{symbol:'R_100',profile:'baseline',partition:'validation',duration:5,unit:'t'}]};writeFileSync(file,JSON.stringify(valid));
  const s=new RiseFallService({validationFile:file});assert.equal(s.validation(DEFAULTS,'R_100',5,'t'),true);assert.equal(s.replayEvidence(),s.replayEvidence());
  writeFileSync(file,'{}');assert.equal(s.validation(DEFAULTS,'R_100',5,'t'),false);writeFileSync(file,'invalid');assert.equal(s.validation(DEFAULTS),false);rmSync(file);assert.equal(s.validation(DEFAULTS),false);
 }finally{rmSync(file,{force:true});rmdirSync(dir);}
});
function recoveryHarness(){
 let now=time+55000;const calls=[],service=new RiseFallService({now:()=>now}),c={owner:'o',account:{account_id:'demo'},config:DEFAULTS,engine:engine(),symbol:'R_100',running:false,feedHealth:{subscriptionId:'old',subscribed:true},rpc:{closed:false,request:async q=>{calls.push(q);if(q.ticks_history)return {history:{prices:[1061],times:[1800001255]}};if(q.ticks)return {subscription:{id:'new'}};return {};}}};service.contexts.set('o',c);return {service,c,calls,setNow:x=>now=x};
}
test('stalled feed repairs only its tick subscription, backfills history and never restarts Auto or buys',async()=>{
 const {service,c,calls}=recoveryHarness();const original=c.engine;await recoverStaleFeed(service,c);assert.deepEqual(calls,[{forget:'old'},{ticks_history:'R_100',count:1500,end:'latest',style:'ticks'},{ticks:'R_100',subscribe:1}]);assert.equal(c.engine,original);assert.equal(c.engine.history.at(-1).epoch,1800001255);assert.equal(c.feedHealth.state,'awaiting-live');assert.equal(c.feedHealth.subscriptionId,'new');assert.equal(c.running,false);assert.equal(c.feedRecovery,null);
});
test('recovery respects open contract, pending proposal, closed connection and other-strategy locks',async()=>{
 for(const kind of ['open','pending','closed','other']){const {service,c,calls}=recoveryHarness();if(kind==='open')service.journal.push({accountId:'demo',state:'UNKNOWN'});if(kind==='pending')c.pending=true;if(kind==='closed')c.rpc.closed=true;if(kind==='other')service.otherBusy=()=>true;await recoverStaleFeed(service,c);assert.equal(calls.length,0,kind);}
});
test('failed recovery backs off, has bounded attempts and remains visible',async()=>{
 const {service,c,calls,setNow}=recoveryHarness();c.rpc.request=async q=>{calls.push(q);throw Error('subscription offline');};await recoverStaleFeed(service,c);assert.match(c.feedHealth.error,/recovery failed/);await recoverStaleFeed(service,c);assert.equal(calls.length,1);setNow(time+86000);await recoverStaleFeed(service,c);setNow(time+117000);await recoverStaleFeed(service,c);setNow(time+148000);await recoverStaleFeed(service,c);assert.equal(calls.length,3);assert.equal(c.running,false);
});
test('pre-purchase rejection identifies stale feed, expired heartbeat, stopped Auto and signal loss separately',()=>{
 const {service,c}=recoveryHarness();service.validation=()=>true;c.session={expiresAt:time+100000};c.runId='r';c.heartbeat=time;c.order={duration:5,unit:'t'};const reasons=service.purchaseBlockers(c,'old','CALL','r');assert.ok(reasons.some(x=>x.includes('Demo Auto is stopped')));assert.ok(reasons.some(x=>x.includes('heartbeat expired')));assert.ok(reasons.some(x=>x.includes('55.0 seconds')));assert.ok(reasons.some(x=>x.includes('signal episode')));
});
