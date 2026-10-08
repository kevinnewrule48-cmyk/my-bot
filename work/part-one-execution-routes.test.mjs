import {createTradeDecision,validateTradeDecision} from '../public/trade-decision.js';
import {analyzeBalance} from '../public/balance-engine.js';
import {validateBalanceRequest} from '../balance-authorization.mjs';
import {TradabilityAuthority} from '../part-one-tradability.mjs';
const tradability=new TradabilityAuthority();
import {strategyForType} from '../public/strategy-proposal.js';
import {resetExecution,purchasePermission,autoAuthorization,authEvent,suspendExecution} from '../execution-permission.mjs';
import {qualifiesDifferFrequency} from '../public/differ-engine.js';
import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import crypto from 'node:crypto';import {readFile} from 'node:fs/promises';
import {PartOneExecution} from '../part-one-execution.mjs';import {DemoRiskLedger,guardedDemoOrder,RiskRejection} from '../part-one-risk.mjs';
const source=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
test('actual HTTP handler + execution manager + demo ledger: 25 purchases/settlements, no duplicate on repeat POST',async()=>{
 let clock=Math.floor(Date.now()/1000)*1000,latestState;const snapshots=new Map();let contract=0,buyCount=0;const handlers={};const socket={readyState:1,addEventListener:(n,fn)=>(handlers[n]??=[]).push(fn),send:raw=>{const req=JSON.parse(raw);let response;
  if(req.ticks)response={tick:{symbol:req.ticks,epoch:clock/1000,quote:100+(latestState?.ticks.at(-1).digit??0)/100,pip_size:2}};
  if(req.proposal){const tickRequest=execution.channels.get(execution.key('demo'))?.requests;const tickEntry=[...(tickRequest??[])].find(([,v])=>v.kind==='ticks'&&v.symbol==='R_100');if(tickEntry)for(const fn of handlers.message||[])fn({data:JSON.stringify({req_id:tickEntry[0],tick:{symbol:'R_100',epoch:clock/1000,quote:100+(latestState?.ticks.at(-1).digit??0)/100,pip_size:2}})});}
  if(req.proposal)response={proposal:{id:'p-'+req.req_id,ask_price:1,payout:1.1}};
  if(req.buy){buyCount++;response={buy:{contract_id:++contract,buy_price:1,transaction_id:contract+100}};}
  if(req.proposal_open_contract)response={subscription:{id:'subscription-'+req.contract_id},proposal_open_contract:{contract_id:req.contract_id,is_sold:1,status:req.contract_id%2?'won':'lost',profit:req.contract_id%2?.1:-1,entry_tick:100.12,exit_tick:req.contract_id%2?100.13:100.10,payout:req.contract_id%2?1.1:0}};
  if(response)queueMicrotask(()=>{for(const fn of handlers.message||[])fn({data:JSON.stringify({req_id:req.req_id,echo_req:req,...response})});});
 }};
 const demoRisk=new DemoRiskLedger(),execution=new PartOneExecution({now:()=>clock,connect:async()=>socket,onSettled:(id,a,r)=>{const p=demoRisk.status(id).pending;if(p?.attemptId===a.attemptId)demoRisk.settle(id,p.id,r);}});
 const session={accessToken:'mock',expiresAt:Date.now()+60000,executionPageId:'test-page'},context=vm.createContext({validateTradeDecision:(d,r)=>validateTradeDecision(d,r,clock),validateBalanceRequest:r=>validateBalanceRequest(r,clock),autoAuthorization,authEvent,tradability,resetExecution,purchasePermission,console,strategyForType,qualifiesDifferFrequency,http:{createServer:handler=>({handler})},URL,Date,Number,Boolean,JSON,Error,crypto,AbortSignal,execution,demoRisk,guardedDemoOrder,RiskRejection,recentOrders:new Map(),realTradingEnabled:false,oauthReady:false,partTwoOrders:async()=>false,getSession:()=>session,cookieValue:()=> 'session',readJson:async req=>req.body,json:(res,status,body)=>{res.status=status;res.body=body;},deriv:async()=>({ok:true,json:async()=>({data:[{account_id:'demo',account_type:'demo',status:'active',currency:'USD'}]})})});
 context.riseFallRoute=async()=>false;context.riseFall={busy:()=>false};
 vm.runInContext(source.slice(source.indexOf('const server = http.createServer'),source.indexOf('const port ='))+'\nglobalThis.handler=server.handler;',context);
 const call=async(url,body)=>{const res={};if(body){body={...body};if(url==='/api/auto/control')Object.assign(body,{pageId:session.executionPageId,live:true,accountId:'demo'});if(url==='/api/order'){if(body.mode==='manual'){const intent=await call('/api/execution/manual-intent',{pageId:session.executionPageId,intent:'manual-click',attemptId:body.attemptId,accountId:body.accountId,type:body.type});body.executionSessionId=intent.body.executionSessionId;}else Object.assign(body,{executionSessionId:body.runId,signalAt:Date.now(),decisionId:body.attemptId,gatePassed:true,strategyEvidence:{...body.strategyEvidence,selected:'OVER',checks:['Barrier','Momentum','Zone','Stability','Score','Persistence','Confidence','Quality'].map(name=>({name,pass:true}))}});}}if(url==='/api/order'&&body.type!=='DIGITDIFF'){
 let s=snapshots.get(body.attemptId);if(!s||s.selected.contractType!==body.type){clock+=2000;const pattern=body.type==='DIGITUNDER'?[7,6,2,1,0]:[2,3,7,8,9];s=analyzeBalance('R_100',Array.from({length:200},(_,i)=>({digit:pattern[i%5],epoch:clock/1000-199+i})));snapshots.set(body.attemptId,s);}latestState=s;
 Object.assign(body,{decision:createTradeDecision(s.selected,s,{mode:body.mode,now:clock}),decisionId:s.selected.id,barrier:s.selected.barrier});
 }await context.handler({url,headers:{host:'mock'},method:body?'POST':'GET',body},res);await new Promise(setImmediate);return res;};
 const config={pageId:session.executionPageId,accountId:'demo',accountType:'demo',symbol:'R_100',windowSize:100,revision:1,mode:'auto-block',live:true};
 const configured=await call('/api/tradability/control',config);assert.equal(configured.status,200,JSON.stringify(configured.body));assert.equal(configured.body.allowed,false);
 const blocked=await call('/api/order',{attemptId:'tradability-denied',armed:true,type:'DIGITOVER',symbol:'R_100',stake:1,accountId:'demo',accountType:'demo',mode:'manual'});assert.equal(blocked.status,409);assert.equal(blocked.body.riskCode,'TRADABILITY_BLOCKED');assert.equal(buyCount,0);
 const monitor=await call('/api/tradability/control',{...config,revision:2,mode:'monitor'});assert.equal(monitor.status,200,JSON.stringify(monitor.body));assert.equal(monitor.body.allowed,true);
 for(let i=1;i<=25;i++){
  const request={attemptId:'http-attempt-'+i,armed:true,type:'DIGITOVER',symbol:'R_100',stake:1,accountId:'demo',accountType:'demo',mode:'manual'};
  const response=await call('/api/order',request);assert.equal(response.status,200,JSON.stringify(response.body));assert.equal(response.body.contractId,i);
  const recent=await call('/api/orders/recent?accountId=demo&accountType=demo');assert.equal(recent.body.order.state,'settled');assert.equal(recent.body.execution.state,'IDLE');assert.equal(recent.body.execution.blocking,false);
  assert.equal(demoRisk.status('demo').pending,null);assert.equal(demoRisk.status('demo').trades,i);
  const repeated=await call('/api/order',request);assert.equal(repeated.status,200);assert.equal(buyCount,i);
 }
 const denied=await call('/api/order',{attemptId:'real-auto-rejected',armed:true,type:'DIGITOVER',symbol:'R_100',stake:1,accountId:'real',accountType:'real',mode:'auto'});assert.equal(denied.status,403);assert.equal(buyCount,25);
 const foreign=await call('/api/orders/recent?accountId=other&accountType=demo');assert.equal(foreign.status,403);
 const changed=await call('/api/order',{attemptId:'http-attempt-25',armed:true,type:'DIGITUNDER',symbol:'R_100',stake:1,accountId:'demo',accountType:'demo',mode:'manual'});assert.equal(changed.status,409);assert.equal(buyCount,25);
 session.expiresAt=Date.now()+60000;
 let revision=0;
 for(const [overUnder,differ] of [[true,true],[true,false],[false,true],[false,false]]){
  const runId='run-'+(++revision);assert.equal((await call('/api/auto/control',{runId,revision,running:true,overUnder,differ})).status,200);
  for(const type of ['DIGITOVER','DIGITDIFF']){
   const before=buyCount,enabled=type==='DIGITDIFF'?differ:overUnder;
   const result=await call('/api/order',{attemptId:`matrix-${revision}-${type}`,runId,armed:true,mode:'auto',type,barrier:3,symbol:'R_100',stake:1,accountId:'demo',accountType:'demo',riskLimits:{cooldownTicks:0},strategyEvidence:{count:6,sample:100,jumpDigit:7}});
   assert.equal(result.status,enabled?200:403);assert.equal(buyCount,before+(enabled?1:0));
   if(enabled)assert.equal(result.body.strategy,type==='DIGITDIFF'?'DIFFER':'OVER_UNDER');
  }
 }
 await call('/api/auto/control',{runId:'boundary',revision:++revision,running:true,overUnder:false,differ:true});
 for(const [count,sample,expected] of [[6,100,200],[7,100,400],[6,99,400]]){
  const result=await call('/api/order',{attemptId:`boundary-${count}-${sample}`,runId:'boundary',armed:true,mode:'auto',type:'DIGITDIFF',barrier:9,symbol:'R_100',stake:1,accountId:'demo',accountType:'demo',riskLimits:{cooldownTicks:0},strategyEvidence:{count,sample,jumpDigit:2}});
  assert.equal(result.status,expected);
 }
 const stopped=await call('/api/auto/control',{runId:'stop',revision:++revision,running:false,overUnder:true,differ:true});assert.equal(stopped.status,200);
 const before=buyCount;
 for(const type of ['DIGITOVER','DIGITDIFF'])assert.equal((await call('/api/order',{attemptId:'stop-'+type,runId:'stop',armed:true,mode:'auto',type,barrier:3,symbol:'R_100',stake:1,accountId:'demo',accountType:'demo'})).status,403);
 assert.equal(buyCount,before);
 const runId='endurance';
 assert.equal((await call('/api/auto/control',{runId,revision:++revision,running:true,overUnder:true,differ:false})).status,200);
 for(let i=1;i<=150;i++){
  if(i%20===0){suspendExecution(session);assert.equal((await call('/api/auto/status')).body.authorization.state,'AUTO_RECOVERING');
   assert.equal((await call('/api/order',{attemptId:'blocked-'+i,runId,armed:true,mode:'auto',type:'DIGITOVER',symbol:'R_100',stake:1,accountId:'demo',accountType:'demo'})).status,403);
   assert.equal((await call('/api/auto/control',{runId,revision:++revision,recover:true,running:true,overUnder:true,differ:false})).status,200);
  }
  const response=await call('/api/order',{attemptId:'endurance-'+i,runId,armed:true,mode:'auto',type:'DIGITOVER',symbol:'R_100',stake:1,accountId:'demo',accountType:'demo',riskLimits:{cooldownTicks:0}});
  assert.equal(response.status,200,JSON.stringify(response.body));assert.equal(execution.snapshot('demo').blocking,false);assert.equal(demoRisk.status('demo').pending,null);assert.equal(autoAuthorization(session).state,'AUTO_AUTHORIZED');
 }
 assert.equal(buyCount,before+150);
});
