// Paper-only research policy. A score is evidence strength, not win probability.
export const ADAPTIVE_POLICY=Object.freeze({version:'adaptive-paper-v3',threshold:70,rejectionTrigger:15,multiplier:1.25,baseScaleTolerance:.05,baseEdgeBuffer:.02});
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
export function scoreAdaptiveEvidence(data,{volatility=0,rejections=0}={}){
 const p=ADAPTIVE_POLICY,volatilityScale=clamp(volatility*50,1,3),multiplier=rejections>15?p.multiplier:1;
 const scaleTolerance=p.baseScaleTolerance*volatilityScale*multiplier,edgeBuffer=p.baseEdgeBuffer/multiplier;
 const valid=[data.scale_metric,data.pressure_score,data.edge_proximity,data.historical_support,volatility,rejections].every(Number.isFinite)&&volatility>=0&&rejections>=0&&['pressure_score','edge_proximity','historical_support'].every(k=>data[k]>=0&&data[k]<=1);
 if(!valid)return {action:'WAIT',score:0,reason:'Missing or invalid evidence',valid:false};
 const penalties={scale:Math.abs(data.scale_metric)>scaleTolerance?Math.min(30,Math.abs(data.scale_metric)/scaleTolerance*15):0,pressure:data.pressure_score>.65?(data.pressure_score-.65)*40:0,edge:data.edge_proximity<edgeBuffer?25:0};
 const relaxationBonus=rejections>15?10:0,supportBonus=data.historical_support*15,rawScore=100-Object.values(penalties).reduce((a,b)=>a+b,0)+supportBonus+relaxationBonus,score=clamp(rawScore,0,100);
 return {action:score>=70?'TAKE':'REJECT',score,rawScore,threshold:70,valid:true,penalties,supportBonus,relaxationBonus,relaxationApplied:relaxationBonus>0,approved:score>=70,effectiveMultiplier:volatilityScale*multiplier,volatilityScale,multiplier,scaleTolerance,edgeBuffer,rejections,reason:`Evidence score ${score.toFixed(2)}/100; requires 70. Scale penalty ${penalties.scale.toFixed(2)}, pressure penalty ${penalties.pressure.toFixed(2)}, edge penalty ${penalties.edge}, support bonus ${supportBonus.toFixed(2)}, relaxation bonus ${relaxationBonus}.`};
}
export function adaptiveAssessment(state,c,{rejections=0}={}){
 const prices=state.ticks.slice(-50).map(t=>t.price),validPrices=prices.length>=2&&prices.every(p=>Number.isFinite(p)&&p>0);
 const returns=validPrices?prices.slice(1).map((p,i)=>(p-prices[i])/prices[i]):[];
 const volatility=returns.length?Math.sqrt(returns.reduce((s,r)=>s+r*r,0)/returns.length):NaN;
 const directionalPosition=(c.direction==='OVER'?-1:1)*state.position;
 const last=state.ticks.at(-1).digit,clearance=c.direction==='OVER'?last-c.barrier:c.barrier-last;
 const data={scale_metric:Math.max(0,-directionalPosition)/100,pressure_score:c.entryEdge.pressure/100,edge_proximity:clamp(clearance/9),historical_support:c.observed};
 const result=scoreAdaptiveEvidence(data,{volatility,rejections});
 if(state.ticks.length<50)Object.assign(result,{action:'WAIT',score:0,valid:false,reason:'50 observations required for the paper comparison.'});
 return {...result,candidateId:c.id,label:c.label,phase:result.action==='TAKE'?'ACTIONABLE':result.action==='WAIT'?'WARMING UP':'NO TRADE',paperOnly:true,evidence:data,volatility};
}
// One rejection per new market observation, never per render or per candidate.
export class AdaptivePaperSession{
 constructor(evaluate){this.evaluate=evaluate;this.markets=new Map();}
 evaluateState(state,mask){
  let m=this.markets.get(state.market);
  if(m&&state.sequence<m.sequence)throw Error('Out-of-order paper observation');
  if(m?.id===state.id)return m.result;
  if(!m||state.sequence-m.sequence>60)m={rejections:0};
  const result=this.evaluate(state,mask,{profile:'adaptive-paper',rejections:m.rejections});
  const valid=state.ticks.length>=50&&result.evaluations.some(e=>e.enabled&&e.valid);
  const rejections=result.selected?0:valid?m.rejections+1:m.rejections;
  this.markets.set(state.market,{id:state.id,sequence:state.sequence,rejections,result});return result;
 }
}
