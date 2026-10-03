import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {RiseFallService,riseFallRoutes} from '../rise-fall-service.mjs';
import {RiseFallEngine,DEFAULTS} from '../public/rise-fall/engine.js';
import {demoLimits,demoBudget,demoStatistics} from '../rise-fall-demo-controls.mjs';
import {executionStatus} from '../rise-fall-diagnostics.mjs';
import {monitorStatus} from '../public/rise-fall/diagnostics.js';
function harness(limits={mode:'unlimited'}){
 let epoch=Date.UTC(2026,9,3)/1000,quote=10000,number=0,settle=false,current;
 const calls=[],proof=[],engine=new RiseFallEngine('R_100'),service=new RiseFallService({now:()=>epoch*1000});service.validation=()=>true;service.verifiedDurations=()=>[{duration:5,unit:'t'}];
 const contracts=['CALL','PUT'].map(contract_type=>({contract_type,min:{value:1,unit:'t'},max:{value:10,unit:'t'}}));
 const c={owner:'owner',id:'s',config:DEFAULTS,symbol:'R_100',engine,account:{account_id:'demo',account_type:'demo',status:'active',currency:'USD'},session:{expiresAt:(epoch+172800)*1000},running:true,runId:'test',heartbeat:epoch*1000,connectedAt:epoch*1000,sessionStartedAt:epoch*1000,used:new Set(),order:{stake:2,duration:5,unit:'t'},demoLimits:limits,contracts,contractsAt:epoch*1000,rpc:{closed:false,request:async q=>{
  calls.push(q);
  if(q.proposal){current.stages.push('PROPOSAL');return {echo_req:q,proposal:{id:'p'+number,ask_price:2,payout:3.8}};}
  if(q.buy){number++;current.contractId=number;current.stages.push('BUY');return {buy:{contract_id:number,buy_price:2}};}
  if(q.proposal_open_contract){if(!settle){current.stages.push('CONTRACT');return {proposal_open_contract:{contract_id:number,is_sold:0,entry_tick:quote}};}const won=number%5===0;current.stages.push('SETTLEMENT',won?'WIN':'LOSS');current.result=won?'won':'lost';return {proposal_open_contract:{contract_id:number,is_sold:1,status:current.result,profit:won?1.8:-2,entry_tick:quote,exit_tick:quote+(won?1:-1)}};}
  throw Error('Unexpected mock request');
 }}};service.contexts.set('owner',c);
 async function trade(i){
  for(let k=0;k<250;k++)engine.add({epoch:++epoch,quote});assert.equal(engine.snapshot(epoch*1000).winner,null);
  const sign=i%2?1:-1;for(let k=0;k<300;k++){quote+=sign*.1;engine.add({epoch:++epoch,quote});}
  c.heartbeat=epoch*1000;c.contractsAt=epoch*1000;const a=engine.snapshot(epoch*1000);assert.ok(a.winner,'Actual strategy must qualify');assert.equal(a.winner.type,sign===1?'CALL':'PUT');
  current={signalId:a.signalId,epoch,type:a.winner.type,stages:['SIGNAL','READY']};settle=false;await service.maybeExecute(c);
  const o=service.journal.at(-1);if(o.state==='REJECTED')return o;
  assert.equal(o.state,'OPEN');assert.equal(service.busy('demo'),true);assert.equal(monitorStatus(a,executionStatus(service,c,a,epoch*1000),service.journal,epoch*1000).status,'WAITING FOR SETTLEMENT');
  const before=number;await service.maybeExecute(c);assert.equal(number,before,'No overlapping or duplicate purchase');
  settle=true;await service.monitor(c,o);assert.equal(o.state,'SETTLED');assert.equal(service.busy('demo'),false);await service.maybeExecute(c);assert.equal(number,before,'No second purchase for consumed episode');
  current.stages.push('NEXT SIGNAL ALLOWED');proof.push(current);return o;
 }
 return {service,c,calls,proof,trade};
}
test('150 actual-analyzer signals complete mock proposal, BUY, contract and settlement beyond both old limits',async()=>{
 const h=harness();for(let i=0;i<150;i++){const o=await h.trade(i);assert.equal(o.state,'SETTLED');assert.equal(h.c.running,true);}
 const s=h.service.status('owner'),stats=s.statistics;assert.equal(stats.totalTrades,150);assert.equal(stats.wins,30);assert.equal(stats.losses,120);assert.equal(stats.riseTrades,75);assert.equal(stats.fallTrades,75);assert.equal(stats.winRate,.2);assert.ok(Math.abs(stats.netProfit+186)<1e-8);assert.equal(s.orders.length,100);assert.equal(s.execution.checks.find(c=>c.key==='budget').pass,true);assert.equal(s.execution.blockers.some(x=>/budget|limit/i.test(x)),false);assert.equal(new Set(h.proof.map(p=>new Date(p.epoch*1000).toISOString().slice(0,10))).size,1);
 let audit;const route=riseFallRoutes(h.service,{getSession:()=>h.c.session,cookieValue:()=> 'owner',json:(_res,code,body)=>audit={code,body}});await route({method:'GET'}, {},new URL('http://local/api/rise-fall/audit'));assert.equal(audit.code,200);assert.equal(audit.body.orders.length,150);assert.equal(audit.body.statistics.totalTrades,150);
 const extra=h.proof.slice(100);assert.equal(extra.length,50);assert.ok(extra.every(p=>p.stages.join('>').includes('PROPOSAL>BUY>CONTRACT>SETTLEMENT')));
 if(process.env.RF_PROOF_OUTPUT)writeFileSync(process.env.RF_PROOF_OUTPUT,JSON.stringify({execution:'Controlled mocks; no authenticated Deriv purchases',productionStrategy:DEFAULTS,oldTradeLimit:100,oldGrossLossLimit:100,grossLoss:240,tradesBeyondOldTradeLimit:50,statistics:stats,allCompleted:true,trades:h.proof},null,2));
});
test('custom count and gross-loss limits are user controlled; unlimited ignores both',async()=>{
 for(const limits of [{mode:'custom',maxTrades:2,maxLoss:1000},{mode:'custom',maxTrades:1000,maxLoss:4}]){const h=harness(limits);assert.equal((await h.trade(0)).state,'SETTLED');assert.equal((await h.trade(1)).state,'SETTLED');assert.equal((await h.trade(2)).state,'REJECTED');assert.match(h.service.journal.at(-1).error,/custom daily demo/);h.c.demoLimits={mode:'unlimited'};assert.equal((await h.trade(3)).state,'SETTLED');}
});
test('custom budgets reset at UTC midnight, exclude rejected requests and isolate accounts',()=>{
 const now=Date.UTC(2026,9,3,23,59,59),c={account:{account_id:'a'},order:{stake:1},demoLimits:{mode:'custom',maxTrades:1,maxLoss:5}},journal=[{id:'1',accountId:'a',createdAt:now,state:'SETTLED',profit:-4},{id:'2',accountId:'a',createdAt:now,state:'REJECTED',profit:-99},{id:'3',accountId:'b',createdAt:now,state:'OPEN'}];assert.equal(demoBudget(journal,c,now).allowed,false);assert.equal(demoBudget(journal,c,now+2000).allowed,true);assert.equal(demoBudget(journal,c,now,'1').allowed,true);c.demoLimits={mode:'unlimited'};assert.equal(demoBudget(journal,c,now).allowed,true);
});
test('limits validation rejects malformed custom limits without imposing a cap on unlimited',()=>{
 assert.deepEqual(demoLimits(),{mode:'unlimited'});for(const v of [null,{mode:'bad'},{mode:'custom',maxTrades:0,maxLoss:1},{mode:'custom',maxTrades:2,maxLoss:NaN}])assert.throws(()=>demoLimits(v));assert.deepEqual(demoLimits({mode:'unlimited',maxTrades:0,maxLoss:0}),{mode:'unlimited'});
});
test('statistics include all retained settled trades and calculate realized drawdown and streaks',()=>{
 const results=[3,-2,-4,1,2],journal=results.map((profit,i)=>({accountId:'a',contractId:i,state:'SETTLED',createdAt:i,settledAt:i,type:i%2?'PUT':'CALL',result:profit>0?'won':'lost',profit}));const s=demoStatistics(journal,'a');assert.equal(s.netProfit,0);assert.equal(s.maxDrawdown,6);assert.equal(s.consecutiveWins,2);assert.equal(s.consecutiveLosses,0);assert.equal(s.maxConsecutiveLosses,2);assert.equal(s.winRate,.6);
});
test('dashboard separates strategy readiness, submission, settlement, execution error and authorization',()=>{
 const a={sample:500,need:240,winner:{name:'RISE'},config:{},candidates:[]},clear={blockers:[]};assert.equal(monitorStatus(a,clear).status,'READY');assert.equal(monitorStatus(a,clear,[{state:'BUY_PENDING'}]).status,'EXECUTING');assert.equal(monitorStatus(a,clear,[{state:'OPEN'}]).status,'WAITING FOR SETTLEMENT');assert.equal(monitorStatus(a,clear,[{state:'UNKNOWN'}]).status,'EXECUTION ERROR');assert.equal(monitorStatus(a,{blockers:['Authentication expired']}).status,'SESSION/AUTHORIZATION ERROR');assert.equal(monitorStatus({...a,sample:0,winner:null},clear).status,'NO TRADE — strategy rejected setup');
});
