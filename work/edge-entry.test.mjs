import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeBalance,BalanceBook} from '../public/balance-engine.js';
import {analyzeBalance as strict} from './fixtures/strict-balance-v1.js';
import {analyzeEnvironment} from '../public/edge-environment.js';
import {createTradeDecision} from '../public/trade-decision.js';
import {validateBalanceRequest,validateBalancePurchase} from '../balance-authorization.mjs';
import {PartOneExecution} from '../part-one-execution.mjs';
const rows=(digits,end=1000)=>digits.map((digit,i)=>({digit,epoch:end-digits.length+1+i,price:100+digit/100}));
const digits=[...Array.from({length:198},(_,i)=>i%10),5,6];
const request=s=>({candidate:s.selected,balanceState:s,decision:createTradeDecision(s.selected,s,{now:s.createdAt}),decisionId:s.selected.id,type:s.selected.contractType,barrier:s.selected.barrier,symbol:s.market,mode:'auto',stake:1,currency:'USD',authorizePurchase:()=>true});
test('edge is attached to entry; old support/strength failures no longer prevent a current avoidance setup',()=>{
 for(const ds of [digits,digits.map(d=>9-d)]){
  const t=rows(ds),s=analyzeBalance('R_100',t),old=strict('R_100',t),e=analyzeEnvironment(t);
  assert.ok(s.selected);assert.equal(old.selected,null);assert.ok(s.selected.observed<.90);
  const oldCandidate=old.candidates.find(c=>c.label===s.selected.label);
  assert.ok(oldCandidate.checks.some(c=>['Support','Current support','Strength'].includes(c.name)&&!c.pass));
  assert.equal(s.environment.low.pressure,e.low.pressure);assert.equal(s.environment.high.pressure,e.high.pressure);
  assert.equal(s.selected.entryEdge.pressure,s.selected.barrier===1?e.low.pressure:e.high.pressure);
  validateBalanceRequest(request(s),s.createdAt);
 }
});
test('a repeated middle sequence qualifies without waiting for 50 ticks; one tick and alternating edges do not',()=>{
 assert.equal(analyzeBalance('R_100',rows([6])).selected,null);
 assert.ok(analyzeBalance('R_100',rows([5,6])).selected);
 assert.equal(analyzeBalance('R_100',rows(Array.from({length:200},(_,i)=>i%2?9:0))).selected,null);
 const s=analyzeBalance('R_100',rows(digits));const danger=s.selected.direction==='OVER'?0:9;
 const next=analyzeBalance('R_100',[...s.ticks,{digit:danger,epoch:1001}]);
 assert.equal(next.candidates.find(c=>c.label===s.selected.label).ready,false);
 assert.throws(()=>validateBalancePurchase(request(s),{digit:danger,epoch:1001,receivedAt:1001000,history:[s.ticks.at(-1),{digit:danger,epoch:1001}]},1001000),/deteriorated/);
});
test('price context is included but never creates a price or edge-score cutoff; JSON transport remains verifiable',()=>{
 const a=analyzeBalance('R_100',rows(digits));
 const b=analyzeBalance('R_100',rows(digits).map((t,i)=>({...t,price:i<195?100:100+1000*(i%2)})));
 assert.equal(a.selected.label,b.selected.label);assert.equal(a.selected.ready,b.selected.ready);
 assert.equal(b.environment.price.level,'EXTREME');assert.ok(b.environment.price.short.tickRange>0);
 const r=JSON.parse(JSON.stringify(request(b)));validateBalanceRequest(r,b.createdAt);
 const wire={decision:r.decision,strategyEvidence:{selected:r.candidate.type,checks:r.candidate.checks}};
 assert.ok(Buffer.byteLength(JSON.stringify(wire))<30000,'leave room within the existing 32768-byte request limit');
});
class Socket{readyState=1;sent=[];listeners={};addEventListener(n,f){(this.listeners[n]??=[]).push(f);}send(x){this.sent.push(JSON.parse(x));}last(k){return this.sent.findLast(x=>k in x);}reply(req,data){for(const f of this.listeners.message??[])f({data:JSON.stringify({req_id:req.req_id,echo_req:req,...data})});}}
test('newly eligible edge setups complete repeated real executor mock lifecycles after wins and losses',async()=>{
 let now=1000000;const socket=new Socket(),events=[],engine=new PartOneExecution({connect:async()=>socket,now:()=>now,log:e=>events.push(e)}),book=new BalanceBook({now:()=>now});
 const credentials={accountId:'edge-demo',accountType:'demo',token:'MOCK'};
 for(let i=0;i<6;i++){
  const s=analyzeBalance('R_100',rows(i%2?digits.map(d=>9-d):digits,now/1000));assert.ok(s.selected);assert.equal(strict(s.market,s.ticks).selected,null);
  for(const t of s.ticks)book.push(s.market,t);
  const r={...request(s),attemptId:'edge-entry-'+i},flow=engine.execute(credentials,r);await new Promise(setImmediate);
  socket.reply(socket.last('ticks'),{tick:{symbol:s.market,epoch:now/1000,quote:s.ticks.at(-1).price,pip_size:2}});
  socket.reply(socket.last('proposal'),{proposal:{id:'edge-proposal-'+i,ask_price:1,payout:1.1}});
  assert.equal(socket.last('buy').buy,'edge-proposal-'+i);
  socket.reply(socket.last('buy'),{buy:{contract_id:i+1,buy_price:1}});await flow.entry;
  const won=i%2===0,exit=s.selected.direction==='OVER'?(won?9:0):(won?0:9);now+=1000;
  socket.reply(socket.last('proposal_open_contract'),{proposal_open_contract:{contract_id:i+1,contract_type:r.type,barrier:r.barrier,underlying:s.market,entry_tick:s.ticks.at(-1).price,exit_tick:100+exit/100,exit_tick_time:now/1000,pip_size:2,is_sold:1,status:won?'won':'lost',profit:won?.1:-1,payout:won?1.1:0}});
  const settled=await flow.settlement;assert.equal(settled.status,won?'won':'lost');assert.equal(engine.snapshot(credentials.accountId).state,'IDLE');
  assert.throws(()=>engine.execute(credentials,{...r,attemptId:'duplicate-'+i}),/consumed/);now+=2000;
 }
 assert.equal(socket.sent.filter(x=>x.buy).length,6);
 for(const stage of ['PROPOSAL_RESPONSE_RECEIVED','BUY_RESPONSE_RECEIVED','CONTRACT_ID_RECEIVED','SETTLED','READY_FOR_NEXT_TRADE'])assert.equal(events.filter(e=>e.stage===stage).length,6);
 const s=analyzeBalance('R_100',rows(digits,now/1000));assert.throws(()=>engine.execute({...credentials,accountId:'real',accountType:'real'},request(s)),e=>e.code==='DEMO_ONLY');
});
