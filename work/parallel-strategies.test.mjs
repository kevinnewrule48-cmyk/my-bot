import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DifferEngine,qualifiesDifferFrequency} from '../public/differ-engine.js';
import {DigitBarrierEngine} from '../public/digit-barrier-engine.js';
import {strategyProposal} from '../public/strategy-proposal.js';
import {PartOneExecution} from '../part-one-execution.mjs';
import {DemoRiskLedger} from '../part-one-risk.mjs';
const history=(n=100,count=1)=>Array.from({length:n},(_,i)=>({digit:i>=n-count?3:7}));
const options=sequence=>({context:'R_100',sequence,running:true,cooldownTicks:5});
test('inclusive 6% threshold; not rounded; only jump-off emits once',()=>{
 for(const [n,c,qualifies] of [[100,1,true],[200,2,true],[99,1,true],[100,2,true],[100,6,true],[200,12,true],[100,7,false],[99,6,false],[100,0,false]]){
  const e=new DifferEngine();e.arm(true);assert.equal(e.tick(history(n,c),options(1)),null);
  assert.equal(e.candidate!==null,qualifies);
  const next=e.tick([{digit:8}],options(2));assert.equal(next!==null,qualifies);
  if(next)assert.equal(next.barrier,3);
  assert.equal(e.tick([{digit:8}],options(2)),null);
 }
});
test('every digit 0–9 can arm at 6% then execute only after jump-off',()=>{
 for(let digit=0;digit<=9;digit++){
  const other=(digit+1)%10,history=Array.from({length:100},(_,i)=>({digit:i<94?other:digit}));
  const e=new DifferEngine();e.arm(true);assert.equal(e.tick(history,options(1)),null);assert.equal(e.candidate.digit,digit);
  assert.equal(e.tick(history,options(2)),null);
  const signal=e.tick([{digit:other}],options(3));assert.equal(signal.barrier,digit);assert.equal(signal.type,'DIGITDIFF');assert.equal(signal.count,6);assert.equal(signal.sample,100);
 }
 for(const [count,sample] of [[0,100],[-1,100],[1,0],[1.5,100],[1,Infinity],[7,100],[6,99]])assert.equal(qualifiesDifferFrequency(count,sample),false);
});
test('same cursor waits; stop, disarm and context change clear candidate',()=>{
 const e=new DifferEngine();e.arm(true);e.tick(history(),options(1));
 assert.equal(e.tick([{digit:3}],options(2)),null);assert.equal(e.status,'WAITING FOR JUMP');
 e.tick([{digit:3}],{...options(3),running:false});assert.equal(e.candidate,null);
 e.tick(history(),options(4));e.arm(false);assert.equal(e.tick([{digit:8}],options(5)),null);
 e.arm(true);e.tick(history(),options(6));assert.equal(e.tick([{digit:8}],{...options(7),context:'R_10'}),null);
});
test('both analyzers advance independently, including while either execution is open',()=>{
 const ou=new DigitBarrierEngine(),diff=new DifferEngine();diff.arm(true);
 for(let i=1;i<=5;i++){
  const snapshot=ou.analyze(history(),{context:'R_100',sequence:i});
  diff.tick(history(),options(i));assert.equal(snapshot.sequence,i);assert.equal(diff.sequence,i);
  if(i===2)diff.pending('test');
 }
 assert.equal(ou.sequence,5);assert.equal(diff.status,'CONTRACT OPEN');
});
test('DIFFER routing rejects OU and wrong contract settlement, keeps independent cooldown',()=>{
 const e=new DifferEngine();e.arm(true);e.tick(history(),options(1));e.tick([{digit:7}],options(2));e.pending('a');
 assert.equal(e.observe({strategy:'OVER_UNDER',attemptId:'a',contractId:1,state:'settled',status:'won'}),false);
 e.observe({strategy:'DIFFER',attemptId:'a',contractId:2,state:'entered'});
 assert.equal(e.observe({strategy:'DIFFER',attemptId:'a',contractId:3,state:'settled',status:'won'}),false);
 e.observe({strategy:'DIFFER',attemptId:'a',contractId:2,state:'settled',status:'won'});
 assert.equal(e.cooldown,5);assert.equal(e.status,'WIN');
 assert.equal(e.observe({strategy:'DIFFER',attemptId:'a',contractId:2,state:'settled',status:'won'}),false);
 for(let i=3;i<=7;i++)e.tick([{digit:7}],options(i));assert.equal(e.cooldown,0);
});
test('proposal specifies DIGITDIFF, integer barrier, 1 tick and verified currency',()=>{
 assert.deepEqual(strategyProposal({type:'DIGITDIFF',barrier:3,symbol:'R_100',stake:1,currency:'USD'}),{proposal:1,amount:1,basis:'stake',contract_type:'DIGITDIFF',currency:'USD',duration:1,duration_unit:'t',barrier:'3',underlying_symbol:'R_100'});
 for(const barrier of [-1,10,1.5,'3',null])assert.throws(()=>strategyProposal({type:'DIGITDIFF',barrier,symbol:'R_100',stake:1}));
});
class Socket{
 readyState=1;sent=[];listeners={};addEventListener(n,fn){(this.listeners[n]??=[]).push(fn);}send(raw){this.sent.push(JSON.parse(raw));}
 reply(req,data){for(const fn of this.listeners.message??[])fn({data:JSON.stringify({...data,req_id:req.req_id})});}
 last(key){return this.sent.filter(r=>key in r).at(-1);}
}
const credentials={accountId:'demo',accountType:'demo',token:'mock'};
const base={authorizePurchase:()=>true,symbol:'R_100',stake:1,currency:'USD',mode:'auto'};
const flush=()=>new Promise(setImmediate);
test('close signals: explicit account lock, unique IDs, tagged settlement, no duplicate BUY',async()=>{
 const s=new Socket(),results=[],engine=new PartOneExecution({connect:async()=>s,onSettled:(id,a,r)=>results.push(r)});
 let previousMonitor=null;
 for(const [type,id] of [['DIGITOVER',1],['DIGITDIFF',2],['DIGITUNDER',3]]){
  const request={...base,type,barrier:4,attemptId:'attempt-'+id},flow=engine.execute(credentials,request);
  assert.throws(()=>engine.execute(credentials,{...base,type:'DIGITDIFF',barrier:8,attemptId:'other-'+id}),e=>e.code==='EXECUTION_BUSY');
  assert.equal(engine.execute(credentials,request).entry,flow.entry);
  await flush();s.reply(s.last('proposal'),{proposal:{id:'p'+id,ask_price:1,payout:1.1}});
  s.reply(s.last('buy'),{buy:{contract_id:id,buy_price:1}});const entry=await flow.entry;
  assert.equal(entry.strategy,type==='DIGITDIFF'?'DIFFER':'OVER_UNDER');
  const monitor=s.last('proposal_open_contract');
  if(previousMonitor)s.reply(previousMonitor,{proposal_open_contract:{contract_id:id-1,is_sold:1,status:'lost',profit:-1}});
  s.reply(monitor,{proposal_open_contract:{contract_id:999,is_sold:1,status:'lost',profit:-1}});
  assert.equal(results.length,id-1);
  s.reply(monitor,{proposal_open_contract:{contract_id:id,is_sold:1,status:'won',profit:.1,entry_tick:'100.03',exit_tick:'100.07'}});
  assert.equal((await flow.settlement).contractId,id);previousMonitor=monitor;
 }
 assert.equal(s.sent.filter(r=>r.buy).length,3);assert.deepEqual(results.map(r=>r.strategy),['OVER_UNDER','DIFFER','OVER_UNDER']);
});
test('Stop or disarm before proposal returns prevents either strategy BUY',async()=>{
 for(const type of ['DIGITOVER','DIGITDIFF']){
  const s=new Socket(),engine=new PartOneExecution({connect:async()=>s});let running=true;
  const flow=engine.execute(credentials,{...base,type,barrier:3,authorizePurchase:()=>running});await flush();running=false;
  s.reply(s.last('proposal'),{proposal:{id:'p',ask_price:1,payout:1.1}});
  await assert.rejects(flow.entry,e=>e.code==='AUTO_STOPPED');assert.equal(s.sent.filter(r=>r.buy).length,0);
 }
});
test('independent server cooldowns, shared account exposure lock remains atomic',()=>{
 const ledger=new DemoRiskLedger(),req={stake:1,mode:'auto',symbol:'R_100',strategy:'DIFFER'};
 const id=ledger.reserve('demo',req);assert.throws(()=>ledger.reserve('demo',{...req,strategy:'OVER_UNDER'}),e=>e.code==='PENDING');
 ledger.settle('demo',id,{status:'won',profit:.1});assert.doesNotThrow(()=>ledger.check('demo',{...req,strategy:'OVER_UNDER'}));
 assert.throws(()=>ledger.check('demo',req),e=>e.code==='COOLDOWN');
});
