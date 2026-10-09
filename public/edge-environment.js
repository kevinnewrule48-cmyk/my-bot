// Observational measurements and an explicitly unvalidated research policy.
export const EDGE_WINDOWS=Object.freeze([5,10,25,50,200]);
const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
const low=d=>d<=1,high=d=>d>=8,edge=d=>low(d)||high(d);
const cross=(a,b)=>low(a)&&high(b)||high(a)&&low(b);
const same=(a,b)=>a!==b&&(low(a)&&low(b)||high(a)&&high(b));
const weighted=a=>{let sum=0,w=0;a.forEach((v,i)=>{const k=.85**(a.length-1-i);sum+=v*k;w+=k;});return w?sum/w:0;};
const trend=x=>x>1e-9?'RISING':x< -1e-9?'FALLING':'STABLE';
export function edgeSide(d,predicate){
 const visits=d.flatMap((x,i)=>predicate(x)?[i]:[]),gaps=visits.slice(1).map((v,i)=>v-visits[i]);
 const pressure=100*weighted(d.slice(-10).map(x=>+predicate(x))),prior=100*weighted(d.slice(-11,-1).map(x=>+predicate(x))),before=100*weighted(d.slice(-12,-2).map(x=>+predicate(x)));
 const recent=d.slice(-5),prior5=d.slice(-10,-5),previous5=d.slice(-15,-10);
 const rate=a=>100*avg(a.map(x=>+predicate(x))),slope=pressure-prior;
 let persistence=0;for(let i=d.length-1;i>=0&&!predicate(d[i]);i--)persistence++;
 return {pressure,trend:trend(slope),slope,acceleration:slope-(prior-before),short:rate(recent),medium:rate(d.slice(-25)),long:rate(d.slice(-200)),
 transitionChange:rate(recent)-rate(prior5),transitionAcceleration:rate(recent)-2*rate(prior5)+rate(previous5),
 ticksSince:visits.length?d.length-1-visits.at(-1):null,separation:persistence,averageGap:gaps.length?avg(gaps):null,
 gapChange:gaps.length>=4?avg(gaps.slice(-2))-avg(gaps.slice(-4,-2)):null};
}
function range(rows){const prices=rows.map(t=>Number(t.price));if(rows.some(t=>t.price==null)||prices.some(p=>!Number.isFinite(p))||prices.length<2)return null;
 const changes=prices.slice(1).map((p,i)=>p-prices[i]),mean=avg(changes),variance=avg(changes.map(x=>(x-mean)**2));return {sample:changes.length,tickRange:avg(changes.map(Math.abs)),variance,stddev:Math.sqrt(variance),meanChange:mean};}
export function analyzeEnvironment(rows){
 const d=rows.map(t=>t.digit),r=d.slice(-25),pairs=r.slice(1).map((x,i)=>[r[i],x]),crossRate=100*avg(pairs.map(([a,b])=>+cross(a,b))),sameRate=100*avg(pairs.map(([a,b])=>+same(a,b)));
 const occupancy=100*weighted(r.map(x=>+edge(x))),weightedCross=100*weighted(pairs.map(([a,b])=>+cross(a,b))),weightedSame=100*weighted(pairs.map(([a,b])=>+same(a,b)));
 const score=.5*occupancy+.35*weightedCross+.15*weightedSame;
 const short=range(rows.slice(-10)),medium=range(rows.slice(-50)),long=range(rows.slice(-200)),baseline=range(rows.slice(-200,-50));
 const ratio=short&&baseline?(baseline.tickRange?short.tickRange/baseline.tickRange:short.tickRange?Infinity:1):null;
 const deviation=short&&baseline?short.tickRange-baseline.tickRange:null;
 const stabilityRatio=short&&medium?(medium.tickRange?short.tickRange/medium.tickRange:short.tickRange?Infinity:1):null;
 return {sample:rows.length,lastEpoch:rows.at(-1)?.epoch,windows:EDGE_WINDOWS.map(n=>({size:n,sample:Math.min(n,d.length),low:100*avg(d.slice(-n).map(x=>+low(x))),high:100*avg(d.slice(-n).map(x=>+high(x)))})),
 frequencies:Object.fromEntries([0,1,8,9].map(k=>[k,100*avg(r.map(x=>+(x===k)))])),score,category:score<=20?'VERY LOW':score<=40?'LOW':score<=60?'MODERATE':score<=80?'HIGH':'EXTREME',
 occupancy,weightedCross,weightedSame,crossRate,sameRate,low:{...edgeSide(d,low),secondsSince:(()=>{const t=rows.findLast(t=>low(t.digit));return t?rows.at(-1).epoch-t.epoch:null;})()},high:{...edgeSide(d,high),secondsSince:(()=>{const t=rows.findLast(t=>high(t.digit));return t?rows.at(-1).epoch-t.epoch:null;})()},
 price:{short,medium,long,baseline,ratio,deviation,expansion:ratio===null?'UNKNOWN':ratio>1?'EXPANDING':ratio<1?'COMPRESSING':'UNCHANGED',
 level:ratio===null?'UNKNOWN':ratio<.75?'LOW':ratio<=1.25?'MEDIUM':ratio<=2?'HIGH':'EXTREME',
 stability:stabilityRatio===null?'UNKNOWN':stabilityRatio>=.8&&stabilityRatio<=1.25?'STABLE':stabilityRatio>=.5&&stabilityRatio<=2?'TRANSITION':'UNSTABLE'}};
}
export function analyzeAdaptive(rows,environment=analyzeEnvironment(rows)){
 const d=rows.map(t=>t.digit),recent=d.slice(-25),last=d.at(-1);
 const candidates=[['OVER',1,low,environment.low,environment.high],['UNDER',8,high,environment.high,environment.low]].map(([direction,barrier,danger,p,opposite])=>{
  const support=1-avg(recent.map(x=>+danger(x))),clearance=avg(recent.map(x=>direction==='OVER'?x-barrier:barrier-x));
  const required=[{name:'Sample',pass:d.length>=50},{name:'Recent support exceeds uniform digit baseline',pass:support>.8},{name:'Short edge pressure below medium structure',pass:p.short<p.medium},{name:'Current edge quieter than opposite edge',pass:p.pressure<opposite.pressure}];
  const veto=[{name:'Latest digit visits dangerous edge',active:danger(last)},{name:'Edge pressure returning',active:p.slope>1e-9},{name:'Separation not yet repeated',active:p.separation<2}];
  const ready=required.every(x=>x.pass)&&!veto.some(x=>x.active);
  const state=ready?'ACTIONABLE':d.length<50?'FORMING':veto[0].active?'AVOID':p.slope>1e-9?'DETERIORATING':p.slope< -1e-9&&p.short<p.medium?'STRENGTHENING':'FORMING';
  return {direction,barrier,label:direction+' '+barrier,ready,state,required,veto,support,clearance,pressure:p.pressure,slope:p.slope,acceleration:p.acceleration,persistence:p.separation,
   mature:p.separation>=13,excessSupport:support-.8,rejections:[...required.filter(x=>!x.pass).map(x=>x.name),...veto.filter(x=>x.active).map(x=>x.name)]};
 });
 const eligible=candidates.filter(c=>c.ready).sort((a,b)=>b.excessSupport-a.excessSupport||a.pressure-b.pressure);
 return {version:'adaptive-shadow-v1',researchOnly:true,candidates,selected:eligible[0]??null};
}
export class EnvironmentBook{
 constructor(){this.histories=new Map();this.states=new Map();this.listeners=new Set();}
 push(tick){if(!['R_10','R_25','R_50','R_75','R_100'].includes(tick.market)||!Number.isInteger(tick.digit)||tick.digit<0||tick.digit>9||!Number.isFinite(tick.epoch))return false;
  const h=this.histories.get(tick.market)??[];if(h.length&&tick.epoch<=h.at(-1).epoch)return false;if(h.length&&tick.epoch-h.at(-1).epoch>60)h.length=0;
  h.push({...tick});if(h.length>200)h.shift();this.histories.set(tick.market,h);const environment=analyzeEnvironment(h);this.states.set(tick.market,{market:tick.market,receivedAt:performance.now(),environment,adaptive:analyzeAdaptive(h,environment)});for(const fn of this.listeners)fn();return true;
 }
}
