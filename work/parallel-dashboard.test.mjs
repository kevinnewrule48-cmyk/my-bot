import {createTradeDecision} from '../public/trade-decision.js';
import {TradabilityMarkets} from '../public/tradability-markets.js';
import {BalanceBook,assertCandidate} from '../public/balance-engine.js';
import {BalanceEvidence} from '../public/balance-scale.js';
import {TradabilityEngine,tradabilityBlocks} from '../public/tradability-engine.js';
import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import crypto from 'node:crypto';import {readFileSync} from 'node:fs';
import {DifferEngine} from '../public/differ-engine.js';
import {DigitBarrierEngine,extractLastDigit,proposalRequest} from '../public/digit-barrier-engine.js';
import {diagnoseSnapshot} from '../public/part-one-diagnostics.js';
import {DigitWheelState} from '../public/live-digit-wheel.js';import {heatMap} from '../public/premium-model.js';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const flush=()=>new Promise(setImmediate);
test('tradability blocks new UI orders while both analyzers keep receiving ticks, then recovers',async()=>{
 const f=await fixture(true,false);
 vm.runInContext("tradabilityMode='auto-block';tradabilityServer={allowed:false};tradabilityEngine.selectWindow(100);",f.context);
 for(let i=0;i<200;i++){f.context.price=100+[3,5,7,8,9][i%5]/100;vm.runInContext('tradabilityMarkets.push("R_100",price,Math.floor(Date.now()/1000)-199+liveTickNumber,2,true);addTick(price,Math.floor(Date.now()/1000)-199+liveTickNumber,2)',f.context);}
 assert.equal(f.requests.length,0);assert.equal(vm.runInContext('tradabilityEngine.sequence',f.context),200);assert.equal(vm.runInContext('differEngineState.sequence',f.context),200);
 await vm.runInContext("executeOrder('DIGITOVER')",f.context);assert.equal(f.requests.length,0);
 assert.equal(vm.runInContext('tradabilityEngine.snapshot.state',f.context),'TRADABLE');
 vm.runInContext('tradabilityServer={allowed:true};balanceCycle()',f.context);await flush();
 assert.equal(f.requests.length,1);assert.equal(f.requests[0].type,'DIGITOVER');
});
test('load OFF then authenticate account without starting feed: no executable proposals or orders',async()=>{
 const f=await fixture(false,false,true);await flush();await flush();
 assert.equal(vm.runInContext('autoEnabled',f.context),false);
 assert.equal(vm.runInContext('isRunning',f.context),false);
 assert.equal(vm.runInContext('parallelAutoReady',f.context),false);
 assert.equal(f.requests.length,0);assert.ok(!f.urls.includes('/api/order/prepare'));
 assert.ok(f.urls.includes('/api/accounts'));assert.ok(f.urls.includes('/api/execution/reset'));
 vm.runInContext('loadAuthStatus()',f.context);await flush();await flush();
 assert.equal(f.requests.length,0);assert.ok(!f.urls.includes('/api/order/prepare'));
});
async function fixture(ou,differ,connected=false){
 const fields=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],{value:'0',checked:false,textContent:'',classList:{toggle(){},add(){},remove(){}},addEventListener(){},setAttribute(){},setCustomValidity(){},querySelector(){return null;},replaceChildren(){},append(){}}]));
 for(const [k,v] of Object.entries({symbol:'R_100',window:100,minimum:65,barrierPersistence:1,stake:1,maxStake:5000,autoCooldownTicks:5,accountSelector:'demo',duration:1}))fields[k].value=String(v);
 const requests=[],urls=[];
 const context=vm.createContext({performance,createTradeDecision,TradabilityMarkets:class extends TradabilityMarkets{start(){}},BalanceBook,assertCandidate,BalanceEvidence,queueMicrotask,TradabilityEngine,tradabilityBlocks,DifferEngine,crypto,URLSearchParams,liveDigitWheel:new DigitWheelState(),heatMap,DigitBarrierEngine,extractLastDigit,proposalRequest,diagnoseSnapshot,console,document:{getElementById:id=>fields[id],createElement:()=>({})},localStorage:{getItem:()=>null,setItem(){}},setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},fetch:async(url,options)=>{
  if(url==='/api/order'){requests.push(JSON.parse(options.body));return new Promise(()=>{});}
  urls.push(url);return {ok:true,json:async()=>({connected,configured:true,pageId:'fresh-page',accounts:connected?[{accountId:'demo',accountType:'demo',currency:'USD',balance:1000}]:[]})};
 }});
 vm.runInContext(source.replace(/^import[^\n]*\n/gm,''),context);await flush();
 if(!connected)vm.runInContext(`syncMarketClock(Date.now()/1000);demoConnected=true;availableAccounts=[{accountId:'demo',accountType:'demo'}];botMode='auto';autoEnabled=true;parallelAutoReady=true;isRunning=true;socket={readyState:1};overUnderEngineState.armed=${ou};differEngineState.arm(${differ});quotes.over={ask:1,payout:1.1};quotes.under={ask:1,payout:1.1};`,context);
 return {context,requests,fields,urls};
}
for(const [ou,differ] of [[true,true],[true,false],[false,true],[false,false]]){
 test(`real dashboard arm matrix OU=${ou} DIFFER=${differ}`,async()=>{
  // Independent fixtures ensure the account lock does not mask either strategy's permission.
  const a=await fixture(ou,differ);
  for(let i=0;i<200;i++){a.context.price=100+[3,5,7,8,9][i%5]/100;vm.runInContext('tradabilityMarkets.push("R_100",price,Math.floor(Date.now()/1000)-199+liveTickNumber,2,true);addTick(price,Math.floor(Date.now()/1000)-199+liveTickNumber,2)',a.context);}
  vm.runInContext('balanceCycle()',a.context);await flush();
  assert.equal(a.requests.some(r=>r.type==='DIGITOVER'),ou);
  assert.equal(vm.runInContext('barrierSnapshot.ticks.length',a.context),200);
  assert.equal(vm.runInContext('differEngineState.sequence',a.context),200);
  const b=await fixture(ou,differ);
  // Set history without rendering/authorizing OU. Real addTick then detects the exact candidate and jump.
  vm.runInContext("ticks=Array.from({length:99},()=>({digit:7,price:'100.07',time:1}));addTick(100.03,1000,2);addTick(100.07,1001,2)",b.context);
  assert.equal(b.requests.some(r=>r.type==='DIGITDIFF'),differ);
  if(differ){const request=b.requests.find(r=>r.type==='DIGITDIFF');assert.equal(request.barrier,3);assert.equal(request.strategyEvidence.count,1);assert.equal(request.strategyEvidence.sample,100);}
 });
}
test('Stop switch prevents new DIFFER requests and clears jump candidate',async()=>{
 const f=await fixture(false,true);
 vm.runInContext("ticks=Array.from({length:99},()=>({digit:7,price:'100.07',time:1}));addTick(100.03,1000,2)",f.context);
 f.fields.stopAuto.onclick();await flush();
 vm.runInContext('addTick(100.07,1001,2)',f.context);assert.equal(f.requests.length,0);
 assert.equal(vm.runInContext('differEngineState.candidate',f.context),null);
});

test('failed decision creation releases Auto in-flight lock and keeps Auto intent',async()=>{
 const f=await fixture(true,false);vm.runInContext('autoEnabled=false',f.context);
 for(let i=0;i<200;i++){f.context.price=100+[3,5,7,8,9][i%5]/100;vm.runInContext('tradabilityMarkets.push("R_100",price,Math.floor(Date.now()/1000)-199+liveTickNumber,2,true);addTick(price,Math.floor(Date.now()/1000)-199+liveTickNumber,2)',f.context);}
 f.context.assertCandidate=()=>{throw Error('Injected decision validation failure');};
 vm.runInContext('autoEnabled=true',f.context);await vm.runInContext('maybeAutoOrder(analyzeBoth().selected)',f.context);
 assert.equal(vm.runInContext('autoInFlight',f.context),false);assert.equal(vm.runInContext('autoEnabled',f.context),true);assert.equal(f.requests.length,0);assert.match(vm.runInContext('autoLastError',f.context),/Injected decision/);
});
