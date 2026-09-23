// Independent, deterministic Part Two analysis. No trading or DOM dependencies.
export const WINDOWS = Object.freeze([50, 100, 200, 300, 500, 1000]);
export const CONFIG = Object.freeze({ capacity:1000, shortWindow:50, longWindow:200, transitionMinimum:30, smoothing:1 });
export function precisionFromPip(pip) {
  const value = Number(pip);
  if (!(value > 0 && value <= 1)) throw Error('Invalid symbol precision');
  for (let places=0; places<=10; places++) if (Math.abs(value * 10 ** places - 1) < 1e-8) return places;
  throw Error('Unsupported symbol precision');
}
export function extractDigit(quote, precision) {
  if (!Number.isInteger(precision) || precision < 0 || precision > 10 || quote === null || quote === '' || !Number.isFinite(Number(quote)) || Number(quote)<0) throw Error('Invalid quote or missing precision');
  const fullQuote = Number(quote).toFixed(precision);
  return {fullQuote, digit:Number(fullQuote.at(-1))};
}
export function wins(type, barrier, digit) {
  if (!['OVER','UNDER'].includes(type) || !Number.isInteger(barrier) || barrier < (type==='OVER'?0:1) || barrier > (type==='OVER'?8:9) || !Number.isInteger(digit) || digit<0 || digit>9) throw Error('Invalid digit contract');
  return type==='OVER' ? digit>barrier : digit<barrier;
}
export function frequencies(history) {
  const counts=Array(10).fill(0); for(const tick of history) counts[tick.digit]++;
  return counts.map((count,digit)=>({digit,count,frequency:history.length?count/history.length:null,
    deviation:history.length?count/history.length-.1:null,
    z:history.length?(count-history.length*.1)/Math.sqrt(history.length*.09):null}));
}
export function transitions(history, smoothing=1) {
  const matrix=Array.from({length:10},()=>Array(10).fill(0));
  for(let i=1;i<history.length;i++) matrix[history[i-1].digit][history[i].digit]++;
  return matrix.map((counts,previous)=>{
    const sample=counts.reduce((a,b)=>a+b,0);
    return {previous,counts,sample,probabilities:counts.map(n=>(n+smoothing)/(sample+10*smoothing))};
  });
}
export class TickEngine {
  constructor(symbol, precision, config=CONFIG) {this.symbol=symbol;this.precision=precision;this.config={...CONFIG,...config};this.history=[];this.sequence=0;this.lastEpoch=null;this.lastId=null;}
  add(raw) {
    if (raw.symbol!==this.symbol || !Number.isFinite(raw.epoch)) throw Error('Wrong symbol or invalid timestamp');
    if (this.lastEpoch!==null && raw.epoch<this.lastEpoch) throw Error('Out-of-order tick');
    if (raw.id && raw.id===this.lastId && raw.epoch===this.lastEpoch && Number(raw.quote)===Number(this.history.at(-1)?.quote)) return null;
    const parsed=extractDigit(raw.quote,this.precision);
    const tick={timestamp:raw.epoch,symbol:this.symbol,quote:parsed.fullQuote,digit:parsed.digit,sequence:++this.sequence};
    this.lastEpoch=raw.epoch;this.lastId=raw.id;this.history.push(tick);
    if(this.history.length>this.config.capacity)this.history.shift();
    return tick;
  }
  analyze() {
    const n=this.history.length, windows=Object.fromEntries(WINDOWS.map(size=>[size,{ready:n>=size,sample:Math.min(n,size),digits:frequencies(this.history.slice(-size))}]));
    const short=frequencies(this.history.slice(-this.config.shortWindow)),long=frequencies(this.history.slice(-this.config.longWindow));
    const digits=short.map((s,i)=>{
      const l=long[i], ready=n>=this.config.longWindow;
      const state=!ready?'COLLECTING':s.z>=2&&l.z>=2?'VERY HOT':s.z>=1&&l.z>=1?'HOT':s.z<=-2&&l.z<=-2?'VERY COLD':s.z<=-1&&l.z<=-1?'COLD':'NEUTRAL';
      return {...s,state,longFrequency:l.frequency,momentum:ready?(s.frequency-l.frequency)*100:null};
    });
    const matrix=transitions(this.history,this.config.smoothing),last=this.history.at(-1),row=last?matrix[last.digit]:null;
    const candidates=[];
    for(const type of ['OVER','UNDER'])for(let barrier=type==='OVER'?0:1;barrier<=(type==='OVER'?8:9);barrier++) {
      const allowed=Array.from({length:10},(_,i)=>i).filter(d=>wins(type,barrier,d));
      const matches=this.history.filter(t=>wins(type,barrier,t.digit)).length;
      candidates.push({type,barrier,baseline:allowed.length/10,sample:n,empirical:n?matches/n:null,
        smoothed:(matches+allowed.length*this.config.smoothing)/(n+10*this.config.smoothing),
        conditional:row&&row.sample>=this.config.transitionMinimum?allowed.reduce((sum,d)=>sum+row.probabilities[d],0):null,
        transitionSample:row?.sample??0});
    }
    return {windows,digits,matrix,candidates,last,sample:n};
  }
}
