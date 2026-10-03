// Local research only. Actual service lifecycle with mock RPC; never opens a socket.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {RiseFallEngine} from '../public/rise-fall/engine.js';
import {presetConfig} from '../public/rise-fall/presets.js';
import {RiseFallService} from '../rise-fall-service.mjs';
const out=process.env.RF_V2_OUTPUT??'../../outputs/balanced-v2';mkdirSync(out,{recursive:true});
const symbols=['R_10','R_25','R_100','1HZ100V','JD10','JD100','stpRNG','stpRNG2'],profiles=['original','exploration','balanced','balancedV2'],v2Only=process.argv.includes('--v2-only'),results=v2Only?JSON.parse(readFileSync(out+'/comparison.json','utf8')).results.filter(r=>r.profile!=='balancedV2'):[];
async function run(recording,profile,partition){
 const split=Math.floor(recording.ticks.length*.6),begin=partition==='training'?300:split,end=partition==='training'?split:recording.ticks.length;
 let index=begin-1,now=recording.ticks[index].epoch*1000,pending=null,task=null,contract=null,nextId=0;
 const e=new RiseFallEngine(recording.symbol,presetConfig(profile)),service=new RiseFallService({now:()=>now});
 for(const tick of recording.ticks.slice(Math.max(0,begin-300),begin))e.add(tick,{live:false});
 // Inject replay authorization in this mock-only harness; production evidence is untouched.
 service.validation=()=>true;service.verifiedDurations=()=>[{duration:5,unit:'t'}];
 const c={owner:'replay',id:'replay',account:{account_id:'mock-demo',account_type:'demo',currency:'USD'},session:{expiresAt:recording.ticks[end-1].epoch*1000+86400000},symbol:recording.symbol,config:e.config,engine:e,contracts:recording.contracts,contractsAt:now,used:new Set(),running:false,heartbeat:now,rpc:{closed:false,request:async q=>{
  if(q.proposal)return new Promise((resolve,reject)=>{pending={resolve,reject,request:q,at:index};});
  if(q.buy){contract={id:++nextId,entryIndex:index,exitIndex:index+5,entryQuote:recording.ticks[index].quote};return {buy:{contract_id:contract.id,buy_price:1}};}
  if(q.proposal_open_contract)return {proposal_open_contract:{contract_id:q.contract_id,is_sold:0,entry_tick:contract.entryQuote}};
  throw Error('Unexpected mock request');
 }}};
 service.contexts.set('replay',c);service.start('replay',{sessionId:'replay',stake:1,duration:5,unit:'t',demoLimits:{mode:'unlimited'}});
 const states={},stateSeconds={},rejections={},candidates=[],legacySignals=new Set();let previousState='OBSERVING',previousAt=now;
 for(index=begin;index<end;index++){
  const tick=recording.ticks[index];now=tick.epoch*1000;c.heartbeat=now;c.contractsAt=now;e.add(tick,{receivedAt:now});const a=e.snapshot(now);
  const display=a.confirmation?.state??(a.winner?a.winner.name+' READY':a.candidates?.reduce((best,s)=>!best||s.confidence>best.confidence?s:best,null)?.balanced?.state??a.marketState);
  states[display]=(states[display]??0)+1;stateSeconds[previousState]=(stateSeconds[previousState]??0)+(now-previousAt)/1000;previousState=display;previousAt=now;
  if(a.signalId)legacySignals.add(a.signalId);if(!a.winner)rejections[a.reason]=(rejections[a.reason]??0)+1;
  if(profile==='balancedV2')candidates.push({index,epoch:tick.epoch,state:display,reason:a.reason,confirmation:a.confirmation,candidates:a.candidates.map(s=>({type:s.type,ready:s.ready,metrics:s.balanced.metrics,blocked:s.blocked}))});
  if(contract&&index>=contract.exitIndex){const order=service.journal.find(o=>o.contractId===contract.id),delta=tick.quote-contract.entryQuote,won=order.type==='CALL'?delta>0:delta<0;order.replay={...contract,exitQuote:tick.quote,tie:delta===0};service.applySettlement(c,order,{contract_id:contract.id,is_sold:1,status:won?'won':'lost',profit:won?.9:-1,entry_tick:contract.entryQuote,exit_tick:tick.quote});service.save();contract=null;}
  if(pending&&index>pending.at){const p=pending;pending=null;p.resolve({echo_req:p.request,proposal:{id:'mock-'+index,ask_price:1,payout:1.9}});await task;task=null;}
  if(!task){const next=service.maybeExecute(c);if(c.pending)task=next;else await next;}
 }
 if(pending){pending.reject(Error('Recording ended before proposal response'));await task;}
 const settled=service.journal.filter(o=>o.state==='SETTLED');let streak=0,maxLosses=0;for(const o of settled){streak=o.result==='lost'?streak+1:0;maxLosses=Math.max(streak,maxLosses);}
 const orders=service.journal.map(o=>({...o,accountId:undefined}));
 if(profile==='balancedV2')writeFileSync(`${out}/${recording.symbol}-${partition}-candidates.json`,JSON.stringify(candidates));
 const summary={symbol:recording.symbol,profile,partition,ticks:end-begin,candidateCount:e.trend?.totals.candidates??legacySignals.size,confirmedDirectionCount:e.trend?.totals.confirmed??null,readyCount:e.trend?.totals.ready??legacySignals.size,preBuyCancellationCount:orders.filter(o=>o.state==='REJECTED').length,executedCount:orders.filter(o=>o.contractId).length,settledCount:settled.length,wins:settled.filter(o=>o.result==='won').length,losses:settled.filter(o=>o.result==='lost').length,maxConsecutiveLosses:maxLosses,stateObservations:states,stateSeconds,rejections,retainedCandidateEvents:e.trend?.events??[],orders};
 return summary;
}
for(const symbol of symbols){const r=JSON.parse(readFileSync('outputs/rise-fall/'+symbol+'.json','utf8'));if(r.source!=='Deriv public ticks_history')throw Error('Expected public recorded ticks');for(const profile of (v2Only?['balancedV2']:profiles))for(const partition of ['training','validation'])results.push(await run(r,profile,partition));console.log('Compared',symbol);}
writeFileSync(out+'/comparison.json',JSON.stringify({generatedAt:new Date().toISOString(),method:'Eight recorded markets. Chronological 60/40 partitions with 300 past ticks for warmup and explicit arming at each partition. Actual engine and service proposal/pre-BUY/BUY/contract/settlement lifecycle via controlled mock RPC. Proposal response arrives one recorded tick later; expiry five ticks after mock BUY. Equal exit price is a loss. Fixed V2 policy selected on adversarial temporal tests, not outcomes. Legacy candidate/READY counts are signal episodes; legacy temporal-confirmed counts are unavailable.',limitations:['No authenticated broker trades or actual network latency.','Recorded snapshots are not genuinely unseen prospective data.','Mock payout 1.9 is used only to exercise settlement; no profitability claim.','Single selected market per run, no portfolio/automatic-market-selection performance claim.'],profiles,symbols,results},null,2));
console.log('Completed',results.length,'profile/partition runs');
