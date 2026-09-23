// Chronological calibration fit followed by untouched later evaluation.
// Diagnostic only; never marks an execution model as validated.
export function independentSessionReport(sessions,baseline,{minBin=30,minEvaluation=100}={}) {
  if(!Array.isArray(sessions)||sessions.length<2)throw Error('Import at least two separate sessions: earlier training and later evaluation.');
  if(!(baseline>0&&baseline<1))throw Error('Invalid baseline');
  const sorted=[...sessions].sort((a,b)=>a.start-b.start);
  for(let i=0;i<sorted.length;i++){
    const s=sorted[i];
    if(!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.end<s.start||!Array.isArray(s.forecasts))throw Error('Invalid session boundaries');
    if(s.symbol!==sorted[0].symbol)throw Error('Validate each market separately.');
    if(i&&s.start<=sorted[i-1].end)throw Error('Sessions overlap or duplicate one another. Use separate, chronological recordings.');
    for(const f of s.forecasts)if(!Number.isFinite(f.probability)||f.probability<0||f.probability>1||typeof f.won!=='boolean')throw Error('Invalid forecast');
  }
  const training=sorted.slice(0,-1).flatMap(s=>s.forecasts),evaluation=sorted.at(-1).forecasts;
  const bins=new Map(),key=p=>Math.round(p*20)*5;
  for(const f of training){const k=key(f.probability),b=bins.get(k)??{count:0,wins:0};b.count++;b.wins+=Number(f.won);bins.set(k,b);}
  const covered=evaluation.flatMap(f=>{const b=bins.get(key(f.probability));return b?.count>=minBin?[{...f,calibrated:(b.wins+baseline*10)/(b.count+10)}]:[];});
  const error=fn=>covered.length?covered.reduce((sum,f)=>sum+(fn(f)-Number(f.won))**2,0)/covered.length:null;
  const calibratedBrier=error(f=>f.calibrated),baselineBrier=error(()=>baseline);
  return {training:training.length,evaluation:evaluation.length,covered:covered.length,trainingSessions:sorted.length-1,
    rawBrier:error(f=>f.probability),calibratedBrier,baselineBrier,
    sufficient:covered.length>=minEvaluation,beatsBaseline:covered.length>=minEvaluation&&calibratedBrier<baselineBrier,
    bins:[...bins].map(([bucket,b])=>({bucket,...b,estimate:b.count>=minBin?(b.wins+baseline*10)/(b.count+10):null})),
    executable:false,note:'Earlier sessions train a frozen mapping; the final non-overlapping session evaluates it. This descriptive comparison alone does not establish profitable edge or authorize Auto.'};
}
export function holdoutReport(forecasts,baseline,{fraction=.6,minBin=30,minEvaluation=100}={}) {
  if(!(baseline>0&&baseline<1)||!(fraction>0&&fraction<1))throw Error('Invalid validation settings');
  const cut=Math.floor(forecasts.length*fraction),training=forecasts.slice(0,cut),evaluation=forecasts.slice(cut);
  const bins=new Map();const key=p=>Math.round(p*20)*5;
  for(const f of training){const k=key(f.probability),b=bins.get(k)??{count:0,wins:0};b.count++;b.wins+=Number(f.won);bins.set(k,b);}
  const scored=evaluation.map(f=>{const b=bins.get(key(f.probability));return {...f,calibrated:b&&b.count>=minBin?(b.wins+baseline*10)/(b.count+10):null};});
  const covered=scored.filter(f=>f.calibrated!==null),brier=(rows,fn)=>rows.length?rows.reduce((sum,f)=>sum+(fn(f)-Number(f.won))**2,0)/rows.length:null;
  return {training:training.length,evaluation:evaluation.length,covered:covered.length,
    rawBrier:brier(covered,f=>f.probability),calibratedBrier:brier(covered,f=>f.calibrated),baselineBrier:brier(covered,()=>baseline),
    sufficient:covered.length>=minEvaluation,executable:false,
    bins:[...bins.entries()].map(([bucket,b])=>({bucket,...b,estimate:b.count>=minBin?(b.wins+baseline*10)/(b.count+10):null})),
    note:'First 60% fits buckets; later 40% evaluates a frozen mapping. Brier comparisons use identical covered forecasts. Overlap and model selection require further independent-session validation; this does not authorize trading.'};
}
