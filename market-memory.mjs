import {digest} from './market-memory-store.mjs';
export const MEMORY_POLICY=Object.freeze({version:1,minimum:30,highConfidence:60,similarity:.8,halfLifeDays:30,confirmations:3,changeDistance:.2});
const clamp=x=>Math.max(0,Math.min(1,x));
export function fingerprint(state,candidate=null){
 const ticks=state.ticks;if(!Array.isArray(ticks)||ticks.length<2||ticks.some((t,i)=>!Number.isInteger(t.digit)||t.digit<0||t.digit>9||!Number.isFinite(t.epoch)||(i&&t.epoch<=ticks[i-1].epoch)))throw Error('Invalid memory observations');
 const dist=rows=>Array.from({length:10},(_,d)=>rows.filter(t=>t.digit===d).length/rows.length),broad=dist(ticks),recent=dist(ticks.slice(-25));
 const prices=ticks.slice(-50).map(t=>t.price),valid=prices.every(p=>Number.isFinite(p)&&p>0),returns=valid?prices.slice(1).map((p,i)=>(p-prices[i])/prices[i]):[];
 const volatility=returns.length?Math.sqrt(returns.reduce((s,r)=>s+r*r,0)/returns.length):null;
 const f={version:1,symbol:state.market,at:ticks.at(-1).epoch*1000,broad,recent,extreme:broad[0]+broad[1]+broad[8]+broad[9],stability:clamp((state.fine?.stability??0)/100),volatility,transition:ticks.slice(1).reduce((s,t,i)=>s+Math.abs(t.digit-ticks[i].digit),0)/(9*(ticks.length-1)),balance:state.position/100,side:candidate?.direction??null,barrier:candidate?.barrier??null,strength:candidate?.strength??null,ready:candidate?.ready??false,pressure:candidate?.entryEdge?.pressure??null};
 return {...f,id:digest(f)};
}
export function similarity(a,b){if(a.version!==b.version||a.symbol!==b.symbol)return 0;const tv=(x,y)=>x.reduce((s,v,i)=>s+Math.abs(v-y[i]),0)/2;const vol=a.volatility===null||b.volatility===null?0:Math.abs(a.volatility-b.volatility)/Math.max(a.volatility,b.volatility,1e-9);return clamp(1-(.35*tv(a.broad,b.broad)+.25*tv(a.recent,b.recent)+.15*Math.abs(a.extreme-b.extreme)+.1*Math.abs(a.stability-b.stability)+.1*vol+.05*Math.abs(a.transition-b.transition)));}
export function summarize(current,rows,configuration,at=current.at){
 const matches=rows.filter(r=>r.at<at&&r.configuration===configuration).map(r=>({r,s:similarity(current,r.fingerprint)})).filter(x=>x.s>=MEMORY_POLICY.similarity);
 let sw=0,sw2=0,pnl=0,wins=0,rawProfit=0,run=0,maxLossRun=0,weightedSimilarity=0;
 const weighted=matches.map(({r,s})=>{const w=s*2**(-(at-r.at)/(86400000*MEMORY_POLICY.halfLifeDays));sw+=w;sw2+=w*w;pnl+=w*r.return;wins+=w*Number(r.won);rawProfit+=r.profit;weightedSimilarity+=w*s;run=r.won?0:run+1;maxLossRun=Math.max(maxLossRun,run);return {r,w};});
 const effective=sw2?sw*sw/sw2:0,mean=sw?pnl/sw:0,variance=sw?weighted.reduce((s,{r,w})=>s+w*(r.return-mean)**2,0)/sw:0;
 // Conservative uncertainty floor avoids certainty from identical small samples.
 const margin=1.96*Math.sqrt(Math.max(variance,.25)/Math.max(effective,1));
 const enough=matches.length>=30&&effective>=30,high=matches.length>=60&&effective>=60;
 const state=!enough?'UNKNOWN':high&&mean+margin<0?'BAD':high&&mean-margin>0?'GOOD':'CAUTION';
 return {state,confidence:high?'HIGH':enough?'LOW':'INSUFFICIENT DATA',sample:matches.length,effectiveSample:effective,similarity:sw?weightedSimilarity/sw:0,weightedWinRate:sw?wins/sw:null,rawWins:matches.filter(x=>x.r.won).length,rawLosses:matches.filter(x=>!x.r.won).length,rawProfit,weightedReturn:mean,interval:[mean-margin,mean+margin],maxLossRun,reason:!enough?'Insufficient settled outcomes':state==='BAD'?'Similar settled trades have a negative return interval':state==='GOOD'?'Similar settled trades have a positive return interval':'Historical outcome uncertainty overlaps break-even'};
}
export function transition(previous,fp,stats){
 const p=previous??{state:'UNKNOWN',blocked:false,run:0,lastAt:0,recoveredAt:0};if(fp.at<=p.lastAt)return p;
 const n={...p,lastAt:fp.at,reason:stats.reason};const changed=p.anchor&&1-similarity(fp,p.anchor)>=MEMORY_POLICY.changeDistance;
 if(p.blocked){
  if(!changed||stats.state==='BAD'){Object.assign(n,{state:'BAD',run:0,reason:'Still similar to the stored dangerous condition'});}
  else {n.run=(p.run??0)+1;n.state=n.run===1?'OBSERVING':n.run<3?'RECOVERING':stats.state==='GOOD'?'GOOD':stats.state==='CAUTION'?'CAUTION':'UNKNOWN';n.reason='Material distribution change persists; '+stats.reason;if(n.run>=3){n.blocked=false;n.recoveredAt=fp.at;n.run=0;}}
 }else if(stats.state==='BAD'){n.run=p.target==='BAD'?p.run+1:1;n.target='BAD';if(n.run>=3){n.state='BAD';n.blocked=true;n.anchor=fp;n.run=0;}else n.state='CAUTION';}
 else {n.run=p.target===stats.state?p.run+1:1;n.target=stats.state;if(n.run>=3||p.state==='UNKNOWN'&&stats.state==='UNKNOWN'){n.state=stats.state;n.run=0;}}
 return n;
}
export function memoryPermission(state,signalAt,{shadow=true,qualified=false,storageOK=true}={}){
 const wouldAllow=storageOK&&!state?.blocked&&signalAt>(state?.recoveredAt??0)&&qualified;
 return {allowed:shadow?qualified:wouldAllow,wouldAllow,mode:shadow?'SHADOW':'TEST ENFORCEMENT',reason:!storageOK?'Memory storage unavailable':state?.blocked?'Paused by historical market memory':signalAt<=(state?.recoveredAt??0)?'Blocked-era signal expired; require new analysis':!qualified?'Normal Part One qualification required':'Normal qualification remains required'};
}
export class MarketMemory{
 constructor(store){this.store=store;}
 key(owner,fp,configuration){return owner+':'+fp.symbol+':'+digest(configuration);}
 observe(owner,state,candidate,configuration){const fp=fingerprint(state,candidate),stats=summarize(fp,this.store.rows('outcomes',owner,fp.symbol),configuration),key=this.key(owner,fp,configuration),prior=this.store.state(key),next=transition(prior,fp,stats);
 this.store.put('observations',digest([owner,fp.id,configuration]),owner,fp.symbol,fp.at,{fingerprint:fp,configuration,stats});this.store.saveState(key,next);if(prior?.state!==next.state||prior?.blocked!==next.blocked)this.store.transition(owner,{at:fp.at,symbol:fp.symbol,configuration,from:prior?.state??'UNKNOWN',to:next.state,reason:next.reason});return {fingerprint:fp,stats,...next,mode:'SHADOW',execution:'UNCHANGED',would:next.blocked?'WOULD BLOCK':stats.state==='UNKNOWN'||stats.state==='CAUTION'?'WOULD CAUTION':'WOULD ALLOW',permission:memoryPermission(next,fp.at,{qualified:!!candidate?.ready})};}
 capture(owner,attempt){const r=attempt.request;if(!r?.balanceState||!r?.candidate||r.strategy!=='OVER_UNDER')return null;const fp=fingerprint(r.balanceState,r.candidate),configuration=JSON.stringify([r.accountType,r.strategy,r.type,r.barrier,r.currency,'stake',1,'t']);const id=digest([owner,attempt.attemptId]);
 // Entry comparison excludes settlements at/after authorization even when observed later.
 const stats=summarize(fp,this.store.rows('outcomes',owner,fp.symbol),configuration,attempt.startedAt),state=this.store.state(this.key(owner,fp,configuration));
 const blocked=!!(state?.blocked&&state.lastAt<=attempt.startedAt);
 return this.store.decision(id,{id,fingerprint:fp,configuration,at:attempt.startedAt,would:blocked?'WOULD BLOCK':stats.state==='UNKNOWN'||stats.state==='CAUTION'?'WOULD CAUTION':'WOULD ALLOW',stats},owner);}
 settle(owner,attempt){if(attempt.state!=='SETTLED'||!attempt.contractId||!attempt.result||!['won','lost'].includes(attempt.result.status)||!Number.isFinite(attempt.result.profit)||!Number.isFinite(attempt.request?.stake)||attempt.request.stake<=0)return false;const entry=this.capture(owner,attempt);if(!entry)return false;const at=attempt.result.exitTickTime?attempt.result.exitTickTime*1000:attempt.stageAt;if(!Number.isFinite(at)||at<entry.at)return false;return this.store.put('outcomes',digest([owner,String(attempt.contractId)]),owner,entry.fingerprint.symbol,at,{...entry,at,authorizedAt:entry.at,contractId:String(attempt.contractId),won:attempt.result.status==='won',profit:attempt.result.profit,return:attempt.result.profit/attempt.request.stake,entryDigit:attempt.result.lifecycle?.brokerEntryDigit??null,settlementDigit:attempt.result.lifecycle?.settlementDigit??null,entryPrice:attempt.result.entryTick??null,settlementPrice:attempt.result.exitTick??null});}
 metrics(owner){const outcomes=this.store.db.prepare('SELECT data FROM outcomes WHERE owner=?').all(owner).map(r=>JSON.parse(r.data));const group=rows=>({trades:rows.length,wins:rows.filter(r=>r.won).length,losses:rows.filter(r=>!r.won).length,profit:rows.reduce((s,r)=>s+r.profit,0)});return {observed:group(outcomes),wouldBlock:group(outcomes.filter(r=>r.would==='WOULD BLOCK')),wouldAllow:group(outcomes.filter(r=>r.would==='WOULD ALLOW')),wouldCaution:group(outcomes.filter(r=>r.would==='WOULD CAUTION'))};}
}
