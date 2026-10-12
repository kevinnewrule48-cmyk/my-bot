import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PartOneExecution} from '../part-one-execution.mjs';
import {analyzeBalance} from '../public/balance-engine.js';
import {createTradeDecision} from '../public/trade-decision.js';
import {executionOutcome} from '../public/premium-model.js';
const flush=()=>new Promise(setImmediate),credentials={accountId:'repair-demo',accountType:'demo'};
function fixture(){
 let wall=1000000,timerId=0;const timers=new Map(),sent=[],logs=[];
 const file=join(mkdtempSync(join(tmpdir(),'execution-repair-')),'journal.json');
 const socket={readyState:1,listeners:{},addEventListener(k,f){(this.listeners[k]??=[]).push(f);},send(raw){const r=JSON.parse(raw);if(r.buy){const stored=JSON.parse(readFileSync(file,'utf8'));assert.ok(Object.values(stored.accounts).some(a=>a.attempts.some(t=>t.buySent&&t.state==='BUY_PENDING')),'intent persisted before transport');}sent.push(r);},reply(r,body){for(const f of this.listeners.message??[])f({data:JSON.stringify({req_id:r.req_id,echo_req:r,...body})});},last(k){return sent.findLast(r=>k in r);}};
 const advance=ms=>{wall+=ms;};
 const engine=new PartOneExecution({file,connect:async()=>socket,now:()=>wall,setTimer:fn=>{timers.set(++timerId,fn);return timerId;},clearTimer:id=>timers.delete(id),log:e=>{logs.push(e);}});
 const request=()=>{const epoch=Math.floor(wall/1000),s=analyzeBalance('R_100',Array.from({length:200},(_,i)=>({digit:[3,5,7,8,9][i%5],epoch:epoch-199+i,price:100+[3,5,7,8,9][i%5]/100}))),c=s.selected;return {attemptId:c.id,decisionId:c.id,decision:createTradeDecision(c,s,{now:wall}),candidate:c,balanceState:s,mode:'auto',type:c.contractType,symbol:c.market,barrier:c.barrier,stake:1,currency:'USD',authorizePurchase:()=>true};};
 const begin=async()=>{const r=request(),flow=engine.execute(credentials,r);await flush();socket.reply(socket.last('ticks'),{tick:{symbol:r.symbol,epoch:r.balanceState.ticks.at(-1).epoch,quote:100.09,pip_size:2}});return {r,flow};};
 return {engine,socket,sent,logs,timers,advance,begin,request,file};
}
function proposal(f,id='fresh-proposal'){f.socket.reply(f.socket.last('proposal'),{proposal:{id,ask_price:1,payout:1.2}});}
function buy(f,id=123){f.socket.reply(f.socket.last('buy'),{buy:{contract_id:id,buy_price:1}});}
function settle(f,id=123){f.socket.reply(f.socket.last('proposal_open_contract'),{proposal_open_contract:{contract_id:id,is_sold:1,status:'won',profit:.2,payout:1.2,entry_tick:100.09,exit_tick:100.09}});}
const last=f=>f.engine.snapshot(credentials.accountId).last;

test('BUY rejection preserves broker fields, clears locks and requires a NEW qualifying signal/proposal',async()=>{
 const f=fixture(),{r,flow}=await f.begin();proposal(f,'rejected-proposal');const rejectedBuy=f.socket.last('buy');
 f.socket.reply(rejectedBuy,{error:{code:'InvalidContractProposal',message:'Unknown contract proposal'},passthrough:{request:'trace-82',token:'DO-NOT-EXPORT'}});
 await assert.rejects(flow.entry,{code:'InvalidContractProposal'});let a=last(f);
 assert.equal(a.failureKind,'BUY_REJECTED');assert.equal(a.derivRejection.response.req_id,rejectedBuy.req_id);assert.deepEqual(a.derivRejection.response.echo_req,rejectedBuy);
 assert.equal(a.derivRejection.response.passthrough.request,'trace-82');assert.equal(JSON.stringify(a.derivRejection).includes('DO-NOT-EXPORT'),false);
 assert.equal(f.engine.current(credentials.accountId),null);assert.equal(f.timers.size,0);assert.equal(f.engine.current(credentials.accountId),null);
 assert.equal(executionOutcome(a).settlement,'NOT APPLICABLE · NO CONTRACT');
 const old=f.engine.execute(credentials,r);await assert.rejects(old.entry);assert.equal(f.sent.filter(x=>x.buy).length,1);
 assert.throws(()=>f.engine.execute(credentials,{...r,attemptId:'same-signal-new-attempt'}),/consumed/);
 f.advance(2000);const next=await f.begin();assert.notEqual(next.r.decisionId,r.decisionId);proposal(f,'new-proposal');assert.equal(f.socket.last('buy').buy,'new-proposal');
 buy(f);settle(f);await next.flow.settlement;assert.equal(f.engine.current(credentials.accountId),null);
});

test('proposal rejection has no BUY and no settlement wait',async()=>{
 const f=fixture(),{flow}=await f.begin();f.socket.reply(f.socket.last('proposal'),{error:{code:'ContractUnavailable',message:'Exact broker proposal error'}});await assert.rejects(flow.entry);
 const a=last(f);assert.equal(a.failureKind,'PROPOSAL_REJECTED');assert.equal(a.error.message,'Exact broker proposal error');assert.equal(f.engine.current(credentials.accountId),null);assert.equal(f.sent.some(r=>r.buy),false);assert.ok(executionOutcome(a).settlement.startsWith('NOT APPLICABLE'));
});

test('accepted contract with delayed settlement remains distinct and recovers without another BUY',async()=>{
 const f=fixture(),{flow}=await f.begin();proposal(f);buy(f);await flow.entry;
 const timer=[...f.timers.values()][0];f.advance(16000);timer();await flush();
 assert.equal(last(f).contractId,123);assert.ok(f.engine.current(credentials.accountId));assert.equal(executionOutcome(last(f)).settlement,'WAITING');
 settle(f);await flow.settlement;assert.equal(f.sent.filter(r=>r.buy).length,1);assert.equal(f.engine.current(credentials.accountId),null);
});

test('socket send failure is uncertain local execution failure, never a fake settlement or retry',async()=>{
 const f=fixture(),{flow}=await f.begin();const send=f.socket.send.bind(f.socket);f.socket.send=raw=>{if(JSON.parse(raw).buy)throw Error('socket transport failed');send(raw);};proposal(f);await assert.rejects(flow.entry);
 assert.ok(f.engine.current(credentials.accountId));assert.equal(executionOutcome(last(f)).settlement,'NOT STARTED · BUY OUTCOME UNCONFIRMED');
});

