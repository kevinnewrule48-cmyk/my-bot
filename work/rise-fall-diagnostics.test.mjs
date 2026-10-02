import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {RiseFallEngine,DEFAULTS} from '../public/rise-fall/engine.js';
import {RiseFallEngine as OriginalEngine} from './fixtures/rise-fall-engine-before-diagnostics.js';
import {DiagnosticLog,explain,strategyStatus,monitorStatus,healthWarnings,GATES,chopBreakdown,directionState} from '../public/rise-fall/diagnostics.js';
import {executionStatus,observe} from '../rise-fall-diagnostics.mjs';
import {RiseFallService,riseFallRoutes} from '../rise-fall-service.mjs';
const start=1800000000;
const stream=(fn,n=600)=>Array.from({length:n},(_,i)=>({symbol:'R_100',epoch:start+i*2,quote:fn(i)}));
function run(ticks){const e=new RiseFallEngine('R_100');for(const t of ticks)e.add(t);return {e,a:e.snapshot(ticks.at(-1).epoch*1000),now:ticks.at(-1).epoch*1000};}
const up=()=>run(stream(i=>1000+i*.1));
test('Every gate and subcheck agrees with authoritative engine checks',()=>{
 for(const ticks of [stream(i=>1000+i*.1),stream(i=>1000-i*.1),stream(i=>1000+i%2),stream(i=>1000+(i<500?i*.1:50-(i-500)*.2))]){
  const {a,now}=run(ticks);for(const side of explain(a,now)){const original=a.candidates.find(c=>c.type===side.type);for(const key of GATES)assert.equal(side.rows.filter(r=>r.gate===key).every(r=>r.pass),original.checks[key],key);assert.equal(side.passed,Object.values(original.checks).filter(Boolean).length);}
 }
});
test('Sustained up/down qualify; sideways and short reversal remain blocked',()=>{
 assert.equal(strategyStatus(up().a),'RISE READY');assert.equal(strategyStatus(run(stream(i=>1000-i*.1)).a),'FALL READY');
 assert.equal(strategyStatus(run(stream(i=>1000+i%2)).a),'CHOPPY MARKET');
 const reversal=run(stream(i=>1000+(i<580?i*.1:58-(i-580)*.3)));assert.equal(reversal.a.winner,null);assert.ok(reversal.a.candidates.every(c=>c.blocked.length));
 assert.equal(run(stream(i=>1000+(i<300?i*.1:30-(i-300)*.1))).a.winner.type,'PUT');
});
test('Indicators reevaluate from changing ticks, including candles and pressure',()=>{
 const {e,a,now}=up();for(let i=0;i<35;i++)e.add({symbol:'R_100',epoch:now/1000+2+i*2,quote:1060-i*.4});const b=e.snapshot(now+70000);
 for(const metric of ['trendStrength','chop','velocity','efficiency'])assert.notEqual(a[metric],b[metric],metric);
 assert.notEqual(a.windows[20].up,b.windows[20].up);assert.notEqual(a.candidates[0].persistence,b.candidates[0].persistence);assert.notEqual(a.lastCandle.close,b.lastCandle.close);
});
test('Display distinguishes READY strategy from execution disabled, active and settled',()=>{
 const {a,now}=up();assert.equal(monitorStatus(a,{blockers:['Auto off']}).status,'EXECUTION BLOCKED');assert.equal(monitorStatus(a,{blockers:['Auto off']}).strategy,'RISE READY');
 assert.equal(monitorStatus(a,{blockers:[]}).status,'RISE READY');assert.equal(monitorStatus(a,{blockers:[]},[{state:'OPEN'}]).status,'EXECUTING');
 for(const result of ['won','lost'])assert.equal(monitorStatus(a,{blockers:[]},[{state:'SETTLED',result,settledAt:now}],now).status,result.toUpperCase());
 assert.equal(monitorStatus(a,{blockers:[]},[{state:'SETTLED',result:'won',settledAt:now-16000}],now).status,'RISE READY');
});
test('Developing and confirmation labels cannot create a READY signal',()=>{
 const {a}=up();const b=structuredClone(a);b.winner=null;b.marketState='UPTREND';b.candidates[0].ready=false;b.candidates[0].checks.confidence=false;
 assert.equal(strategyStatus(b),'WAITING FOR CONFIRMATION');for(const key of ['chop','efficiency','pressure','momentum'])b.candidates[0].checks[key]=false;
 assert.equal(strategyStatus(b),'RISE DEVELOPING');b.candidates=[{...b.candidates[0],name:'FALL'}];assert.equal(strategyStatus(b),'FALL DEVELOPING');
 assert.equal(strategyStatus(run(stream(i=>1000+i,10)).a),'ANALYZING');
});
test('Bounded logs record both candidates once per evaluation and summarize dropped records',()=>{
 const log=new DiagnosticLog({limit:6}),{e,a,now}=up();log.observe(a,now);log.observe(a,now+1);assert.equal(log.total,2);
 for(let i=0;i<20;i++){e.add({epoch:now/1000+i+1,quote:1060+i*.1});log.observe(e.snapshot(now+(i+1)*1000),now+(i+1)*1000);}
 assert.equal(log.records.length,6);assert.equal(log.total,42);assert.ok(log.rejections['FALL:pressure']>0);assert.ok(log.lastQualifiedAt);assert.ok(log.records.every(r=>GATES.every(g=>r.rows.some(x=>x.gate===g))));
});
test('Health reports stale, disconnected, unconfirmed and rejected feeds',()=>{
 const {a,now}=up();assert.deepEqual(healthWarnings(a,{state:'live',subscribed:true},now),[]);
 assert.match(healthWarnings(a,{state:'closed'},now+30000).join(' '),/Stale market feed/);
 assert.match(healthWarnings(a,{state:'failed',startedAt:now-20000,subscribed:false},now).join(' '),/No confirmed/);
 assert.match(healthWarnings(a,{lastReceivedAt:now,lastAcceptedAt:now-20000},now).join(' '),/Ticks arrive but are rejected/);
 assert.match(healthWarnings(a,{},now,{lastSequence:a.sequence-1}).join(' '),/not caught up/);
});
test('Frozen metric detection does not confuse unchanging trend scores with a stalled evaluator',()=>{
 const {a,now}=up(),log=new DiagnosticLog();log.observe(a,now);
 for(let i=1;i<=40;i++)log.observe({...a,sequence:a.sequence+i,quote:a.quote+i,ema:{...a.ema,fast:a.ema.fast+i}},now+i*1000);
 assert.equal(log.metricsFrozen,false);
 const frozen=new DiagnosticLog();frozen.observe(a,now);frozen.observe({...a,sequence:a.sequence+1,quote:a.quote+1},now+31000);assert.equal(frozen.metricsFrozen,true);
});
test('Original strategy thresholds, checks and signal episode selection stay identical',()=>{
 const revised=new RiseFallEngine('R_100'),original=new OriginalEngine('R_100');let seed=123;
 for(let i=0;i<1650;i++){seed=(seed*1664525+1013904223)>>>0;const tick={symbol:'R_100',epoch:start+i*2,quote:1000+i*.05+(seed/2**32-.5)};revised.add(tick);original.add(tick);if(i%17===0||i===1649){const x=revised.snapshot(tick.epoch*1000),y=original.snapshot(tick.epoch*1000);assert.deepEqual(x.config,y.config);assert.equal(x.signalId,y.signalId);for(const key of ['state','marketState','reason','trendStrength','chop','efficiency','volatility','velocity','acceleration','priceSlope','ema','structure'])assert.deepEqual(x[key],y[key],key);assert.deepEqual(x.candidates.map(c=>c.checks),y.candidates.map(c=>c.checks));}}
});
function context(){const {e,a,now}=up();const service=new RiseFallService({now:()=>now,accounts:()=>[],connect:()=>{}});service.validation=()=>true;
 const c={id:'s',symbol:'R_100',config:DEFAULTS,engine:e,session:{expiresAt:now+60000},account:{account_id:'demo',account_type:'demo',status:'active'},rpc:{closed:false},running:true,heartbeat:now,used:new Set(),order:{stake:1,duration:5,unit:'t'},contracts:['CALL','PUT'].map(contract_type=>({contract_type,min:{value:1,unit:'t'},max:{value:10,unit:'t'}}))};service.contexts.set('owner',c);return {service,c,a,now};}
test('Execution diagnostics identify auth, auto, replay, budget and cross-strategy locks without changing authority',()=>{
 const {service,c,a,now}=context();assert.equal(executionStatus(service,c,a,now).blockers.length,0);
 c.running=false;assert.match(executionStatus(service,c,a,now).blockers.join(' '),/Auto enabled/);c.running=true;c.session.expiresAt=now-1;assert.match(executionStatus(service,c,a,now).blockers.join(' '),/Authentication/);
 c.session.expiresAt=now+1;c.heartbeat=now-30000;assert.match(executionStatus(service,c,a,now).blockers.join(' '),/heartbeat/);c.heartbeat=now;service.otherBusy=()=>true;assert.match(executionStatus(service,c,a,now).blockers.join(' '),/contract lock/);service.otherBusy=()=>false;service.validation=()=>false;assert.match(executionStatus(service,c,a,now).blockers.join(' '),/Replay/);
 assert.equal(c.running,true);assert.equal(service.journal.length,0);
});
test('Status expires authority explicitly and diagnostic export requires authentication',async()=>{
 const {service,c,now}=context();c.heartbeat=now-30000;const s=service.status('owner');assert.equal(s.running,false);assert.match(s.error,/heartbeat expired/);assert.equal(s.realEnabled,false);assert.equal(s.diagnostics.totalCandidates,2);
 let result;const route=riseFallRoutes(service,{getSession:()=>null,json:(_res,status,body)=>result={status,body}});await route({method:'GET'}, {},new URL('http://local/api/rise-fall/diagnostics'));assert.equal(result.status,401);
});
test('Diagnostic observation records no credentials or account tokens',()=>{const {service,c,a}=context();c.session.accessToken='must-never-appear';observe(service,c,a);assert.equal(JSON.stringify(service.diagnostics('owner')).includes('must-never-appear'),false);});
test('Tick tracing captures accepted, duplicate, wrong-symbol and invalid ticks without changing history',()=>{
 const e=new RiseFallEngine('R_100').enableTrace(3);assert.equal(e.add({epoch:start,quote:100}),true);assert.equal(e.add({epoch:start+1,quote:101}),true);assert.equal(e.lastTickTrace.direction,'UP');assert.equal(e.lastTickTrace.delta,1);
 assert.equal(e.add({epoch:start+2,quote:100.5}),true);assert.equal(e.lastTickTrace.direction,'DOWN');assert.equal(e.lastTickTrace.previousPrice,101);
 assert.equal(e.add({epoch:start+2,quote:99}),false);assert.match(e.lastTickTrace.rejection,/Duplicate/);assert.equal(e.add({epoch:start+3,quote:NaN}),false);assert.equal(e.add({symbol:'R_10',epoch:start+3,quote:101}),false);
 assert.equal(e.sequence,3);assert.equal(e.received,6);assert.equal(e.rejectedTicks,3);assert.equal(e.history.length,3);assert.equal(e.tickTrace.length,3);
});
test('CHOPPY input contributions exactly reconstruct the unchanged score; efficiency implies 80% short pressure',()=>{
 for(const ticks of [stream(i=>1000+i*.1),stream(i=>1000+i%2),stream(i=>1000+i*.01+Math.sin(i))]){const {a}=run(ticks);const parts=chopBreakdown(a);assert.ok(parts.every(x=>Number.isFinite(x.value)));assert.ok(Math.abs(parts.reduce((n,x)=>n+x.contribution,0)-a.chop)<1e-9);assert.ok(Math.abs(a.efficiency-Math.abs(2*a.windows[50].up-100))<1e-9);assert.equal(a.marketState==='CHOPPY',a.chop>DEFAULTS.maxChop);}
});
test('Directional development uses rolling evidence and cannot mark blocked candidates READY',()=>{
 const {a}=up();assert.equal(directionState(a),'RISE READY');const b=structuredClone(a);b.winner=null;b.candidates[0].ready=false;for(const key of ['confidence','strength','chop','pressure','efficiency'])b.candidates[0].checks[key]=false;assert.equal(directionState(b),'DEVELOPING UP');assert.equal(b.winner,null);
});
test('Flat prices do not produce false frozen-indicator warnings',()=>{const {a,now}=run(stream(()=>1000)),log=new DiagnosticLog();log.observe(a,now);log.observe({...a,sequence:a.sequence+1,epoch:a.epoch+40},now+40000);assert.equal(log.metricsFrozen,false);});
test('Moving inputs ahead of evaluated sequence are explicitly ANALYZER STALLED',()=>{const {a,now}=up();assert.match(healthWarnings(a,{lastAcceptedSequence:a.sequence+5},now).join(' '),/ANALYZER STALLED/);});
test('Authenticated mock subscription forwards every live tick to analysis, logs rejection and settles one mock BUY',async()=>{
 const clock=(start+1200)*1000,calls=[];
 class Socket extends EventTarget{
  readyState=1;
  emit(data){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(data)}));}
  send(raw){const q=JSON.parse(raw);calls.push(q);let response={};
   if(q.time)response={time:clock/1000};
   if(q.contracts_for)response={contracts_for:{available:['CALL','PUT'].map(contract_type=>({contract_type,contract_category:'callput',min_contract_duration:'1t',max_contract_duration:'10t'}))}};
   if(q.ticks_history){const t=stream(i=>1000+i*.1);response={history:{prices:t.map(x=>x.quote),times:t.map(x=>x.epoch)}};}
   if(q.ticks)response={subscription:{id:'mock-ticks'},tick:{symbol:'R_100',epoch:clock/1000,quote:1060}};
   if(q.proposal)response={echo_req:q,proposal:{id:'mock-proposal',ask_price:1,payout:1.9}};
   if(q.buy)response={buy:{contract_id:123,buy_price:1}};
   if(q.proposal_open_contract)response={proposal_open_contract:{contract_id:123,is_sold:1,status:'lost',profit:-1,entry_tick:1060,exit_tick:1059}};
   queueMicrotask(()=>this.emit({req_id:q.req_id,...response}));
  }
  close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
 }
 const socket=new Socket(),service=new RiseFallService({now:()=>clock,accounts:async()=>[{account_id:'demo',account_type:'demo',status:'active',currency:'USD'}],connect:async()=>socket});service.validation=()=>true;service.verifiedDurations=()=>[{duration:5,unit:'t'}];
 const connected=await service.prepare('owner',{expiresAt:clock+100000},{accountId:'demo',symbol:'R_100',config:DEFAULTS});assert.equal(connected.running,false);assert.equal(connected.diagnostics.health.subscribed,true);assert.equal(calls.some(q=>q.buy),false);
 service.start('owner',{sessionId:connected.sessionId,stake:1,duration:5,unit:'t'});
 socket.emit({subscription:{id:'mock-ticks'},tick:{symbol:'R_100',epoch:clock/1000+1,quote:1060.1}});await new Promise(r=>setImmediate(r));
 const status=service.status('owner');assert.equal(status.analysis.sequence,602);assert.equal(status.diagnostics.health.lastAcceptedSequence,602);assert.equal(calls.filter(q=>q.buy).length,1);assert.equal(status.orders[0].result,'lost');assert.equal(status.realEnabled,false);
 socket.emit({tick:{symbol:'R_100',epoch:clock/1000+1,quote:1060.1}});assert.equal(service.diagnostics('owner').rejectedTicks,1);assert.equal(calls.filter(q=>q.buy).length,1);
 socket.close();assert.equal(service.status('owner').connected,false);assert.match(service.status('owner').diagnostics.warnings.join(' '),/disconnected/);
});
test('Diagnostics failing cannot change engine readiness or throw into the purchase path',()=>{const {service,c,a}=context();c.diagnosticLog={observe(){throw Error('injected collector failure');}};const d=observe(service,c,a);assert.match(d.diagnostics.warnings[0],/collector failed/);assert.equal(c.running,true);assert.equal(c.engine.snapshot(service.now()).state,'RISE READY');});
test('Last qualified setup time tracks episode onset, not each repeated READY tick',()=>{const {e,a,now}=up(),log=new DiagnosticLog();log.observe(a,now);e.add({epoch:now/1000+2,quote:1060});log.observe(e.snapshot(now+2000),now+2000);assert.equal(log.lastQualifiedAt,now);});
test('Price precision and scale do not change directional normalization',()=>{const ticks=stream(i=>1000+i*.03+Math.sin(i)*.2),a=run(ticks).a,b=run(ticks.map(t=>({...t,quote:t.quote*100}))).a;for(const key of ['chop','efficiency','trendStrength'])assert.ok(Math.abs(a[key]-b[key])<1e-7,key);assert.ok(Math.abs(a.windows[50].up+b.windows[50].down-100)<1e-7);});
