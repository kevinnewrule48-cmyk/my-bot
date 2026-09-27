// Read-only diagnostics. Never selects a candidate, advances persistence or buys a contract.
const clip=x=>Math.max(0,Math.min(1,x));
export function experimentalConfidence(candidate){
  if(!candidate.sample||candidate.momentum===null)return null;
  const supportExcess=clip((candidate.observed-.8)/.2);
  const momentum=clip(.5+candidate.momentum*candidate.sample/200);
  const stability=candidate.stability/100;
  return {value:100*(.5*supportExcess+.25*momentum+.25*stability),
    components:{supportExcess,momentum,stability},experimental:true,usedForTrading:false,
    interpretation:'Observed evidence index, not win probability; correlated inputs remain possible'};
}
export function diagnoseSnapshot(snapshot,{timestamp=null,market=null,quote=null,lastDigit=null,rollingWindow=200,risk={},config={}}={}){
  const candidates=snapshot.candidates.map((c,i)=>{
    const lossDigits=c.type==='OVER'?[0,1]:[8,9],oppositeDigits=c.type==='OVER'?[8,9]:[0,1];
    const digitPercentages=c.counts.map(n=>c.sample?100*n/c.sample:0);
    const lossMax=config.lossDigitMaximum??.08,oppositeMin=config.oppositeDigitMinimum??.10;
    const components=[...lossDigits.map(d=>({digit:d,kind:'lossMaximum',value:digitPercentages[d],threshold:lossMax*100,pass:c.sample>0&&c.counts[d]*100<=c.sample*lossMax*100})),
      ...(config.requireOppositeZone?oppositeDigits.map(d=>({digit:d,kind:'oppositeMinimum',value:digitPercentages[d],threshold:oppositeMin*100,pass:c.sample>0&&c.counts[d]*100>=c.sample*oppositeMin*100})):[])];
    const failedConditions=c.checks.filter(x=>!x.pass).map(x=>x.name);
    return {...c,digitPercentages,support:c.observed,lossRate:c.risk,supportAdvantage:c.observed-snapshot.candidates[1-i].observed,
      zoneMeasurements:components,failedConditions,sampleAdequacy:c.quality,
      legacyConfidenceEqualsScore:true,experimentalConfidence:experimentalConfidence(c),
      reasonSelected:snapshot.selected?.type===c.type?'Complete configured gate passed; highest Score, then support among READY candidates':null,
      reasonRejected:snapshot.selected?.type===c.type?null:!c.ready?'Failed conditions: '+failedConditions.join(', '):snapshot.selected?'Another READY candidate ranked higher':'Exact eligible score/support tie; neither selected'};
  });
  const [o,u]=candidates;
  const stages=[['candidate-generation',o.support,u.support],['scoring',o.score,u.score],['persistence',o.persistence,u.persistence],['condition-gate',o.ready,u.ready],['candidate-selection',snapshot.selected?.type==='OVER',snapshot.selected?.type==='UNDER']];
  const differing=stages.filter(([,a,b])=>typeof a==='number'?Math.abs(a-b)>1e-9:a!==b);
  const checkDifferences=o.checks.filter((c,i)=>c.pass!==u.checks[i].pass).map(c=>c.name);
  return {timestamp,market,quote,lastDigit,rollingWindow,sequence:snapshot.sequence,context:snapshot.context,config,
    digitCounts:o.counts.slice(),candidates,selected:snapshot.selected?.type??null,risk,
    firstDivergence:differing[0]?.[0]??null,firstGateDifference:checkDifferences[0]??null,
    differingStages:differing.map(([stage,over,under])=>({stage,over,under})),
    checkDifferences,downstream:'Proposal and execution must be joined by decisionId; not inferred from READY'};
}
