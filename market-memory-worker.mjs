import {ShadowGatekeeper} from './shadow-gatekeeper.mjs';
import {parentPort,workerData} from 'node:worker_threads';
import {MemoryStore} from './market-memory-store.mjs';
import {MarketMemory} from './market-memory.mjs';
import {analyzeBalance,BALANCE_MARKETS} from './public/balance-engine.js';
const store=new MemoryStore(workerData.file),memory=new MarketMemory(store),histories=new Map(),latest=new Map();
const gatekeeper=new ShadowGatekeeper(store);
parentPort.on('message',message=>{try{store.check();const {kind,owner,account,ticks,symbol}=message;let result;
 if(kind==='scan'){for(const {owner,attempt} of message.attempts.sort((a,b)=>a.attempt.startedAt-b.attempt.startedAt)){memory.capture(owner,attempt);memory.settle(owner,attempt);gatekeeper.settle(owner,attempt);}result={ok:true};}
 else if(kind==='export')result=store.export(owner);
 else {
 if(kind==='observe'){
 if(!Array.isArray(ticks)||ticks.length>1000)throw Error('Invalid tick batch');
 for(const t of ticks){if(!BALANCE_MARKETS.includes(t.market)||!Number.isInteger(t.digit)||t.digit<0||t.digit>9||!Number.isFinite(t.epoch)||!Number.isFinite(t.price)||t.price<=0)continue;
 const key=owner+':'+t.market,h=histories.get(key)??[];if(t.epoch<=(h.at(-1)?.epoch??-Infinity))continue;if(h.length&&t.epoch-h.at(-1).epoch>60)h.length=0;
 h.push({digit:t.digit,epoch:t.epoch,price:t.price});if(h.length>200)h.shift();histories.set(key,h);if(h.length<2)continue;
 const state=analyzeBalance(t.market,h);gatekeeper.observe(owner,state);latest.set(key,state.candidates.map(c=>memory.observe(owner,state,c,JSON.stringify([account.account_type,'OVER_UNDER',c.contractType,c.barrier,account.currency,'stake',1,'t']))));}
 }
 const views=latest.get(owner+':'+symbol)??[];
 result={mode:'SHADOW',execution:'UNCHANGED',storage:'SERVER SQLITE',schema:2,views,gatekeeper:gatekeeper.status(owner,symbol),metrics:memory.metrics(owner),warning:views.length?null:'Collecting live fingerprints; historical memory is retained',source:'Browser tick telemetry; outcomes only from server execution ledger'};
 }
 parentPort.postMessage({id:message.id,result});
 }catch(e){parentPort.postMessage({id:message.id,error:e.message});}});
