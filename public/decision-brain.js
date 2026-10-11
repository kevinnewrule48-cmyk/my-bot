// Deterministic interpretation of existing digit evidence. No predictive claim.
export const BARRIER_KEYS=Object.freeze(['OVER:1','OVER:2','UNDER:8','UNDER:7']);
export const ALL_BARRIERS=Object.freeze(Object.fromEntries(BARRIER_KEYS.map(k=>[k,true])));
export const barrierKey=c=>`${c.direction}:${c.barrier}`;
export function eligibility(mask=ALL_BARRIERS){
 if(!mask||BARRIER_KEYS.some(k=>typeof mask[k]!=='boolean')||Object.keys(mask).some(k=>!BARRIER_KEYS.includes(k)))throw Error('Invalid Auto barrier eligibility');
 return Object.fromEntries(BARRIER_KEYS.map(k=>[k,mask[k]]));
}
export function assessCandidate(state,candidate){
 const losing=d=>candidate.direction==='OVER'?d<=candidate.barrier:d>=candidate.barrier;
 const measure=rows=>({sample:rows.length,support:rows.length?rows.filter(t=>!losing(t.digit)).length/rows.length:0,clearance:rows.length?rows.reduce((s,t)=>s+(candidate.direction==='OVER'?t.digit-candidate.barrier:candidate.barrier-t.digit),0)/rows.length:0});
 const ticks=state.ticks,broad=measure(ticks),recent=measure(ticks.slice(-25)),prior=measure(ticks.slice(-50,-25));
 const reference={support:candidate.baseline,clearance:candidate.direction==='OVER'?4.5-candidate.barrier:candidate.barrier-4.5};
 const evidence={broad,recent,prior,reference,pressure:candidate.entryEdge,displacement:state.position,distributionStability:state.fine.stability,price:state.environment.price};
 const finish=(action,phase,reason)=>({candidateId:candidate.id,label:candidate.label,action,phase,reason,evidence});
 if(candidate.deterioration)return finish('REJECT','DETERIORATING','Dangerous digits have returned or current loss-side pressure is rising.');
 if(!candidate.ready)return finish('REJECT','NO TRADE','Candidate does not qualify: '+candidate.checks.filter(x=>!x.pass).map(x=>x.name).join(', '));
 if(prior.sample<25)return finish('WAIT','DEVELOPING','A recent observation exists, but two complete independent 25-tick blocks are not available to compare.');
 // Contradiction is relational: recent support AND clearance have crossed
 // below the uniform-digit references despite a favorable scale.
 if(recent.support<=reference.support&&recent.clearance<=reference.clearance)return finish('REJECT','DETERIORATING','Recent support and clearance contradict the scale direction.');
 if(recent.support<prior.support&&recent.clearance<prior.clearance)return finish('REJECT','DETERIORATING','Both support and clearance are falling against the preceding block.');
 if(broad.support<=reference.support||broad.clearance<=reference.clearance)return finish('WAIT','DEVELOPING','The larger history does not yet support the observed candidate advantage.');
 if(prior.support<=reference.support||recent.support<=reference.support||prior.clearance<=reference.clearance||recent.clearance<=reference.clearance)return finish('WAIT','ESTABLISHED','Broad advantage exists, but consecutive blocks have not confirmed both support and clearance.');
 return finish('TAKE','ACTIONABLE','Broad history and consecutive blocks agree on support and clearance; current dangerous-digit pressure is not returning.');
}
export function evaluateBrain(state,mask=ALL_BARRIERS){
 const enabled=eligibility(mask);
 const evaluations=state.candidates.map(c=>({...assessCandidate(state,c),enabled:enabled[barrierKey(c)]}));
 const candidates=state.candidates.filter(c=>evaluations.some(e=>e.candidateId===c.id&&e.enabled&&e.action==='TAKE'));
 candidates.sort((a,b)=>b.excessSupport-a.excessSupport||b.clearance-a.clearance);
 const selected=candidates[0]??null;
 return {version:'decision-brain-v1',eligibility:enabled,evaluations,selected,
  action:selected?'TAKE':evaluations.some(e=>e.enabled&&e.action==='WAIT')?'WAIT':'REJECT',
  reason:selected?evaluations.find(e=>e.candidateId===selected.id).reason:Object.values(enabled).some(Boolean)?evaluations.filter(e=>e.enabled).map(e=>`${e.label}: ${e.reason}`).join(' '):'AUTO OU: NO BARRIERS ENABLED'};
}
