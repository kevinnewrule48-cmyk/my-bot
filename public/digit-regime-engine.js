// Descriptive, provisional research rules. This module has no execution or network API.
export const REGIME_VERSION = 'digit-regime-shadow-v1';
export const DEFAULT_REGIME_CONFIG = Object.freeze({windows:[25,50,100,200], evidenceZ:2.576, persistence:3, rapidGap:3, memory:128, maxMarkets:8, gapResetSeconds:60});
const mean = a => a.length ? a.reduce((s,x)=>s+x,0)/a.length : null;
const median = a => {if(!a.length)return null;const b=[...a].sort((x,y)=>x-y),i=b.length>>1;return b.length%2?b[i]:(b[i-1]+b[i])/2;};
const pct = (a,b) => b ? 100*a/b : null;
const sum = a => a.reduce((s,x)=>s+x,0);
const extreme = d => d<=1||d>=8;
const zone = d => d<=1?'low':d>=8?'high':'middle';
const copy = x => JSON.parse(JSON.stringify(x));
export function wilson(k,n,z=2.576){
  if(!n)return {low:0,high:1};const p=k/n,q=z*z/n,c=(p+q/2)/(1+q),h=z*Math.sqrt(p*(1-p)/n+q/(4*n))/(1+q);return {low:Math.max(0,c-h),high:Math.min(1,c+h)};
}
export function contrast(k,n,j,m,z=2.576){
  if(!n||!m)return {delta:null,z:null,direction:'INSUFFICIENT DATA'};
  const p=(k+j)/(n+m),se=Math.sqrt(p*(1-p)*(1/n+1/m)),d=k/n-j/m,v=se?d/se:0;
  return {delta:d*100,z:v,direction:v>=z?'RISING':v<=-z?'FALLING':'STABLE'};
}
const entropy = counts => {const n=sum(counts);return n?Math.max(0,-counts.reduce((s,c)=>s+(c?c/n*Math.log2(c/n):0),0)/Math.log2(10)):null;};
export function divergence(a,b){
  const n=sum(a),m=sum(b);if(!n||!m)return {jsBits:null,totalVariation:null};let js=0,tv=0;
  for(let d=0;d<Math.max(a.length,b.length);d++){const p=(a[d]??0)/n,q=(b[d]??0)/m,v=(p+q)/2;js+=(p?p*Math.log2(p/v)/2:0)+(q?q*Math.log2(q/v)/2:0);tv+=Math.abs(p-q)/2;}
  return {jsBits:js,totalVariation:tv};
}
class RollingWindow {
  constructor(size){this.size=size;this.digits=[];this.counts=Array(10).fill(0);this.matrix=Array.from({length:10},()=>Array(10).fill(0));}
  push(d){const a=this.digits;if(a.length)this.matrix[a.at(-1)][d]++;a.push(d);this.counts[d]++;if(a.length>this.size){const first=a.shift();this.counts[first]--;this.matrix[first][a[0]]--;}}
}
function gaps(digits,accept,rapidGap){
  const indices=[];digits.forEach((d,i)=>{if(accept(d))indices.push(i);});
  const visits=indices.slice(1).map((v,i)=>v-indices[i]);
  // A revisit requires leaving the digit/zone. Repeats are runs, not revisits.
  const returns=visits.filter(g=>g>1),recent=returns.slice(-5),older=returns.slice(0,-5),rmean=mean(recent),omean=mean(older);
  return {visits:indices.length,ticksSinceLast:indices.length?digits.length-1-indices.at(-1):null,absentEntireWindow:!indices.length,
    averageGap:mean(visits),recentAverageGap:mean(visits.slice(-5)),gapCompression:visits.length>5?mean(visits.slice(0,-5))-mean(visits.slice(-5)):null,
    revisitCount:returns.length,averageRevisitGap:mean(returns),medianRevisitGap:median(returns),minimumRecentGap:recent.length?Math.min(...recent):null,
    revisitFrequency:digits.length>1?returns.length/(digits.length-1):null,rapidRevisits:returns.filter(g=>g<=rapidGap).length,
    rapidRevisitRate:returns.length?returns.filter(g=>g<=rapidGap).length/returns.length:null,
    revisitGapChange:rmean!==null&&omean!==null?rmean-omean:null,
    revisitAcceleration:rmean!==null&&omean!==null?omean-rmean:null};
}
function runs(digits,key){
  const completed=[];let last=null,length=0;
  for(const d of digits){const k=key(d);if(k===last)length++;else{if(length)completed.push({value:last,length});last=k;length=1;}}
  if(length)completed.push({value:last,length});
  return {current:completed.at(-1)??null,count:completed.length,frequency:digits.length?completed.length/digits.length:null,
    repeats:completed.reduce((s,r)=>s+r.length-1,0),maxLength:Math.max(0,...completed.map(r=>r.length)),runs:completed};
}
function describe(w,previous,config){
  const d=w.digits,n=d.length,c=w.counts,t=Math.max(0,n-1),matrix=w.matrix;
  const low=c[0]+c[1],high=c[8]+c[9],e=low+high;
  let ee=0,bounce=0;for(let a=0;a<10;a++)for(let b=0;b<10;b++)if(extreme(a)&&extreme(b))ee+=matrix[a][b];
  for(let i=2;i<n;i++)if(extreme(d[i])&&extreme(d[i-1])&&d[i]===d[i-2]&&d[i]!==d[i-1])bounce++;
  const past=Array(10).fill(0);for(const x of previous)past[x]++;
  const digitGaps=Array.from({length:10},(_,i)=>gaps(d,x=>x===i,config.rapidGap));
  const grouped={low:gaps(d,x=>x<=1,config.rapidGap),high:gaps(d,x=>x>=8,config.rapidGap),extreme:gaps(d,extreme,config.rapidGap)};
  const occupied=c.filter(Boolean).length,h=entropy(c);let conditional=0;
  for(const row of matrix){const rn=sum(row);if(rn)conditional+=rn/Math.max(1,t)*entropy(row);}
  const zones={};for(const [name,k,prior] of [['low',low,past[0]+past[1]],['high',high,past[8]+past[9]],['extreme',e,past[0]+past[1]+past[8]+past[9]],['middle',n-e,previous.length-past[0]-past[1]-past[8]-past[9]]])zones[name]={count:k,percent:pct(k,n),change:contrast(k,n,prior,previous.length,config.evidenceZ)};
  let previousEE=0;for(let i=1;i<previous.length;i++)if(extreme(previous[i-1])&&extreme(previous[i]))previousEE++;
  const pressure={change:contrast(ee,t,previousEE,Math.max(0,previous.length-1),config.evidenceZ),count:ee,opportunities:t,percent:pct(ee,t),interval:wilson(ee,t,config.evidenceZ),expectedIIDPercent:16,bounces:bounce,bouncePercent:pct(bounce,Math.max(0,n-2)),rapidRevisitRate:grouped.extreme.rapidRevisitRate};
  const occupancy=c.map((count,i)=>({digit:i,count,percent:pct(count,n),change:contrast(count,n,past[i],previous.length,config.evidenceZ)}));
  const concentrated=n>=w.size&&h<.65; // descriptive labels, never a good/bad judgement
  const elevated=n===w.size&&wilson(e,n,config.evidenceZ).low>.4,transitionElevated=n===w.size&&pressure.interval.low>.16;
  const windowRegime=n<w.size?'WARMING UP':elevated&&transitionElevated?(e/n>=.8?'EXTREME':'UNSTABLE'):elevated||transitionElevated?'WATCH':'NORMAL';
  return {size:w.size,sample:n,ready:n===w.size,windowRegime,previousSample:previous.length,occupancy,zones,transitionCounts:matrix.map(r=>[...r]),
    transitionProbabilities:matrix.map(r=>{const total=sum(r);return r.map(x=>total?x/total:null);}),pressure,digitGaps,revisits:grouped,
    runs:{digit:runs(d,x=>x),zone:runs(d,zone),extreme:runs(d,x=>extreme(x)?'extreme':'middle')},
    entropy:h,conditionalEntropy:t?conditional:null,occupiedDigits:occupied,effectiveDigits:h===null?null:10**h,
    distribution:n<w.size?'WARMING UP':concentrated?'HIGHLY CONCENTRATED':h<.9?'CONCENTRATED':'BROADLY DISTRIBUTED'};
}
function support(w,comparison,digits,config){
  if(!w?.ready)return {level:'UNKNOWN',decision:'OBSERVE',reason:'Recent window incomplete'};
  const k=digits.reduce((s,d)=>s+w.occupancy[d].count,0),n=w.sample,reference=digits.length/10,interval=wilson(k,n,config.evidenceZ);
  const rising=comparison&&contrast(k,n,digits.reduce((s,d)=>s+comparison.olderCounts[d],0),comparison.olderSample,config.evidenceZ).direction==='RISING';
  const weak=interval.low>reference||rising;
  return {level:weak?'WEAK':interval.high<reference?'STRONG':'MODERATE',decision:weak?'BLOCK':'ALLOW',losingDigits:digits,lossOccupancy:pct(k,n),interval,reference,
    reason:weak?(rising?'Losing-digit occupancy increased versus disjoint older baseline':'Losing-digit occupancy is elevated versus uniform reference'):interval.high<reference?'Losing-digit occupancy is below uniform reference':'No supported losing-digit occupancy warning; no proven edge'};
}
export class DigitRegimeEngine {
  constructor(options={}){
    const c={...DEFAULT_REGIME_CONFIG,...options};c.windows=[...new Set(c.windows)].sort((a,b)=>a-b);
    if(c.windows.length<2||c.windows.length>8||c.windows.some(n=>!Number.isInteger(n)||n<5||n>2000)||!Number.isFinite(c.evidenceZ)||c.evidenceZ<1||c.evidenceZ>5||!Number.isInteger(c.persistence)||c.persistence<2||c.persistence>20||!Number.isInteger(c.rapidGap)||c.rapidGap<2||c.rapidGap>20)throw Error('Invalid shadow analysis configuration');
    // Resource budgets are fixed, not externally expandable through imports.
    c.memory=128;c.maxMarkets=8;c.gapResetSeconds=60;
    this.config=c;this.markets=new Map();this.rejectedTicks=0;this.evictedMarkets=0;this.resets=0;this.transitionHistory=[];
  }
  observe({market,digit,time,sequence}){
    if(typeof market!=='string'||!market||!Number.isInteger(digit)||digit<0||digit>9||!Number.isFinite(time)||!Number.isSafeInteger(sequence)||sequence<0){this.rejectedTicks++;return null;}
    let m=this.markets.get(market);
    if(m&&(sequence<=m.sequence||time<=m.time)){this.rejectedTicks++;return null;}
    if(m&&time-m.time>this.config.gapResetSeconds){this.markets.delete(market);m=null;this.resets++;}
    if(!m){if(this.markets.size>=this.config.maxMarkets){this.markets.delete(this.markets.keys().next().value);this.evictedMarkets++;}m={history:[],windows:this.config.windows.map(n=>new RollingWindow(n)),state:'WARMING UP',pending:null,streak:0,sequence:-1,time:-Infinity};this.markets.set(market,m);}
    this.markets.delete(market);this.markets.set(market,m);m.sequence=sequence;m.time=time;
    m.history.push(digit);if(m.history.length>Math.max(200,this.config.windows.at(-1)*2))m.history.shift();
    for(const w of m.windows)w.push(digit);
    const windows=m.windows.map(w=>describe(w,m.history.slice(Math.max(0,m.history.length-2*w.size),Math.max(0,m.history.length-w.size)),this.config));
    const comparisons=[];
    for(let i=0;i<windows.length-1;i++)for(let j=i+1;j<windows.length;j++){
      const a=windows[i],b=windows[j],olderCounts=b.occupancy.map((x,d)=>x.count-a.occupancy[d].count),olderSample=b.sample-a.sample;
      const ac=a.occupancy.map(x=>x.count),bc=b.occupancy.map(x=>x.count),olderDigits=m.history.slice(-b.sample).slice(0,olderSample);
      let olderEE=0;const olderMatrix=Array.from({length:10},()=>Array(10).fill(0));for(let k=1;k<olderDigits.length;k++){olderMatrix[olderDigits[k-1]][olderDigits[k]]++;if(extreme(olderDigits[k-1])&&extreme(olderDigits[k]))olderEE++;}
      const transitionChange=contrast(a.pressure.count,a.pressure.opportunities,olderEE,Math.max(0,olderSample-1),this.config.evidenceZ);
      comparisons.push({short:a.size,long:b.size,ready:a.ready&&b.ready,olderSample,olderCounts,
        occupancyDifference:a.occupancy.map((x,d)=>(x.percent??0)-(b.occupancy[d].percent??0)),
        ...divergence(ac,bc),disjointDivergence:divergence(ac,olderCounts),
        extremeChange:contrast(a.zones.extreme.count,a.sample,olderCounts[0]+olderCounts[1]+olderCounts[8]+olderCounts[9],olderSample,this.config.evidenceZ),
        revisitChanges:Object.fromEntries([['low',x=>x<=1],['high',x=>x>=8],['extreme',extreme]].map(([name,accept])=>{const older=gaps(olderDigits,accept,this.config.rapidGap);return [name,{...contrast(a.revisits[name].revisitCount,Math.max(0,a.sample-1),older.revisitCount,Math.max(0,olderSample-1),this.config.evidenceZ),recentMeanGap:a.revisits[name].averageRevisitGap,olderMeanGap:older.averageRevisitGap}];})),
        transitionChange,transitionDivergence:divergence(a.transitionCounts.flat(),olderMatrix.flat()),entropyChange:a.entropy===null||b.entropy===null?null:a.entropy-b.entropy,
        revisitChange:a.revisits.extreme.revisitFrequency===null||b.revisits.extreme.revisitFrequency===null?null:a.revisits.extreme.revisitFrequency-b.revisits.extreme.revisitFrequency});
    }
    const short=windows[0],long=windows.at(-1),comparison=comparisons.find(c=>c.short===short.size&&c.long===long.size);
    const e=short.zones.extreme,high=short.ready&&wilson(e.count,short.sample,this.config.evidenceZ).low>.4;
    const transitions=short.ready&&short.pressure.interval.low>.16;
    const recentBad=high&&transitions;
    const rising=!!comparison?.ready&&comparison.extremeChange.direction==='RISING',falling=!!comparison?.ready&&comparison.extremeChange.direction==='FALLING';
    const transitionRising=!!comparison?.ready&&comparison.transitionChange.direction==='RISING',transitionFalling=!!comparison?.ready&&comparison.transitionChange.direction==='FALLING';
    let desired='NORMAL',reasons=[],votes=[];
    if(!short.ready){desired='WARMING UP';reasons=['Recent analysis window incomplete'];}
    else if(falling&&transitionFalling&&!recentBad){desired='RECOVERING';reasons=['Recent extreme occupancy and transition pressure fell versus disjoint older sample'];votes=[falling,transitionFalling,!high,!transitions];}
    else if(recentBad){desired=e.percent>=80?'EXTREME':'UNSTABLE';reasons=['Extreme occupancy and extreme-to-extreme transitions exceed descriptive uniform-reference bands'];votes=[high,transitions,rising,transitionRising];}
    else if(rising&&transitionRising){desired='DETERIORATING';reasons=['Both recent extreme occupancy and transition pressure increased versus disjoint older sample'];votes=[rising,transitionRising,high,transitions];}
    else if(high||transitions||rising||transitionRising){desired='WATCH';reasons=['At least one extreme-activity measure is elevated; agreement is incomplete'];votes=[high,transitions,rising,transitionRising];}
    else {reasons=['No agreed extreme-activity deterioration in the available windows'];votes=[!high,!transitions,comparison?.ready?!rising:null,comparison?.ready?!transitionRising:null];}
    m.streak=m.pending===desired?m.streak+1:1;m.pending=desired;
    const confidence=short.ready?100*votes.filter(Boolean).length/votes.length:0;
    if(desired!==m.state&&m.streak>=this.config.persistence){const record={market,time,sequence,previous:m.state,state:desired,reasons,confidence};m.state=desired;this.transitionHistory.push(record);if(this.transitionHistory.length>this.config.memory)this.transitionHistory.shift();}
    const supports={over:support(short,comparison?.ready?comparison:null,[0,1],this.config),under:support(short,comparison?.ready?comparison:null,[8,9],this.config),differ:Array.from({length:10},(_,d)=>support(short,comparison?.ready?comparison:null,[d],this.config))};
    m.snapshot={schema:1,version:REGIME_VERSION,mode:'SHADOW',executionAuthority:false,config:copy(this.config),market,time,sequence,
      state:m.state,agreement:{matching:votes.filter(Boolean).length,measured:votes.filter(v=>v!==null).length,total:4},proposedState:desired,statePending:desired!==m.state,evidenceStreak:m.streak,confidence,confidenceMeaning:'Agreement of four descriptive metrics; NOT a probability of winning',reasons,
      baselineReady:long.ready,windows,comparisons,supports,
      digitWindows:Object.fromEntries([...new Set([...this.config.windows,25,50,100,200])].map(n=>[n,m.history.slice(-n)])),
      coverage:{retainedTicks:m.history.length,rejectedTicks:this.rejectedTicks,evictedMarkets:this.evictedMarkets,gapResets:this.resets}};
    return m.snapshot;
  }
  snapshot(market){return this.markets.get(market)?.snapshot??null;}
  export(){return {version:REGIME_VERSION,config:copy(this.config),transitions:copy(this.transitionHistory),markets:[...this.markets.values()].map(m=>copy(m.snapshot))};}
}
