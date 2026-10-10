// Descriptive ranking of already-qualified candidates, never an entry gate.
export function environmentEvidence(state, candidate=state?.selected) {
 if(!candidate||!state?.ticks?.length)return null;
 const losses=state.ticks.map(t=>+(candidate.direction==='OVER'?t.digit<=candidate.barrier:t.digit>=candidate.barrier));
 const baseline=candidate.direction==='OVER'?(candidate.barrier+1)/10:(10-candidate.barrier)/10;
 const measure=n=>{const a=losses.slice(-n);return {sample:a.length,lossRate:a.reduce((s,x)=>s+x,0)/a.length};};
 const short=measure(50),long=measure(200);
 // Use the weaker of the two observations. Small samples shrink toward zero
 // rather than claiming a strong environment from two favorable ticks.
 const advantage=100*Math.min(baseline-short.lossRate,baseline-long.lossRate)*Math.min(1,losses.length/200);
 return {advantage,short,long,baseline};
}
