// Chronological calibration fit followed by untouched later evaluation.
// Diagnostic only; never marks an execution model as validated.
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
