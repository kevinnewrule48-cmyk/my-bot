// Deterministic descriptive analysis. Scores are condition measurements, never win probabilities.
export const BALANCE_VERSION='part-one-balance-v1';
export const BALANCE_MARKETS=Object.freeze(['R_10','R_25','R_50','R_75','R_100']);
export const BALANCE_RULES=Object.freeze({window:200,recent:25,minimumSample:50,minimumSupport:.90,lossDigitMaximum:.08,minimumStrength:65,staleMs:5000});
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
 const rows=ticks.slice(-BALANCE_RULES.window).map(t=>({digit:t.digit,epoch:t.epoch??t.time}));
 if(rows.some((t,i)=>!Number.isInteger(t.digit)||t.digit<0||t.digit>9||!Number.isFinite(t.epoch)||(i>0&&t.epoch<=rows[i-1].epoch)))throw Error('Invalid or non-increasing balance ticks');
 const d=rows.map(t=>t.digit),n=d.length,c=counts(d),r=d.slice(-25),older=d.slice(-50,-25),last=rows.at(-1);
 const low=rate(d,x=>x<=1),high=rate(d,x=>x>=8),middle=rate(d,x=>x>=2&&x<=7);
 const broad=(high-low),deep=rate(d,x=>x>=7)-rate(d,x=>x<=2);
 // Signed continuous displacement. Negative is visually OVER, positive UNDER.
 const position=-100*clamp((broad+deep)/2,-1,1);
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
  const clearanceReference=direction==='OVER'?4.5-barrier:barrier-4.5;
  const side=direction==='OVER'?1:-1,advantage=broad*side;
  const strength=clamp(50+Math.max(0,advantage)*300*Math.min(1,n/200),0,95);
  const change=previousSupport===null?null:100*(recentSupport-previousSupport);
  const oppositeChange=older.length?100*((direction==='OVER'?recentLow:recentHigh)-rate(older,x=>direction==='OVER'?x<=1:x>=8)):null;
  const deterioration=change!==null&&change< -1e-9||loss(direction,barrier,last.digit);
  const checks=[{name:'Sample',value:n,required:'>=50',pass:n>=50},{name:'Support',value:observed*100,required:'>=90%',pass:observed>=.90},
   {name:'Boundary avoidance',value:Math.max(...losing.map(x=>100*c[x]/n)),required:'each losing digit <=8%',pass:losing.every(x=>c[x]/n<=.08)},
   {name:'Broad direction',value:advantage*100,required:'>0 pp',pass:advantage>0},
   {name:'Strength',value:strength,required:'>=65 condition score',pass:strength>=65},
   {name:'Clearance',value:clearance,required:`>${clearanceReference} digit units (uniform reference)`,pass:clearance>clearanceReference},
   {name:'Current support',value:recentSupport*100,required:'>=90% recent window',pass:recentSupport>=.90},
   {name:'Deterioration veto',value:change,required:'non-falling support and latest digit outside losing set',pass:change!==null&&!deterioration}];
  const ready=checks.every(x=>x.pass),status=ready?'QUALIFIED':deterioration?'DETERIORATING':advantage>0?'BUILDING':'NO TRADE';
  return {id:`${id}:${direction}:${barrier}`,market,direction,type:direction,barrier,contractType:'DIGIT'+direction,balanceStateId:id,analysisVersion:BALANCE_VERSION,createdAt:last.epoch*1000,
   strength,score:strength,confidence:strength,clearance,status,ready,checks,observed,recentSupport,baseline,excessSupport:observed-baseline,quality:Math.min(100,n/50*100),persistence:ready?1:0,
   label:`${direction} ${barrier}`,gatePercent:checks.filter(x=>x.pass).length/checks.length*100,stability,momentum:change,deterioration,oppositePressureChange:oppositeChange,
   winningDigits:Array.from({length:10},(_,i)=>i).filter(x=>!losing.includes(x)),counts:c,sample:n,risk:1-observed,scalePosition:position};
 });
 const eligible=candidates.filter(x=>x.ready).sort((a,b)=>b.excessSupport-a.excessSupport||b.clearance-a.clearance);
 const selected=eligible.length>1&&Math.abs(eligible[0].excessSupport-eligible[1].excessSupport)<1e-12&&eligible[0].direction!==eligible[1].direction?null:eligible[0]??null;
 return freeze({id,analysisVersion:BALANCE_VERSION,market,createdAt:last.epoch*1000,sequence:last.epoch,ticks:rows,position,lean:position<0?'OVER':position>0?'UNDER':'CENTER',broadBalance,
  fine:{lowPressure:recentLow*100,highPressure:recentHigh*100,middleSupport:recentMiddle*100,stability,circulation},candidates,selected,status:selected?'FULLY QUALIFIED':n<50?'WARMING UP':'NO TRADE'});
}
export function assertCandidate(candidate,state,{type=candidate?.contractType,barrier=candidate?.barrier,symbol=candidate?.market,now=Date.now(),allowManual=false}={}){
 const reject=message=>{throw Object.assign(Error(message),{code:'BALANCE_MISMATCH'});};
 if(!candidate||!state||candidate.analysisVersion!==BALANCE_VERSION||candidate.balanceStateId!==state.id)reject('Candidate / balance identity mismatch');
 const actual=state.candidates.find(c=>c.id===candidate.id);
 if(!actual||JSON.stringify(actual)!==JSON.stringify(candidate))reject('Candidate measurements or identity altered');
 if(!actual.ready||(!allowManual&&actual.id!==state.selected?.id))reject('Candidate is not currently authorized by analysis');
 if(type!==actual.contractType||barrier!==actual.barrier||symbol!==actual.market||actual.direction!==state.lean)reject('Analyzed direction, selected direction, contract type, barrier or market mismatch');
 if(now-state.createdAt>5000||state.createdAt>now+1000)reject('Expired balance state / stale feed');
 return actual;
}
export function continuationAllowed(candidate,state,previous){
 if(!previous||previous.candidate.market!==candidate.market||previous.candidate.direction!==candidate.direction)return true;
 const before=previous.balanceState;
 // Clearance is relative to its own barrier. Compare like barriers, never OVER1 units to OVER2.
 const prior=before.candidates.find(c=>c.direction===candidate.direction&&c.barrier===candidate.barrier);
 if(!prior)return false;
 const dangerous=candidate.direction==='OVER'?'lowPressure':'highPressure';
 return candidate.strength+1e-9>=prior.strength&&candidate.clearance+1e-9>=prior.clearance&&state.fine[dangerous]<=before.fine[dangerous]+1e-9&&Math.abs(state.position)+1e-9>=Math.abs(before.position);
}
export class BalanceBook{
 constructor(){this.histories=new Map();this.states=new Map();this.consumed=new Set();this.settlementFloor=new Map();this.inspectedMarket='R_100';this.executionMarket='R_100';this.manualSelection={direction:null,barrier:null};this.listeners=new Set();this.lastConsumed=null;this.lastSettled=null;}
 push(market,tick){if(!BALANCE_MARKETS.includes(market))return null;const h=this.histories.get(market)??[],epoch=tick.epoch??tick.time;
  if(!Number.isFinite(epoch)||epoch<=(h.at(-1)?.epoch??-Infinity)||!Number.isInteger(tick.digit)||tick.digit<0||tick.digit>9)return null;
  if(h.length&&epoch-h.at(-1).epoch>60)h.length=0;
  h.push({digit:tick.digit,epoch});if(h.length>200)h.shift();this.histories.set(market,h);const state=analyzeBalance(market,h);this.states.set(market,state);this.emit();return state;
 }
 emit(){for(const fn of this.listeners)fn();}
 inspect(market){if(!BALANCE_MARKETS.includes(market))throw Error('Unsupported inspected market');this.inspectedMarket=market;this.emit();}
 manual(direction,barrier){if(!BARRIERS.some(x=>x.direction===direction&&x.barrier===barrier))throw Error('Unsupported manual candidate');this.manualSelection={direction,barrier};this.emit();}
 current(market=this.executionMarket){return this.states.get(market)??null;}
 available(candidate,now=Date.now()){const state=this.current(candidate?.market);try{assertCandidate(candidate,state,{now,allowManual:true});return continuationAllowed(candidate,state,this.lastSettled)&&!this.consumed.has(state.id)&&state.createdAt>(this.settlementFloor.get('*')??-Infinity);}catch{return false;}}
 best(now=Date.now()){const a=[...this.states.values()].map(s=>s.selected).filter(c=>this.available(c,now)).sort((a,b)=>b.strength-a.strength||b.excessSupport-a.excessSupport);if(a.length>1&&a[0].strength===a[1].strength&&a[0].excessSupport===a[1].excessSupport)return a.find(c=>c.market===this.executionMarket)??null;return a[0]??null;}
 consume(candidate,now=Date.now()){if(!this.available(candidate,now))throw Error('Balance authorization expired or consumed');this.lastConsumed={candidate,balanceState:this.current(candidate.market)};this.consumed.add(candidate.balanceStateId);if(this.consumed.size>2000)this.consumed.delete(this.consumed.values().next().value);this.emit();}
 settled(market,at=Date.now()){this.settlementFloor.set('*',at);this.lastSettled=this.lastConsumed;this.emit();}
}
