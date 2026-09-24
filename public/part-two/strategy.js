import {wins} from './engine.js';
// These are transparent research scores, not calibrated probabilities.
export const STRATEGY = Object.freeze({momentum:58,zone:62,stability:70,score:80,quality:70,confidence:65,persistence:3,minHistory:500,minContext:30,
  weights:{momentum:1,zone:1,stability:2,pattern:1,transition:1,quality:2}});
// Faster experimental demo profile. Digit support, not candle direction, drives entries.
export const DEMO_SCALP = Object.freeze({momentum:52,zone:65,stability:40,score:60,quality:40,persistence:1,minHistory:200,minContext:10,
  shortWindow:20,longWindow:100,stabilityWindows:[50,100,200],patternMinimum:0,transitionMinimum:40,
  weights:{momentum:2,zone:2,stability:1,pattern:0,transition:1,quality:1}});
const clamp=n=>Math.max(0,Math.min(100,n));
export function scalpProfile(ticks=200){
  if(![50,100,200,500,1000].includes(ticks))throw Error('Select 50, 100, 200, 500 or 1000 analysis ticks');
  return {...DEMO_SCALP,sampleWindow:ticks,minHistory:ticks,longWindow:ticks,shortWindow:Math.min(20,Math.floor(ticks/5)),stabilityWindows:[Math.floor(ticks/2),ticks],minContext:Math.max(3,Math.min(10,Math.floor(ticks/10)))};
}
const rate=(h,type,b)=>h.length?h.filter(t=>wins(type,b,t.digit)).length/h.length:0;
export function contexts(history,length,alpha=1) {
  const context=history.slice(-length).map(t=>t.digit),counts=Array(10).fill(0);
  if(history.length>length)for(let i=length;i<history.length;i++) {
    if(context.every((d,j)=>history[i-length+j].digit===d))counts[history[i].digit]++;
  }
  const sample=counts.reduce((a,b)=>a+b,0);
  return {context,counts,sample,distribution:counts.map(c=>(c+alpha)/(sample+10*alpha))};
}
export function streak(history,predicate) {
  let active=0;for(let i=history.length-1;i>=0&&predicate(history[i].digit);i--)active++;
  let previous=0;for(let i=history.length-2;i>=0&&predicate(history[i].digit);i--)previous++;
  return {active,previous,broken:active===0&&previous>0,change:active-previous};
}
export function diagnostics(history,type,barrier) {
  const last=history.at(-1)?.digit,tail=history.slice(-4).map(t=>t.digit);
  return {winning:streak(history,d=>wins(type,barrier,d)),high:streak(history,d=>d>=5),low:streak(history,d=>d<5),even:streak(history,d=>d%2===0),odd:streak(history,d=>d%2!==0),same:streak(history,d=>d===last),
    alternating:tail.length===4&&tail[0]===tail[2]&&tail[1]===tail[3]&&tail[0]!==tail[1],
    mirror:tail.length===4&&tail[0]+tail[1]===9&&tail[2]+tail[3]===9,
    triple:tail.length>=3&&tail.slice(-3).every(d=>d===last)};
}
export class SignalEngine {
  constructor(config={}) {this.config={...STRATEGY,...config,weights:{...STRATEGY.weights,...config.weights}};this.previousKey=null;this.persist=0;this.lastSequence=-1;this.cached=null;}
  update(engine,type,barrier) {
    const c=this.config,h=c.sampleWindow?engine.history.slice(-c.sampleWindow):engine.history,n=h.length,key=`${engine.symbol}:${type}:${barrier}`,sequence=engine.sequence;
    if(this.lastSequence===sequence&&this.previousKey===key)return this.cached;
    if(this.previousKey!==key)this.persist=0;
    const baseline=Array.from({length:10},(_,d)=>wins(type,barrier,d)).filter(Boolean).length/10;
    const available=(c.stabilityWindows??[100,200,300,500,1000]).filter(w=>n>=w),rates=available.map(w=>rate(h.slice(-w),type,barrier));
    const stability=rates.length>=2?clamp(100-(Math.max(...rates)-Math.min(...rates))*500):0;
    const momentum=n>=(c.longWindow??200)?clamp(50+(rate(h.slice(-(c.shortWindow??50)),type,barrier)-rate(h.slice(-(c.longWindow??200)),type,barrier))*250):0;
    const zone=rate(h.slice(-(c.shortWindow??50)),type,barrier)*100;
    const ctx=[1,2,3].map(l=>contexts(h,l)),probability=x=>x.distribution.reduce((sum,p,d)=>sum+(wins(type,barrier,d)?p:0),0);
    const transition=ctx[0].sample>=c.minContext?clamp(50+(probability(ctx[0])-baseline)*250):0;
    const patternContext=[...ctx.slice(1)].reverse().find(x=>x.sample>=c.minContext);
    const pattern=patternContext?clamp(50+(probability(patternContext)-baseline)*250):0;
    const quality=clamp(100*(.4*Math.min(n/1000,1)+.2*stability/100+.2*Math.min(ctx[0].sample/c.minContext,1)+.2*Math.min((patternContext?.sample??0)/c.minContext,1)));
    const components={momentum,zone,stability,pattern,transition,quality},weightTotal=Object.values(c.weights).reduce((a,b)=>a+b,0);
    const contributions=Object.entries(components).map(([name,value])=>({name,value,weight:c.weights[name],contribution:value*c.weights[name]/weightTotal}));
    const score=contributions.reduce((sum,v)=>sum+v.contribution,0);
    const checks=[['Momentum',momentum,c.momentum],['Zone',zone,c.zone],['Stability',stability,c.stability],['Pattern',pattern,c.patternMinimum??50],['Transition',transition,c.transitionMinimum??50],['Quality',quality,c.quality],['Score',score,c.score]].map(([name,value,required])=>({name,value,required,pass:value>=required}));
    checks.push({name:'Data quality',value:n,required:c.minHistory,pass:n>=c.minHistory});
    const eligible=checks.every(x=>x.pass);
    this.persist=eligible?this.persist+1:0;
    const persistence=Math.min(100,this.persist/c.persistence*100);
    checks.push({name:'Persistence',value:persistence,required:100,pass:persistence===100});
    // No probability/EV is fabricated from a weighted score.
    checks.push({name:'Calibrated confidence',value:null,required:c.confidence,pass:false},{name:'Payout / EV',value:null,required:null,pass:false});
    const empirical=(h.filter(t=>wins(type,barrier,t.digit)).length+baseline*10)/(n+10);
    const estimates=[empirical,...ctx.filter(x=>x.sample>=c.minContext).map(probability)];
    const modelProbability=estimates.reduce((a,b)=>a+b,0)/estimates.length;
    this.previousKey=key;this.lastSequence=sequence;
    this.cached={key,type,barrier,baseline,modelProbability,components,contributions,score,checks,contexts:ctx,diagnostics:diagnostics(h,type,barrier),persistence,
      decision:eligible?'WATCH':'WAIT',reason:checks.filter(x=>!x.pass).map(x=>x.value===null?`${x.name}: unavailable`:`${x.name}: ${x.value.toFixed(1)} < ${x.required}`).join('; ')};
    return this.cached;
  }
}
