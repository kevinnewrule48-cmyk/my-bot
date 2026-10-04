import {TrendConfirmation,V2_VERSION} from './trend-confirmation.js';
import {balancedCandidate,BALANCED_VERSION} from './balanced.js';
// Pure, causal analysis shared by the server, dashboard and replay runner.
export const DEFAULTS=Object.freeze({fast:10,medium:30,slow:80,micro:20,short:50,mediumWindow:100,structural:200,macro:false,pressure:65,confidence:80,maxChop:35,chopFilter:true,minEfficiency:60,minStrength:60,minPersistence:65,maxDeceleration:0.65,minVolatility:0.05,maxVolatility:4,staleMs:10000,candleTicks:10});
const clamp=x=>Math.max(0,Math.min(100,x));
const sum=a=>a.reduce((s,x)=>s+x,0);
const mean=a=>a.length?sum(a)/a.length:0;
export function configuration(input={}){
 const c={...DEFAULTS,...input};
 if(c.analysisMode!==undefined&&c.analysisMode!==BALANCED_VERSION&&c.analysisMode!==V2_VERSION)throw Error("Unknown analysis mode");
 for(const k of Object.keys(DEFAULTS)){if(k==='macro'||k==='chopFilter'){if(typeof c[k]!=='boolean')throw Error('Invalid '+k+' setting');continue;}if(!Number.isFinite(c[k]))throw Error('Invalid '+k);}
 for(const k of ['fast','medium','slow','micro','short','mediumWindow','structural','candleTicks'])if(!Number.isInteger(c[k])||c[k]<2||c[k]>1000)throw Error('Invalid period '+k);
 if(!(c.fast<c.medium&&c.medium<c.slow&&c.micro<c.short&&c.short<c.mediumWindow&&c.mediumWindow<c.structural))throw Error('Periods must be ascending');
 for(const k of ['pressure','confidence','maxChop','minEfficiency','minStrength','minPersistence'])if(c[k]<0||c[k]>100)throw Error('Invalid threshold '+k);
 if(c.pressure<=50||c.staleMs<1000||c.staleMs>30000||c.maxDeceleration<=0||c.maxDeceleration>1||c.minVolatility<0||c.maxVolatility<=c.minVolatility)throw Error('Invalid filter settings');
 return c;
}
export function pressure(prices,n){const p=prices.slice(-(n+1)),d=p.slice(1).map((x,i)=>x-p[i]),up=sum(d.map(x=>Math.max(x,0))),down=sum(d.map(x=>Math.max(-x,0))),total=up+down;return {ready:d.length===n,up:total?100*up/total:50,down:total?100*down/total:50,efficiency:total?100*Math.abs(p.at(-1)-p[0])/total:0,total,changes:d};}
export function ema(prices,n){const a=2/(n+1),out=[];for(const p of prices)out.push(out.length?a*p+(1-a)*out.at(-1):p);return out;}
const slope=p=>{const n=p.length,x=(n-1)/2,y=mean(p);let a=0,b=0;for(let i=0;i<n;i++){a+=(i-x)*(p[i]-y);b+=(i-x)**2;}return b?a/b:0;};
const alternation=d=>{const signs=d.filter(x=>x!==0).map(Math.sign);return signs.length<2?0:100*signs.slice(1).filter((x,i)=>x!==signs[i]).length/(signs.length-1);};
export function candles(prices,n){const out=[];for(let i=0;i+n<=prices.length;i+=n){const p=prices.slice(i,i+n);out.push({open:p[0],close:p.at(-1),high:Math.max(...p),low:Math.min(...p)});}return out;}
export function analyze(ticks,input={},now=Date.now()){
 if(input.analysisMode===V2_VERSION){const c=configuration(input),a=analyze(ticks,{...c,analysisMode:BALANCED_VERSION},now);return new TrendConfirmation(c).project({...a,config:c},now,ticks.at(-1)?.epoch);}
 const c=configuration(input),p=ticks.map(t=>Number(t.quote)),last=ticks.at(-1),need=Math.max(c.structural+1,c.slow*3,c.macro?501:0),sample=p.length;
 const windows=Object.fromEntries([10,c.micro,c.short,c.mediumWindow,c.structural,...(c.macro?[500]:[])].map(n=>[n,pressure(p,n)]));
 const empty={state:'NO TRADE',marketState:'COLLECTING',reason:`Collecting history ${sample}/${need}`,sample,need,windows,candidates:[],config:c};
 if(sample<need||p.some(x=>!Number.isFinite(x)))return empty;
 const s=windows[c.short],micro=windows[c.micro],medium=windows[c.mediumWindow],structural=windows[c.structural];
 const fast=ema(p,c.fast),med=ema(p,c.medium),slow=ema(p,c.slow),priceSlope=slope(p.slice(-c.micro));
 const slopes=[fast,med,slow].map(a=>slope(a.slice(-10))),alignment=fast.at(-1)>med.at(-1)&&med.at(-1)>slow.at(-1)?1:fast.at(-1)<med.at(-1)&&med.at(-1)<slow.at(-1)?-1:0;
 const bars=candles(p,c.candleTicks).slice(-10),recent=bars.slice(-3),prior=bars.slice(-6,-3);
 const hh=mean(recent.map(b=>b.high))>mean(prior.map(b=>b.high)),hl=mean(recent.map(b=>b.low))>mean(prior.map(b=>b.low));
 const lh=mean(recent.map(b=>b.high))<mean(prior.map(b=>b.high)),ll=mean(recent.map(b=>b.low))<mean(prior.map(b=>b.low));
 const avgMove=mean(s.changes.map(Math.abs)),baseline=mean(structural.changes.map(Math.abs)),volatility=baseline?avgMove/baseline:0;
 const efficiency=s.efficiency,trendStrength=0.6*efficiency+0.4*medium.efficiency;
 const tickAlternation=alternation(s.changes),candleAlternation=alternation(bars.map(b=>b.close-b.open));
 const emaCompression=100*(1-Math.min(1,Math.abs(fast.at(-1)-slow.at(-1))/(avgMove*5||1)));
 const range=Math.max(...p.slice(-c.short))-Math.min(...p.slice(-c.short)),rangeCompression=100*(1-Math.min(1,range/(baseline*Math.sqrt(c.short)||1)));
 const balance=100-Math.abs(s.up-s.down);
 let failures=0,breakouts=0;for(let i=10;i<p.length-1;i++){const prev=p.slice(i-10,i),hi=Math.max(...prev),lo=Math.min(...prev);if(p[i]>hi||p[i]<lo){breakouts++;if(p[i]>hi&&p[i+1]<hi||p[i]<lo&&p[i+1]>lo)failures++;}}
 const failedBreakouts=breakouts?100*failures/breakouts:0;
 const segments=[];for(let i=p.length-50;i<p.length;i+=10)segments.push(Math.sign(p[Math.min(i+9,p.length-1)]-p[i]));
 const persistence=100*Math.max(segments.filter(x=>x===1).length,segments.filter(x=>x===-1).length)/segments.length;
 const chop=clamp(.22*tickAlternation+.10*candleAlternation+.20*(100-efficiency)+.12*emaCompression+.08*rangeCompression+.12*balance+.08*failedBreakouts+.08*(100-persistence));
 const velocity=mean(micro.changes),oldVelocity=mean(s.changes.slice(-2*c.micro,-c.micro)),acceleration=velocity-oldVelocity;
 const stale=!last||now-Number(last.epoch??last.timestamp)*1000>c.staleMs||Number(last.epoch??last.timestamp)*1000>now+2000;
 const candidates=[{type:'CALL',name:'RISE',sign:1},{type:'PUT',name:'FALL',sign:-1}].map(side=>{
  const dir=side.sign,ps=dir===1?'up':'down',structure=dir===1?hh&&hl:lh&&ll;
  const directionalPersistence=100*segments.filter(x=>x===dir).length/segments.length;
  const bodyStrength=mean(bars.slice(-5).map(b=>clamp(100*dir*(b.close-b.open)/(b.high-b.low||1))));
  const continuation=100*micro.changes.filter(x=>dir*x>0).length/micro.changes.length;
  const momentum=clamp(.45*micro[ps]+.30*continuation+.25*bodyStrength);
  const extremum=dir===1?Math.max(...p.slice(-c.micro)):Math.min(...p.slice(-c.micro));
  const pullback=micro.total?100*Math.abs(p.at(-1)-extremum)/micro.total:100;
  const decelerating=dir*oldVelocity>0&&dir*velocity<dir*oldVelocity*(1-c.maxDeceleration);
  const confidence=clamp(.22*s[ps]+.14*medium[ps]+.10*structural[ps]+.15*trendStrength+.14*momentum+.10*directionalPersistence+.10*efficiency+.05*(100-chop));
  const checks={history:sample>=need,fresh:!stale,pressure:[micro,s,medium,structural,...(c.macro?[windows[500]]:[])].every(w=>w.ready&&w[ps]>=c.pressure),alignment:alignment===dir,slopes:slopes.every(x=>dir*x>0)&&dir*priceSlope>0,structure,strength:trendStrength>=c.minStrength,momentum:dir*velocity>0&&momentum>=c.pressure,persistence:directionalPersistence>=c.minPersistence,chop:!c.chopFilter||chop<=c.maxChop,efficiency:efficiency>=c.minEfficiency,volatility:volatility>=c.minVolatility&&volatility<=c.maxVolatility,deceleration:!decelerating,pullback:pullback<=35,confidence:confidence>=c.confidence};
  const candidate={...side,confidence,momentum,persistence:directionalPersistence,pullback,reversalPressure:100-micro[ps],decelerating,bodyStrength,continuation,checks,ready:Object.values(checks).every(Boolean),blocked:Object.entries(checks).filter(([,v])=>!v).map(([k])=>k)};
  return c.analysisMode===BALANCED_VERSION?balancedCandidate(candidate,{micro,short:s,medium,chop,volatility,stale,history:sample>=need,priceSlope}):candidate;
 });
 const eligible=candidates.filter(x=>x.ready),winner=eligible.length===1?eligible[0]:null;
 const marketState=c.analysisMode?[...candidates].sort((a,b)=>b.confidence-a.confidence)[0].balanced.metrics.regime:chop>c.maxChop?'CHOPPY':alignment===1&&hh&&hl?'UPTREND':alignment===-1&&lh&&ll?'DOWNTREND':'SIDEWAYS';
 return {...empty,state:winner?winner.name+' READY':'NO TRADE',marketState,reason:winner?`${winner.name}: all analysis conditions pass`:stale?'Market data is stale':c.analysisMode?candidates.map(x=>x.name+': '+x.balanced.state+' - '+x.blocked.join(', ')).join(' · '):c.chopFilter&&chop>c.maxChop?`Direction changes / compression — ChopScore ${chop.toFixed(1)}%`:candidates.map(x=>x.name+': '+x.blocked.join(', ')).join(' · '),candidates,winner,trendStrength,chop,efficiency,volatility,velocity,oldVelocity,acceleration,priceSlope,lastCandle:bars.at(-1),ema:{fast:fast.at(-1),medium:med.at(-1),slow:slow.at(-1),slopes,alignment},structure:{hh,hl,lh,ll},tickAlternation,candleAlternation,emaCompression,rangeCompression,failedBreakouts,persistence};
}
export class RiseFallEngine{
 constructor(symbol,config={}){this.symbol=symbol;this.config=configuration(config);this.history=[];this.sequence=0;this.episode=0;this.previous=null;if(this.config.analysisMode===V2_VERSION)this.trend=new TrendConfirmation(this.config);}
 arm(token){this.trend?.arm(token);return this;}
 disarm(){this.trend?.disarm();}
 confirmExecution(signalId){this.trend?.confirmExecution(signalId);}
 consume(signalId){return this.trend?.consume(signalId)??false;}
 enableTrace(limit=400){this.traceLimit=Math.max(2,Math.min(2000,limit));this.tickTrace=[];this.received=0;this.rejectedTicks=0;return this;}
 add(tick,options={}){const epoch=Number(tick.epoch??tick.timestamp),quote=Number(tick.quote),last=this.history.at(-1);
  const rejection=tick.symbol&&tick.symbol!==this.symbol?'Wrong symbol':!Number.isFinite(epoch)||!Number.isFinite(quote)||quote<=0?'Invalid timestamp or price':last&&epoch<=last.epoch?'Duplicate or out-of-order timestamp':null;
  if(!rejection){this.history.push({epoch,quote,symbol:this.symbol});if(this.history.length>Math.max(1500,this.config.slow*3+1))this.history.shift();this.sequence++;}
  if(this.traceLimit){this.received++;if(rejection)this.rejectedTicks++;const delta=last?quote-last.quote:null;this.lastTickTrace={received:this.received,epoch,price:quote,previousPrice:last?.quote??null,delta,direction:delta===null?'FIRST':delta>0?'UP':delta<0?'DOWN':'FLAT',accepted:!rejection,rejection,sequence:this.sequence,historySize:this.history.length,historyStart:this.history[0]?.epoch,historyEnd:this.history.at(-1)?.epoch,completeRollingCandles:Math.floor(this.history.length/this.config.candleTicks),partialCandleTicks:this.history.length%this.config.candleTicks};this.tickTrace.push(this.lastTickTrace);if(this.tickTrace.length>this.traceLimit)this.tickTrace.shift();}
  if(!rejection&&this.trend){
   const receivedAt=options.receivedAt??epoch*1000;
   this.trendBase=options.live===false?null:{...analyze(this.history,{...this.config,analysisMode:BALANCED_VERSION},receivedAt),config:this.config};
   if(options.live===false){if(this.trend.armed){this.trend.invalidate('OBSERVING','Historical backfill is not live evidence');this.trend.live=0;this.trend.block=[];this.trend.revision++;}}
   else this.trend.observe(this.trendBase,{epoch,quote},last?quote-last.quote:null);
  }
  return !rejection;
 }
 snapshot(now=Date.now()){
  if(this.trend){const a=this.trendBase??={...analyze(this.history,{...this.config,analysisMode:BALANCED_VERSION},now),config:this.config};return {...this.trend.project(a,now,this.history.at(-1)?.epoch),symbol:this.symbol,sequence:this.sequence,epoch:this.history.at(-1)?.epoch,quote:this.history.at(-1)?.quote,tickTrace:this.lastTickTrace};}
  const a=analyze(this.history,this.config,now),side=a.winner?.type??null;if(side!==this.previous){this.episode++;this.previous=side;}return {...a,symbol:this.symbol,sequence:this.sequence,signalId:side?`${this.symbol}:${this.episode}:${side}`:null,epoch:this.history.at(-1)?.epoch,quote:this.history.at(-1)?.quote,tickTrace:this.lastTickTrace};}
}
