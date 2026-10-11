import {analyzeEnvironment,edgeSide} from './edge-environment.js';
import {environmentEvidence} from './environment-ranking.js';
import {evaluateBrain,eligibility,ALL_BARRIERS} from './decision-brain.js';
// Deterministic descriptive analysis. Scores are condition measurements, never win probabilities.
export const BALANCE_VERSION='part-one-edge-balance-v2';
export const BALANCE_MARKETS=Object.freeze(['R_10','R_25','R_50','R_75','R_100']);
export const BALANCE_RULES=Object.freeze({window:200,recent:25,minimumSample:2,staleMs:5000});
export const BARRIERS=Object.freeze([{direction:'OVER',barrier:1},{direction:'OVER',barrier:2},{direction:'UNDER',barrier:8},{direction:'UNDER',barrier:7}]);
const clamp=(v,lo=0,hi=1)=>Math.max(lo,Math.min(hi,v));
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
const counts=d=>Array.from({length:10},(_,i)=>d.filter(x=>x===i).length);
const rate=(d,f)=>d.length?d.filter(f).length/d.length:0;
const loss=(direction,barrier,d)=>direction==='OVER'?d<=barrier:d>=barrier;
function hash(s){let h=2166136261;for(const c of s){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(16);}
export function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
export function analyzeBalance(market,ticks){
 if(!BALANCE_MARKETS.includes(market)||!Array.isArray(ticks)||!ticks.length)throw Error('Balance requires a supported market and ticks');
 const rows=ticks.slice(-BALANCE_RULES.window).map(t=>({digit:t.digit,epoch:t.epoch??t.time,...(Number.isFinite(t.price)?{price:t.price}:{})}));
 if(rows.some((t,i)=>!Number.isInteger(t.digit)||t.digit<0||t.digit>9||!Number.isFinite(t.epoch)||(i>0&&t.epoch<=rows[i-1].epoch)))throw Error('Invalid or non-increasing balance ticks');
 const d=rows.map(t=>t.digit),n=d.length,c=counts(d),r=d.slice(-25),older=d.slice(-50,-25),last=rows.at(-1);
 const low=rate(d,x=>x<=1),high=rate(d,x=>x>=8),middle=rate(d,x=>x>=2&&x<=7);
 const broad=(high-low),deep=rate(d,x=>x>=7)-rate(d,x=>x<=2);
 // Signed continuous displacement. Negative is visually OVER, positive UNDER.
 const environment=JSON.parse(JSON.stringify(analyzeEnvironment(rows)));
 // Edge imbalance drives the scale; recent digit clearance breaks a quiet-edge tie.
 const edgeAdvantage=environment.high.pressure-environment.low.pressure;
 const recentCenter=mean(d.slice(-10))-4.5;
 const signed=Math.abs(edgeAdvantage)>1e-9?edgeAdvantage:recentCenter;
 const lean=signed>0?'OVER':signed<0?'UNDER':'CENTER';
 const position=-clamp(Math.abs(edgeAdvantage)>1e-9?edgeAdvantage:recentCenter/4.5*100,-100,100);
 const broadBalance={lowPressure:low*100,highPressure:high*100,middleSupport:middle*100,displacement:broad*100,deepDisplacement:deep*100};
 const recentLow=rate(r,x=>x<=1),recentHigh=rate(r,x=>x>=8),recentMiddle=rate(r,x=>x>=2&&x<=7);
 const tv=older.length?counts(r).reduce((s,v,i)=>s+Math.abs(v/r.length-counts(older)[i]/older.length),0)/2:null;
 const circulation={distinctDigits:new Set(r).size,changes:rate(r.slice(1).map((x,i)=>x!==r[i]),x=>x)*100,distributionShift:tv===null?null:tv*100};
 const stability=tv===null?0:100*(1-tv);
 const id=`${BALANCE_VERSION}:${market}:${last.epoch}:${hash(JSON.stringify(rows))}`;
 const candidates=BARRIERS.map(({direction,barrier})=>{
  const losing=Array.from({length:10},(_,i)=>i).filter(x=>loss(direction,barrier,x));
  const observed=1-rate(d,x=>loss(direction,barrier,x)),recentSupport=1-rate(r,x=>loss(direction,barrier,x));
  const previousSupport=older.length?1-rate(older,x=>loss(direction,barrier,x)):null;
  const baseline=1-losing.length/10,clearance=mean(d.map(x=>direction==='OVER'?x-barrier:barrier-x));
  const change=previousSupport===null?null:100*(recentSupport-previousSupport);
  const oppositeChange=older.length?100*((direction==='OVER'?recentLow:recentHigh)-rate(older,x=>direction==='OVER'?x<=1:x>=8)):null;
  const entryEdge=edgeSide(d,x=>loss(direction,barrier,x));
  const strength=100-entryEdge.pressure; // Descriptive avoidance, never an entry cutoff.
  const deterioration=entryEdge.slope>1e-9||loss(direction,barrier,last.digit);
  // Detect a sequence, not a single cursor position. No score or sample-rate target.
  const checks=[{name:'Tick sequence',value:n,required:'two or more valid ticks',pass:n>=2},
   {name:'Scale direction',value:direction,required:lean,pass:direction===lean},
   {name:'Edge avoidance',value:entryEdge.separation,required:'losing digits absent on consecutive ticks',pass:entryEdge.separation>=2},
   {name:'Current edge pressure',value:entryEdge.slope,required:'stable or falling; no pressure level cutoff',pass:!deterioration}];
  const ready=checks.every(x=>x.pass),status=ready?'QUALIFIED':deterioration?'DETERIORATING':direction===lean?'BUILDING':'NO TRADE';
  const entryReason=`${direction} ${barrier}: losing digits ${losing.join('/')} absent for ${entryEdge.separation} ticks; pressure ${entryEdge.pressure.toFixed(2)}% (${entryEdge.trend.toLowerCase()}); scale ${lean}. No minimum score or support percentage.`;
  return {id:`${id}:${direction}:${barrier}`,market,direction,type:direction,barrier,contractType:'DIGIT'+direction,balanceStateId:id,analysisVersion:BALANCE_VERSION,createdAt:last.epoch*1000,
   entryEdge,entryReason,strength,score:strength,confidence:strength,clearance,status,ready,checks,observed,recentSupport,baseline,excessSupport:(1-entryEdge.pressure/100)-baseline,quality:Math.min(100,n/50*100),persistence:ready?1:0,
   label:`${direction} ${barrier}`,gatePercent:checks.filter(x=>x.pass).length/checks.length*100,stability,momentum:change,deterioration,oppositePressureChange:oppositeChange,
   winningDigits:Array.from({length:10},(_,i)=>i).filter(x=>!losing.includes(x)),counts:c,sample:n,risk:1-observed,scalePosition:position};
 });
 const eligible=candidates.filter(x=>x.ready).sort((a,b)=>b.excessSupport-a.excessSupport||b.clearance-a.clearance);
 const selected=eligible.length>1&&Math.abs(eligible[0].excessSupport-eligible[1].excessSupport)<1e-12&&eligible[0].direction!==eligible[1].direction?null:eligible[0]??null;
 return freeze({id,analysisVersion:BALANCE_VERSION,market,createdAt:last.epoch*1000,sequence:last.epoch,ticks:rows,position,lean,environment,broadBalance,
  fine:{lowPressure:recentLow*100,highPressure:recentHigh*100,middleSupport:recentMiddle*100,stability,circulation},candidates,selected,status:selected?'FULLY QUALIFIED':n<2?'WARMING UP':'NO TRADE'});
}
export function assertCandidate(candidate,state,{type=candidate?.contractType,barrier=candidate?.barrier,symbol=candidate?.market,now=Date.now(),allowManual=false}={}){
 const reject=message=>{throw Object.assign(Error(message),{code:'BALANCE_MISMATCH'});};
 if(!candidate||!state||candidate.analysisVersion!==BALANCE_VERSION||candidate.balanceStateId!==state.id)reject('Candidate / balance identity mismatch');
 const actual=state.candidates.find(c=>c.id===candidate.id);
 if(!actual||JSON.stringify(actual)!==JSON.stringify(candidate))reject('Candidate measurements or identity altered');
 if(!actual.ready||(!allowManual&&actual.id!==state.selected?.id))reject('Candidate is not currently authorized by analysis');
 if(type!==actual.contractType||barrier!==actual.barrier||symbol!==actual.market||actual.direction!==state.lean)reject('Analyzed direction, selected direction, contract type, barrier or market mismatch');
 if(!Number.isFinite(now)||now-state.createdAt>5000||state.createdAt>now+1000)reject('Expired balance state / stale feed');
 return actual;
}
export function continuationAllowed(candidate,state,previous){
 // Fresh qualifying evidence is sufficient. A past entry is not a rising score floor.
 return !!candidate?.ready&&candidate.balanceStateId===state?.id&&candidate.direction===state?.lean;
}
export class BalanceBook{
 autoEligibility={...ALL_BARRIERS};switchLog=[];selectionReason=null;brainCache=new Map();brainLog=[];
 setEligibility(mask){this.autoEligibility=eligibility(mask);this.emit();}
 brain(market=this.executionMarket){
  const s=this.current(market);if(!s)return null;
  const key=s.id+JSON.stringify(this.autoEligibility),cached=this.brainCache.get(market);if(cached?.key===key)return cached.result;
  const result=freeze(evaluateBrain(s,this.autoEligibility));this.brainCache.set(market,{key,result});
  this.brainLog.push({market,stateId:s.id,at:s.createdAt,action:result.action,reason:result.reason,evaluations:result.evaluations,eligibility:result.eligibility});if(this.brainLog.length>200)this.brainLog.shift();return result;
 }
 autoCandidate(market=this.executionMarket,now=this.now()){const c=this.brain(market)?.selected;return c&&this.available(c,now)?c:null;}
 constructor({now=()=>Date.now()}={}){this.now=now;this.histories=new Map();this.states=new Map();this.consumed=new Set();this.settlementFloor=new Map();this.inspectedMarket='R_100';this.executionMarket='R_100';this.manualSelection={direction:null,barrier:null};this.listeners=new Set();this.lastConsumed=null;this.lastSettled=null;}
 push(market,tick){if(!BALANCE_MARKETS.includes(market))return null;const h=this.histories.get(market)??[],epoch=tick.epoch??tick.time;
  if(!Number.isFinite(epoch)||epoch<=(h.at(-1)?.epoch??-Infinity)||!Number.isInteger(tick.digit)||tick.digit<0||tick.digit>9)return null;
  if(h.length&&epoch-h.at(-1).epoch>60)h.length=0;
  h.push({digit:tick.digit,epoch,...(tick.price!=null&&Number.isFinite(Number(tick.price))?{price:Number(tick.price)}:{})});if(h.length>200)h.shift();this.histories.set(market,h);const state=analyzeBalance(market,h);this.states.set(market,state);this.emit();return state;
 }
 emit(){for(const fn of this.listeners)fn();}
 inspect(market){if(!BALANCE_MARKETS.includes(market))throw Error('Unsupported inspected market');this.inspectedMarket=market;this.emit();}
 manual(direction,barrier){if(!BARRIERS.some(x=>x.direction===direction&&x.barrier===barrier))throw Error('Unsupported manual candidate');this.manualSelection={direction,barrier};this.emit();}
 current(market=this.executionMarket){return this.states.get(market)??null;}
 available(candidate,now=this.now()){const state=this.current(candidate?.market);try{assertCandidate(candidate,state,{now,allowManual:true});return continuationAllowed(candidate,state,this.lastSettled)&&!this.consumed.has(state.id)&&state.createdAt>(this.settlementFloor.get('*')??-Infinity);}catch{return false;}}
 best(now=this.now()){
  const score=c=>environmentEvidence(this.current(c.market),c).advantage;
  const a=[...this.states.values()].map(s=>this.autoCandidate(s.market,now)).filter(Boolean);
  a.sort((a,b)=>score(b)-score(a)||Number(b.market===this.executionMarket)-Number(a.market===this.executionMarket)||a.market.localeCompare(b.market));
  const current=a.find(c=>c.market===this.executionMarket),challenger=a[0];
  if(!challenger)return null;
  if(current&&challenger.market!==current.market){
   const evidence=c=>this.brain(c.market).evaluations.find(e=>e.candidateId===c.id).evidence;
   const x=evidence(challenger),y=evidence(current);
   // Require agreement across two nonoverlapping blocks and the broad window,
   // beyond the effect of replacing a single digit in each sample.
   const superior=['broad','recent','prior'].every(k=>
    (x[k].support-x.reference.support)-(y[k].support-y.reference.support)>1/x[k].sample+1/y[k].sample&&
    x[k].clearance-x.reference.clearance>y[k].clearance-y.reference.clearance);
   if(!superior)return current;
  }
  return challenger;
 }
 selectExecution(candidate,now=this.now()){
  if(!candidate||!this.available(candidate,now))return false;
  if(candidate.market===this.executionMarket)return true;
  const old=this.current(),brain=this.brain(),reason=!old||now-old.createdAt>5000?'CURRENT MARKET UNAVAILABLE':old.candidates.some(c=>c.direction===old.lean&&c.deterioration)?'CURRENT MARKET DETERIORATED':!brain?.selected?'CURRENT MARKET LOST QUALIFICATION':'STRONGER ESTABLISHED OPPORTUNITY';
  this.selectionReason={from:this.executionMarket,to:candidate.market,reason,at:now,candidateId:candidate.id,eligibility:{...this.autoEligibility}};
  this.switchLog.push(this.selectionReason);if(this.switchLog.length>200)this.switchLog.shift();this.executionMarket=candidate.market;return true;
 }
 consume(candidate,now=this.now()){if(!this.available(candidate,now))throw Error('Balance authorization expired or consumed');this.lastConsumed={candidate,balanceState:this.current(candidate.market)};this.consumed.add(candidate.balanceStateId);if(this.consumed.size>2000)this.consumed.delete(this.consumed.values().next().value);this.emit();}
 settled(market,at=this.now()){this.settlementFloor.set('*',at);this.lastSettled=this.lastConsumed;this.emit();}
}
