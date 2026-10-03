// Versioned, causal demo hypothesis. Scores are evidence summaries, not probabilities.
export const BALANCED_VERSION='balanced-adaptive-v1';
const clamp=x=>Math.max(0,Math.min(100,x));
const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
function stats(d,dir){const total=d.reduce((s,x)=>s+Math.abs(x),0);return {pressure:total?100*d.reduce((s,x)=>s+Math.max(0,dir*x),0)/total:50,velocity:dir*avg(d),consistency:100*d.filter(x=>dir*x>0).length/(d.length||1)};}
export function balancedCandidate(side,{micro,short,medium,chop,volatility,stale,history,priceSlope}){
 const dir=side.sign,ps=dir===1?'up':'down',recent=stats(micro.changes.slice(-5),dir),prior=stats(micro.changes.slice(-10,-5),dir);
 const scale=avg(short.changes.map(Math.abs))||1,velocity=stats(micro.changes,dir).velocity/scale,acceleration=(recent.velocity-prior.velocity)/scale;
 const pressureChange=recent.pressure-prior.pressure,consistency=stats(micro.changes,dir).consistency;
 const reversalRisk=clamp(.55*(100-recent.pressure)+.25*(100-micro[ps])+.20*side.pullback);
 const exhaustion=clamp(60*Math.max(0,1-recent.velocity/(prior.velocity>0?prior.velocity:scale)) + .4*Math.max(0,-pressureChange));
 const momentumChange=pressureChange>3&&acceleration>0?'STRENGTHENING':pressureChange< -3||acceleration< -.15?'WEAKENING':'STABLE';
 const support={pressure:.25*micro[ps],momentum:.15*side.momentum,consistency:.15*consistency,persistence:.10*side.persistence,efficiency:.10*short.efficiency,shortAlignment:.10*short[ps],mediumAlignment:.05*medium[ps],cleanliness:.05*(100-chop),acceleration:.05*clamp(50+50*acceleration)};
 const score=Object.values(support).reduce((s,x)=>s+x,0);
 const agreement=[micro[ps]>=58,short[ps]>=52,velocity>0,consistency>=55,side.persistence>=40,dir*priceSlope>0].filter(Boolean).length;
 const checks={history,fresh:!stale,severeChop:chop<65,opposition:micro[ps]>40&&short[ps]>45,reversal:reversalRisk<60,exhaustion:exhaustion<70,volatility:volatility>=.05&&volatility<=4,direction:velocity>0,agreement:agreement>=4,evidence:score>=68};
 const ready=Object.values(checks).every(Boolean),blocked=Object.entries(checks).filter(([,v])=>!v).map(([k])=>k);
 const state=exhaustion>=70?'EXHAUSTED':ready?'READY':!checks.history||!checks.fresh||!checks.severeChop||!checks.opposition||!checks.reversal?'NO TRADE':score>=58&&agreement>=3?'BUILDING':score>=50?'WATCH':'NO TRADE';
 const regime=exhaustion>=70?'EXHAUSTED TREND':!checks.severeChop||!checks.opposition||!checks.reversal?'CHOPPY/CONFLICTED':score>=80&&agreement>=5?'STRONG/CLEAN TREND':score>=50?'DEVELOPING TREND':'NOISE';
 const metrics={regime,direction:side.name,pressure:micro[ps],momentum:side.momentum,velocity,acceleration,consistency,persistence:side.persistence,chop,reversalRisk,exhaustion,signalAgreement:100*agreement/6,agreement,efficiency:short.efficiency,shortPressure:short[ps],mediumPressure:medium[ps],pressureChange,momentumChange:(micro[ps]>=65?'STRONG':'WEAK')+' '+momentumChange,entryTiming:ready?'OPEN':exhaustion>=70?'LATE':'CLOSED',finalState:state,score};
 return {...side,confidence:score,checks,blocked,ready,balanced:{version:BALANCED_VERSION,state,metrics,support}};
}
