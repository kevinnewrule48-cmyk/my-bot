// Part One: descriptive, independent barrier analysis. No next-digit prediction.
export const DEFAULTS=Object.freeze({minimumSample:50,fullSample:200,minimumConfidence:65,minimumSupport:.9,lossDigitMaximum:.08,oppositeDigitMinimum:.10,persistence:1,quietTicks:5,jump:7});
export function extractLastDigit(price,precision){
  if(price===null||price===''||!Number.isFinite(Number(price))||Number(price)<0||!Number.isInteger(precision)||precision<0||precision>10)throw Error('Invalid price or missing digit precision');
  const quote=Number(price).toFixed(precision);return {quote,digit:Number(quote.at(-1))};
}
export function barrierCandidates(history){
  const counts=Array(10).fill(0);
  for(const t of history){if(!Number.isInteger(t.digit)||t.digit<0||t.digit>9)throw Error('Invalid digit');counts[t.digit]++;}
  return ['OVER','UNDER'].map(type=>{
    const barrier=type==='OVER'?1:8,winningDigits=counts.map((_,d)=>d).filter(d=>type==='OVER'?d>barrier:d<barrier);
    const winningCount=winningDigits.reduce((n,d)=>n+counts[d],0),n=history.length;
    return {type,barrier,label:`${type} ${barrier}`,winningDigits,counts:counts.slice(),sample:n,winningCount,observed:n?winningCount/n:0,risk:n?(n-winningCount)/n:1,baseline:.8};
  });
}
export function conditionGate(checks){return checks.length>0&&checks.every(c=>c.pass===true);}
export function selectCandidate(candidates){
  const eligible=candidates.filter(c=>c.ready).sort((a,b)=>b.score-a.score||b.observed-a.observed);
  if(!eligible.length)return null;
  if(eligible.length>1&&Math.abs(eligible[0].score-eligible[1].score)<1e-9&&Math.abs(eligible[0].observed-eligible[1].observed)<1e-9)return null;
  return eligible[0];
}
export class DigitBarrierEngine{
  constructor(config={}){this.config={...DEFAULTS,...config};this.reset();}
  reset(){this.context=null;this.sequence=null;this.previous=null;this.streak=[0,0];this.cached=null;}
  analyze(history,{context='default',sequence,minimumConfidence=this.config.minimumConfidence,persistence=this.config.persistence}={}){
    if(!Number.isInteger(sequence)||sequence<0||!Number.isInteger(persistence)||persistence<1||!Number.isFinite(minimumConfidence)||minimumConfidence<0||minimumConfidence>100)throw Error('Invalid analysis settings');
    const settings=`${context}:${minimumConfidence}:${persistence}`;
    if(this.context!==settings)this.reset();
    if(this.sequence===sequence)return this.cached;
    if(this.sequence!==null&&sequence<this.sequence)throw Error('Out-of-order analysis');
    const c=this.config,raw=barrierCandidates(history),n=history.length;
    let quiet=0;for(let i=history.length-1;i>0&&quiet<c.quietTicks;i--){if(Math.abs(history[i].digit-history[i-1].digit)>=c.jump)break;quiet++;}
    const stable=quiet>=Math.min(c.quietTicks,Math.max(0,n-1));
    const candidates=raw.map((side,i)=>{
      const momentum=this.previous?100*(side.observed-this.previous[i].observed):null;
      const advantage=side.observed-raw[1-i].observed;
      const score=Math.round(Math.max(0,Math.min(95,50+Math.max(0,advantage)*300*Math.min(1,n/c.fullSample))));
      const losses=side.type==='OVER'?[0,1]:[8,9],opposite=side.type==='OVER'?[8,9]:[0,1];
      const zone=n>0&&losses.every(d=>side.counts[d]*100<=n*c.lossDigitMaximum*100)&&opposite.every(d=>side.counts[d]*100>=n*c.oppositeDigitMinimum*100);
      const checks=[{name:'Barrier',pass:n>=c.minimumSample&&side.observed>=c.minimumSupport},
        {name:'Momentum',pass:momentum!==null&&momentum>=-1e-9},{name:'Zone',pass:zone},
        {name:'Stability',pass:stable},{name:'Score',pass:score>=minimumConfidence}];
      this.streak[i]=conditionGate(checks)?this.streak[i]+1:0;
      checks.push({name:'Persistence',pass:this.streak[i]>=persistence},{name:'Confidence',pass:score>=minimumConfidence},
        {name:'Quality',pass:n>=c.minimumSample});
      return {...side,momentum,zone,stability:stable?100:0,score,confidence:score,quality:Math.min(100,n/c.minimumSample*100),persistence:this.streak[i],checks,gatePercent:checks.filter(x=>x.pass).length/checks.length*100,ready:conditionGate(checks)};
    });
    this.context=settings;this.sequence=sequence;this.previous=raw;
    return this.cached={context,sequence,candidates,selected:selectCandidate(candidates)};
  }
}
export function proposalRequest({type,symbol,stake,currency='USD'}){
  if(!['OVER','UNDER','DIGITOVER','DIGITUNDER'].includes(type)||!/^[A-Za-z0-9_]{2,30}$/.test(symbol)||!Number.isFinite(stake)||stake<=0||!/^[A-Z]{3,8}$/.test(currency))throw Error('Invalid proposal parameters');
  const over=type==='OVER'||type==='DIGITOVER';
  return {proposal:1,amount:stake,basis:'stake',contract_type:over?'DIGITOVER':'DIGITUNDER',currency,duration:1,duration_unit:'t',barrier:over?'1':'8',underlying_symbol:symbol};
}
export function validateProposal(p,stake){
  if(!p?.id||!Number.isFinite(Number(p.ask_price))||Number(p.ask_price)<=0||Number(p.ask_price)>stake||!Number.isFinite(Number(p.payout))||Number(p.payout)<=Number(p.ask_price))throw Error('Invalid Deriv proposal');
  return {buy:p.id,price:Number(p.ask_price)};
}
