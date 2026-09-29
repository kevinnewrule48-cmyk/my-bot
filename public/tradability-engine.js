// Descriptive testing filter. No prediction, order transport or profitability claim.
export const TRADABILITY_DEFAULTS=Object.freeze({windowSize:500,windows:[100,200,500,1000],
  clusterTicks:20,recentWindows:[25,50,100],recentWeights:[.5,.3,.2],
  weights:{extremeBounceRate:.2,rangeInstability:.2,recentBouncePressure:.3,bounceClustering:.2,consecutiveCrossings:.1},
  rangeWeights:{crossings:.35,averageJump:.2,largeJumps:.25,largeRun:.1,directionChanges:.1},
  normalization:{crossingRate:.3,averageJump:7,largeJumpRate:.3,clusterRate:.5,runLength:4},
  thresholds:{caution:40,notTradable:70,hysteresis:8,confirmations:3},
  warmupPolicy:'block',maxGapSeconds:10,trendSamples:20,trendDelta:3});
export const clamp=n=>Math.max(0,Math.min(100,Number.isFinite(n)?n:0));
export const digitZone=d=>d<=1?'LOW':d>=8?'HIGH':'MIDDLE';
const keys=['crossings','lowHigh','highLow','p09','p08','p19','p18','jumpSum','jump7','jump8','jump9','large','turns'];
const empty=()=>({length:0,sums:Array(keys.length).fill(0),prefix:0,suffix:0,longest:0,largePrefix:0,largeSuffix:0,largeLongest:0,cluster:0,firstCross:null,lastCross:null});
function merge(a,b){if(!a.length)return b;if(!b.length)return a;return {length:a.length+b.length,sums:a.sums.map((x,i)=>x+b.sums[i]),
 prefix:a.prefix===a.length?a.length+b.prefix:a.prefix,suffix:b.suffix===b.length?b.length+a.suffix:b.suffix,longest:Math.max(a.longest,b.longest,a.suffix+b.prefix),
 largePrefix:a.largePrefix===a.length?a.length+b.largePrefix:a.largePrefix,largeSuffix:b.largeSuffix===b.length?b.length+a.largeSuffix:b.largeSuffix,largeLongest:Math.max(a.largeLongest,b.largeLongest,a.largeSuffix+b.largePrefix),
 cluster:Math.max(a.cluster,b.cluster),firstCross:a.firstCross??b.firstCross,lastCross:b.lastCross??a.lastCross};}
// Fixed-size ring plus aggregate tree: each append/range query is O(log capacity), not a rescan.
class TransitionRing{
 constructor(capacity){this.capacity=capacity;this.size=1;while(this.size<capacity)this.size*=2;this.tree=Array.from({length:this.size*2},empty);this.total=0;}
 push(value){let i=this.size+this.total++%this.capacity;this.tree[i]=value;while((i=Math.floor(i/2)))this.tree[i]=merge(this.tree[i*2],this.tree[i*2+1]);}
 range(start,end){let a=empty(),b=empty();for(start+=this.size,end+=this.size;start<end;start=Math.floor(start/2),end=Math.floor(end/2)){if(start%2)a=merge(a,this.tree[start++]);if(end%2)b=merge(this.tree[--end],b);}return merge(a,b);}
 tail(count,skip=0){count=Math.min(count,this.total-skip,this.capacity-skip);if(count<=0)return empty();const start=(this.total-skip-count)%this.capacity,end=(this.total-skip)%this.capacity;return start<end?this.range(start,end):merge(this.range(start,this.capacity),this.range(0,end));}
}
export function tradabilityConfig(options={}){
 const d=TRADABILITY_DEFAULTS,c={...d,...options};for(const k of ['weights','rangeWeights','normalization','thresholds'])c[k]={...d[k],...options[k]};
 if(Object.values(c.thresholds).some(n=>!Number.isFinite(n))||!Number.isFinite(c.trendDelta)||c.trendDelta<0)throw Error('Invalid numeric thresholds');
 if(!Array.isArray(c.windows)||!c.windows.length||c.windows.some(n=>!Number.isInteger(n)||n<2||n>10000)||!c.windows.includes(c.windowSize))throw Error('Invalid tradability window');
 if(!Number.isInteger(c.clusterTicks)||c.clusterTicks<2||c.clusterTicks>Math.max(...c.windows)||!Number.isInteger(c.trendSamples)||c.trendSamples<4)throw Error('Invalid cluster/trend configuration');
 if(c.recentWindows.length!==c.recentWeights.length||!c.recentWindows.length||c.recentWindows.some(n=>!Number.isInteger(n)||n<2)||c.recentWeights.some(n=>!Number.isFinite(n)||n<0)||!c.recentWeights.some(n=>n>0))throw Error('Invalid recency configuration');
 for(const group of [c.weights,c.rangeWeights])if(Object.values(group).some(n=>!Number.isFinite(n)||n<0)||!Object.values(group).some(n=>n>0))throw Error('Invalid weights');
 if(Object.values(c.normalization).some(n=>!Number.isFinite(n)||n<=0)||c.thresholds.caution<0||c.thresholds.notTradable>100||c.thresholds.caution>=c.thresholds.notTradable||c.thresholds.hysteresis<0||c.thresholds.hysteresis>=c.thresholds.caution||!Number.isInteger(c.thresholds.confirmations)||c.thresholds.confirmations<1||!['block','allow'].includes(c.warmupPolicy)||!Number.isFinite(c.maxGapSeconds)||c.maxGapSeconds<=0)throw Error('Invalid thresholds');
 return c;
}
const weighted=(values,weights)=>clamp(Object.entries(weights).reduce((s,[k,w])=>s+(values[k]??0)*w,0)/Object.values(weights).reduce((s,w)=>s+w,0));
export function tradabilityBlocks(snapshot,mode,policy='block'){return mode==='auto-block'&&(!snapshot||snapshot.state==='NOT TRADABLE'||snapshot.state==='COLLECTING DATA'&&policy==='block');}
export class TradabilityEngine{
 constructor(options={},onChange=()=>{}){this.config=tradabilityConfig(options);this.onChange=onChange;this.symbol=null;this.reset();}
 reset(symbol=this.symbol,reason='history reset'){this.symbol=symbol;this.ring=new TransitionRing(Math.max(...this.config.windows));this.count=0;this.previous=null;this.previousDirection=0;this.sequence=0;this.states=new Map();this.snapshot=null;this.debug={};this.integrity=reason;}
 selectWindow(size){if(!this.config.windows.includes(size))throw Error('Unsupported window');this.config.windowSize=size;this.snapshot=this.build(false);return this.snapshot;}
 push({digit,epoch,id=null,symbol=this.symbol}){
  if(!Number.isInteger(digit)||digit<0||digit>9||!Number.isFinite(epoch)||epoch<0){this.reset(symbol,'invalid tick: continuity reset');return {accepted:false,snapshot:this.build(false)};}
  if(symbol!==this.symbol)this.reset(symbol,'symbol changed');
  if(this.previous&&epoch<=this.previous.epoch)return {accepted:false,snapshot:this.snapshot};
  if(this.previous&&id!==null&&id===this.previous.id)return {accepted:false,snapshot:this.snapshot};
  if(this.previous&&epoch-this.previous.epoch>this.config.maxGapSeconds)this.reset(symbol,'tick gap: continuity reset');
  const prev=this.previous,jump=prev?Math.abs(digit-prev.digit):0,zone=digitZone(digit),previousZone=prev?digitZone(prev.digit):null;
  const cross=!!prev&&zone!=='MIDDLE'&&previousZone!=='MIDDLE'&&zone!==previousZone;
  const direction=prev?Math.sign(digit-prev.digit):0,turn=!!(direction&&this.previousDirection&&direction!==this.previousDirection);
  if(prev){const low=Math.min(prev.digit,digit),high=Math.max(prev.digit,digit),large=jump>=7;
   const sums=[+cross,+(cross&&previousZone==='LOW'),+(cross&&previousZone==='HIGH'),+(cross&&low===0&&high===9),+(cross&&low===0&&high===8),+(cross&&low===1&&high===9),+(cross&&low===1&&high===8),jump,+(jump===7),+(jump===8),+(jump===9),+large,+turn];
   const cluster=this.ring.tail(this.config.clusterTicks-2).sums[0]+ +cross;
   this.ring.push({length:1,sums,prefix:+cross,suffix:+cross,longest:+cross,largePrefix:+large,largeSuffix:+large,largeLongest:+large,cluster,firstCross:cross?this.sequence:null,lastCross:cross?this.sequence:null});
  }
  this.sequence++;this.count=Math.min(this.count+1,Math.max(...this.config.windows));this.previous={digit,epoch,id};this.previousDirection=direction;
  this.debug={currentDigit:digit,previousDigit:prev?.digit??null,jumpSize:jump,currentZone:zone,previousZone,extremeCrossing:cross};
  this.snapshot=this.build(true);return {accepted:true,snapshot:this.snapshot};
 }
 metrics(windowSize){
  const sample=Math.min(this.count,windowSize),eligible=Math.max(0,sample-1),a=this.ring.tail(eligible),raw=Object.fromEntries(keys.map((k,i)=>[k,a.sums[i]])),ratio=(x,n=eligible)=>n?x/n:0,c=this.config,n=c.normalization;
  // First transition's direction comparison belongs outside the selected window.
  if(eligible)raw.turns-=this.ring.tail(1,eligible-1).sums[12];
  const rate=ratio(raw.crossings),largeRate=ratio(raw.large),avg=ratio(raw.jumpSum);
  const recent=c.recentWindows.map(ticks=>{const transitions=Math.min(eligible,ticks-1),crossings=this.ring.tail(transitions).sums[0];return {ticks,transitions,crossings,rate:100*ratio(crossings,transitions)};});
  const recentPressure=clamp(recent.reduce((s,r,i)=>s+clamp(r.rate/n.crossingRate)*c.recentWeights[i],0)/c.recentWeights.reduce((s,w)=>s+w,0));
  const clusterTransitions=Math.min(eligible,c.clusterTicks-1),currentCluster=this.ring.tail(clusterTransitions).sums[0];
  const largestCluster=eligible<c.clusterTicks-1?raw.crossings:this.ring.tail(eligible-(c.clusterTicks-2)).cluster;
  const rangeParts={crossings:clamp(100*rate/n.crossingRate),averageJump:clamp(100*avg/n.averageJump),largeJumps:clamp(100*largeRate/n.largeJumpRate),largeRun:clamp(100*a.largeLongest/n.runLength),directionChanges:clamp(100*ratio(raw.turns,Math.max(0,eligible-1)))};
  const components={extremeBounceRate:rangeParts.crossings,rangeInstability:weighted(rangeParts,c.rangeWeights),recentBouncePressure:recentPressure,bounceClustering:clamp(100*ratio(currentCluster,clusterTransitions)/n.clusterRate),consecutiveCrossings:clamp(100*a.suffix/n.runLength)};
  const chaos=weighted(components,c.weights);
  return {windowSize,sample,eligible,raw,extremeBounceRate:100*rate,averageJump:avg,largeJumpRate:100*largeRate,consecutiveCrossings:a.suffix,longestBounceCrossings:a.longest,longestBounceTicks:a.longest?a.longest+1:0,averageTicksBetweenCrossings:raw.crossings>1?(a.lastCross-a.firstCross)/(raw.crossings-1):null,currentCluster,largestCluster,clusterTicks:c.clusterTicks,recent,crossingsRecent:[20,50,100].map(ticks=>({ticks,crossings:this.ring.tail(Math.min(eligible,ticks-1)).sums[0]})),rangeParts,components,chaos};
 }
 classify(m,advance){
  const c=this.config,t=c.thresholds;let s=this.states.get(m.windowSize);if(!s){s={state:'COLLECTING DATA',pending:null,runs:0,history:[],lastChaos:null};this.states.set(m.windowSize,s);}
  if(m.sample<m.windowSize)return {...m,state:'COLLECTING DATA',trend:'STABLE',reasons:[`Collecting ${m.sample} / ${m.windowSize} ticks. ${this.integrity}.`]};
  let target=m.chaos>=t.notTradable?'NOT TRADABLE':m.chaos>=t.caution?'CAUTION':'TRADABLE';
  if(s.state==='NOT TRADABLE'&&m.chaos>=t.notTradable-t.hysteresis)target='NOT TRADABLE';
  else if(s.state==='CAUTION'&&target==='TRADABLE'&&m.chaos>=t.caution-t.hysteresis)target='CAUTION';
  if(advance){s.history.push(m.chaos);if(s.history.length>c.trendSamples)s.history.shift();
   if(target===s.state){s.pending=null;s.runs=0;}else{if(s.pending===target)s.runs++;else{s.pending=target;s.runs=1;}if(s.runs>=t.confirmations){const previousState=s.state;s.state=target;s.runs=0;s.pending=null;this.onChange({timestamp:this.previous?.epoch,symbol:this.symbol,windowSize:m.windowSize,previousState,newState:s.state,previousChaos:s.lastChaos,chaos:m.chaos,extremeBounceRate:m.extremeBounceRate,rangeInstability:m.components.rangeInstability,recentBouncePressure:m.components.recentBouncePressure,clusterScore:m.components.bounceClustering,reason:`${m.raw.crossings}/${m.eligible} extreme crossings; ${m.currentCluster} in last ${m.clusterTicks} ticks.`});}}
   s.lastChaos=m.chaos;
  }
  const half=Math.floor(s.history.length/2),mean=a=>a.reduce((x,y)=>x+y,0)/a.length,delta=half>=3?mean(s.history.slice(half))-mean(s.history.slice(0,half)):0;
  const trend=delta>c.trendDelta?'WORSENING':delta< -c.trendDelta?'IMPROVING':'STABLE';
  const reasons=[`${m.raw.crossings} of ${m.eligible} adjacent transitions crossed LOW ↔ HIGH (${m.extremeBounceRate.toFixed(1)}%).`,`${m.currentCluster} crossings in the latest ${m.clusterTicks} ticks; longest bounce ${m.longestBounceCrossings} crossings.`];
  if(m.recent[0].rate>m.extremeBounceRate+10)reasons.push('Extreme crossings increased sharply in the newest ticks.');
  if(m.raw.large)reasons.push(`${m.raw.large} jumps of 7–9 digits; average jump ${m.averageJump.toFixed(2)}.`);
  if(trend==='IMPROVING')reasons.push('Recent instability is decreasing.');
  if(s.pending)reasons.push(`Confirming ${s.pending}: ${s.runs}/${t.confirmations} evaluations.`);
  return {...m,state:s.state,trend,reasons};
 }
 build(advance){const windows=this.config.windows.map(w=>this.classify(this.metrics(w),advance));const selected=windows.find(w=>w.windowSize===this.config.windowSize);return {...selected,symbol:this.symbol,sequence:this.sequence,timestamp:this.previous?.epoch??null,windows,debug:this.debug??{},integrity:this.integrity};}
}
export function replayTradability(digits,config={}){const engine=new TradabilityEngine(config);return digits.map((digit,i)=>engine.push({digit,epoch:i*2,symbol:'REPLAY'}).snapshot);}
