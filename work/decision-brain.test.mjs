import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeBalance,BalanceBook,BALANCE_MARKETS} from '../public/balance-engine.js';
import {evaluateBrain,assessCandidate,BARRIER_KEYS} from '../public/decision-brain.js';
import {createTradeDecision} from '../public/trade-decision.js';
import {validateBalanceRequest,assertProposalBinding} from '../balance-authorization.mjs';
import {purchasePermission,setAutoEligibility} from '../execution-permission.mjs';
import {PartOneExecution} from '../part-one-execution.mjs';
import {TradabilityMarkets} from '../public/tradability-markets.js';
import {mountEnvironmentPanel} from '../public/edge-environment-panel.js';
const patterns=[[2,3,7,8,9],[3,5,7,8,9],[7,6,2,1,0],[6,4,2,1,0]];
const rows=(p,n=200)=>Array.from({length:n},(_,i)=>({digit:p[i%p.length],epoch:1000-n+1+i,price:100+p[i%p.length]/100}));
const mask=keys=>Object.fromEntries(BARRIER_KEYS.map(k=>[k,keys.includes(k)]));
const configurations=[...BARRIER_KEYS.map(k=>[k]),['OVER:1','UNDER:8'],['OVER:2','UNDER:7'],['OVER:1','OVER:2'],['UNDER:8','UNDER:7'],BARRIER_KEYS,[]];
class Socket{readyState=1;sent=[];listeners={};addEventListener(n,f){(this.listeners[n]??=[]).push(f);}send(s){this.sent.push(JSON.parse(s));}last(k){return this.sent.findLast(r=>k in r);}reply(r,d){for(const f of this.listeners.message??[])f({data:JSON.stringify({req_id:r.req_id,echo_req:r,...d})});}}
const flush=()=>new Promise(setImmediate);
for(const keys of configurations)test('eligibility '+(keys.join(',')||'NONE')+' retains analysis and exact purchase binding',async()=>{
 const m=mask(keys);let reached=new Set();
 for(const p of patterns){const s=analyzeBalance('R_100',rows(p)),brain=evaluateBrain(s,m);
  assert.equal(s.candidates.length,4);assert.equal(brain.evaluations.length,4);
  for(const c of s.candidates)if(!m[c.direction+':'+c.barrier])assert.throws(()=>createTradeDecision(c,s,{now:1000000,autoEligibility:m}));
  if(!brain.selected){assert.equal(brain.action==='TAKE',false);continue;}
  const c=brain.selected;reached.add(c.direction+':'+c.barrier);
  const decision=createTradeDecision(c,s,{now:1000000,autoEligibility:m});
  const session={expiresAt:2000000,autoControl:{running:true,live:true,accountId:'demo',runId:'r',overUnder:true,startedAt:1000000}};setAutoEligibility(session,m);
  const request={decision,candidate:c,balanceState:s,type:c.contractType,barrier:c.barrier,symbol:c.market,mode:'auto',accountId:'demo',strategy:'OVER_UNDER',executionSessionId:'r',signalAt:1000000,gatePassed:true,decisionId:c.id,attemptId:c.id,stake:1,currency:'USD'};
  request.authorizePurchase=purchasePermission(session,request,()=>1000000);validateBalanceRequest(request,1000000);
  const socket=new Socket(),engine=new PartOneExecution({connect:async()=>socket,now:()=>1000000});
  const flow=engine.execute({accountId:'demo',accountType:'demo',token:'MOCK'},request);await flush();
  socket.reply(socket.last('ticks'),{tick:{symbol:c.market,epoch:1000,quote:s.ticks.at(-1).price,pip_size:2}});
  const proposal=socket.last('proposal');assertProposalBinding(request,proposal);
  socket.reply(proposal,{proposal:{id:'p',ask_price:1,payout:1.1}});assert.equal(socket.last('buy').buy,'p');
  socket.reply(socket.last('buy'),{buy:{contract_id:1,buy_price:1}});await flow.entry;
  socket.reply(socket.last('proposal_open_contract'),{proposal_open_contract:{contract_id:1,contract_type:c.contractType,barrier:c.barrier,underlying:c.market,is_sold:1,status:'lost',profit:-1,payout:0,entry_tick:s.ticks.at(-1).price,exit_tick:100,pip_size:2}});await flow.settlement;
 }
 for(const k of keys)assert.ok(reached.has(k),'enabled candidate reachable: '+k);
});
test('disabling an existing decision before delayed proposal response causes zero BUY',async()=>{
 const s=analyzeBalance('R_100',rows(patterns[1])),c=s.selected,decision=createTradeDecision(c,s,{now:1000000});
 const session={expiresAt:2000000,autoControl:{running:true,live:true,accountId:'demo',runId:'r',overUnder:true,startedAt:1000000}};
 const request={decision,candidate:c,balanceState:s,decisionId:c.id,type:c.contractType,barrier:c.barrier,symbol:c.market,mode:'auto',strategy:'OVER_UNDER',accountId:'demo',executionSessionId:'r',signalAt:1000000,gatePassed:true,attemptId:'disable',stake:1,currency:'USD'};
 request.authorizePurchase=purchasePermission(session,request,()=>1000000);
 const socket=new Socket(),engine=new PartOneExecution({connect:async()=>socket,now:()=>1000000});const flow=engine.execute({accountId:'demo',accountType:'demo'},request);await flush();
 socket.reply(socket.last('ticks'),{tick:{symbol:'R_100',epoch:1000,quote:s.ticks.at(-1).price,pip_size:2}});
 setAutoEligibility(session,mask([]));assert.equal(request.authorizePurchase(),false);assert.match(request.authorizePurchase.failureReason(),/BARRIER DISABLED/);
 socket.reply(socket.last('proposal'),{proposal:{id:'p',ask_price:1,payout:1.1}});await assert.rejects(flow.entry);assert.equal(socket.sent.some(r=>r.buy),false);
});
test('short burst WAIT, established TAKE, danger return REJECT without changing scale math',()=>{
 const short=analyzeBalance('R_100',rows([5,6],2));assert.ok(short.selected);assert.equal(evaluateBrain(short).action,'WAIT');
 const established=analyzeBalance('R_100',rows(patterns[1]));assert.equal(evaluateBrain(established).action,'TAKE');
 const changed=analyzeBalance('R_100',[...established.ticks,{digit:0,epoch:1001}]);const c=changed.candidates.find(c=>c.label===established.selected.label);
 assert.equal(assessCandidate(changed,c).action,'REJECT');
});
test('five independent feed histories, states, hashes, environments and updates',()=>{
 const book=new BalanceBook({now:()=>1000000});const feed=new TradabilityMarkets({onTick:t=>book.push(t.market,t)});
 const regimes=[...patterns,[0,9]];
 for(let i=0;i<200;i++)for(let m=0;m<5;m++)feed.push(BALANCE_MARKETS[m],100+regimes[m][i%regimes[m].length]/100,801+i,2);
 const states=[...book.states.values()];assert.equal(new Set(states.map(s=>s.id)).size,5);
 for(let i=0;i<5;i++){assert.deepEqual(states[i],analyzeBalance(BALANCE_MARKETS[i],rows(regimes[i])));assert.notEqual(book.histories.get(BALANCE_MARKETS[i]),book.histories.get(BALANCE_MARKETS[(i+1)%5]));assert.notEqual(states[i].environment,states[(i+1)%5].environment);}
 const others=states.slice(1),environments=BALANCE_MARKETS.slice(1).map(m=>feed.environment.states.get(m));feed.push('R_10',100.05,1001,2);
 for(let i=1;i<5;i++){assert.equal(book.current(BALANCE_MARKETS[i]),others[i-1]);assert.equal(feed.environment.states.get(BALANCE_MARKETS[i]),environments[i-1]);}
});
test('one/few tick ranking leads do not bounce execution; deterioration releases selection',()=>{
 const b=new BalanceBook({now:()=>1000000});b.setEligibility(mask(['OVER:1']));b.executionMarket='R_10';
 const incumbent=Array.from({length:200},(_,i)=>i%10===0?0:9),challenger=[...incumbent];challenger[0]=9;
 for(let i=0;i<200;i++){b.push('R_10',{digit:incumbent[i],epoch:801+i});b.push('R_25',{digit:challenger[i],epoch:801+i});}
 assert.ok(b.autoCandidate('R_10'));assert.ok(b.autoCandidate('R_25'));assert.equal(b.best().market,'R_10');
 for(let j=1;j<=3;j++){b.push('R_25',{digit:9,epoch:1000+j});assert.equal(b.best(1000000+j*1000).market,'R_10');}
 b.push('R_10',{digit:0,epoch:1003});assert.equal(b.best(1003000),null);b.push('R_10',{digit:0,epoch:1004});const next=b.best(1004000);assert.equal(next.market,'R_25');b.selectExecution(next,1004000);assert.equal(b.selectionReason.reason,'CONFIRMED DETERIORATION');
});
test('material superiority in both blocks and broad history can replace a still-valid market',()=>{
 const b=new BalanceBook({now:()=>1000000});b.setEligibility(mask(['OVER:1']));b.executionMarket='R_10';
 for(let i=0;i<200;i++){b.push('R_10',{digit:i%7===0?0:8,epoch:801+i});b.push('R_25',{digit:9,epoch:801+i});}
 assert.equal(b.best(),null);for(let i=1;i<=2;i++){b.push('R_10',{digit:8,epoch:1000+i});b.push('R_25',{digit:9,epoch:1000+i});b.best(1000000+i*1000);}const next=b.best(1002000);assert.equal(next.market,'R_25');b.selectExecution(next,1002000);assert.equal(b.selectionReason.reason,'PERSISTENT STRONGER CHALLENGER');
});
test('each displayed bar reads only its named market accumulated value',()=>{
 const previous=globalThis.document;const buttons=[];
 const group={append:b=>buttons.push(b)},detail={textContent:''},details={open:false};
 const host={dataset:{},querySelector:s=>s==='.environment-rows'?group:s==='.environment-detail'?detail:details};
 globalThis.document={createElement:()=>{const nodes={span:{},meter:{value:0},small:{}};return {querySelector:s=>nodes[s],setAttribute(){}};}};
 try{const states=new Map();const feed=new TradabilityMarkets();for(let i=0;i<5;i++){for(const t of rows([...patterns,[0,9]][i]))feed.push(BALANCE_MARKETS[i],t.price,t.epoch,2);states.set(BALANCE_MARKETS[i],feed.environment.states.get(BALANCE_MARKETS[i]));}
 const render=mountEnvironmentPanel(host,()=>states);render();for(let i=0;i<5;i++)assert.equal(buttons[i].querySelector('meter').value,states.get(BALANCE_MARKETS[i]).environment.establishedActivity);
 const old=buttons.map(b=>b.querySelector('meter').value);feed.push('R_10',100.01,1001,2);states.set('R_10',feed.environment.states.get('R_10'));render();for(let i=1;i<5;i++)assert.equal(buttons[i].querySelector('meter').value,old[i]);
 }finally{globalThis.document=previous;}
});


test('disable then reenable invalidates old OU permission without revoking DIFFER or Manual',()=>{
 const session={expiresAt:2000000,autoControl:{running:true,live:true,accountId:'demo',runId:'r',overUnder:true,differ:true,startedAt:1000000}};
 const req={mode:'auto',strategy:'OVER_UNDER',type:'DIGITOVER',barrier:1,accountId:'demo',executionSessionId:'r',signalAt:1000000,gatePassed:true,decisionId:'d'};
 const ou=purchasePermission(session,req,()=>1000000),diff=purchasePermission(session,{...req,strategy:'DIFFER',type:'DIGITDIFF'},()=>1000000);
 session.manualIntent={id:'m',attemptId:'a',accountId:'demo',type:'DIGITOVER',expiresAt:2000000};
 const manual=purchasePermission(session,{...req,mode:'manual',executionSessionId:'m',attemptId:'a'},()=>1000000);
 assert.ok(ou()&&diff()&&manual());setAutoEligibility(session,mask([]));assert.equal(ou(),false);assert.ok(diff()&&manual());
 setAutoEligibility(session,mask(BARRIER_KEYS));assert.equal(ou(),false);assert.match(ou.failureReason(),/eligibility changed/);assert.ok(diff()&&manual());
 assert.ok(purchasePermission(session,req,()=>1000000)());
});

test('Auto decision request fits current HTTP payload limit with full history',()=>{
 const s=analyzeBalance('R_100',rows(patterns[1]));const c=s.selected;
 const decision=createTradeDecision(c,s,{now:1000000,selection:{from:'R_25',to:'R_100',reason:'CURRENT MARKET DETERIORATED'}});
 const wire={attemptId:c.id,decisionId:c.id,decision,barrier:c.barrier,strategyEvidence:{selected:c.type,checks:c.checks},symbol:c.market,type:c.contractType,accountId:'demo',accountType:'demo',mode:'auto',stake:1,executionSessionId:'r',signalAt:1000000,gatePassed:true};
 assert.ok(Buffer.byteLength(JSON.stringify(wire))<32768);
});


test('HTTP eligibility rejects stale pages and out-of-order revisions; server owns the mask',async()=>{
 const {readFile}=await import('node:fs/promises'),{default:vm}=await import('node:vm');
 const source=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
 const session={executionPageId:'page',autoEligibilityRevision:0};
 const context=vm.createContext({http:{createServer:handler=>({handler})},URL,Date,Number,JSON,Error,setAutoEligibility,getSession:()=>session,readJson:async req=>req.body,json:(res,status,body)=>Object.assign(res,{status,body}),riseFallRoute:async()=>false,partTwoOrders:async()=>false});
 vm.runInContext(source.slice(source.indexOf('const server = http.createServer'),source.indexOf('const port ='))+'\nglobalThis.handler=server.handler;',context);
 const call=async body=>{const r={};await context.handler({url:'/api/auto/eligibility',method:'POST',headers:{host:'mock'},body},r);return r;};
 assert.equal((await call({pageId:'old',revision:1,eligibility:mask([])})).status,400);
 assert.equal((await call({pageId:'page',revision:2,eligibility:mask(['UNDER:7'])})).status,200);
 assert.deepEqual(session.autoEligibility,mask(['UNDER:7']));
 assert.equal((await call({pageId:'page',revision:1,eligibility:mask(BARRIER_KEYS)})).status,400);
 assert.deepEqual(session.autoEligibility,mask(['UNDER:7']));
 assert.equal((await call({pageId:'page',revision:3,eligibility:{'OVER:1':true}})).status,400);
 assert.equal((await call({pageId:'page',revision:3,eligibility:mask([])})).status,200);
 assert.deepEqual(session.autoEligibility,mask([]));
});
