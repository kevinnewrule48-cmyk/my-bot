import {freeze,assertCandidate} from './balance-engine.js';
export const DECISION_SCHEMA=1;
export function decisionMismatch(field,expected,actual){return Object.assign(Error(`TRADE BLOCKED — AUTHORITATIVE DECISION MISMATCH · ${field}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`),{code:'AUTHORITATIVE_DECISION_MISMATCH',mismatch:{field,expected,actual}});}
export function createTradeDecision(candidate,balanceState,{mode='auto',regime=null,now=Date.now()}={}){
 assertCandidate(candidate,balanceState,{now,allowManual:mode==='manual'});
 return freeze({schema:DECISION_SCHEMA,decisionId:candidate.id,mode,lockedAt:now,expiresAt:candidate.createdAt+5000,
  candidate,balanceState,regime:regime?structuredClone(regime):null,
  selectionReason:mode==='manual'?'Explicit manual click on this independently qualified candidate':'All required conditions passed; rank by excess support over each barrier baseline, then clearance. No direction quota.',
  considered:balanceState.candidates.map(c=>({direction:c.direction,barrier:c.barrier,support:100*c.observed,ready:c.ready,rejections:c.checks.filter(k=>!k.pass).map(k=>k.name)}))});
}
export function validateTradeDecision(decision,request,now=Date.now(),activeDecisionId=decision?.decisionId){
 if(!decision||decision.schema!==DECISION_SCHEMA)throw decisionMismatch('decision','locked schema 1 object',decision?.schema??null);
 const c=decision.candidate;
 for(const [name,expected,actual] of [['decision ID',decision.decisionId,activeDecisionId],['candidate ID',decision.decisionId,c?.id],['request ID',decision.decisionId,request.decisionId],['market',c?.market,request.symbol],['contract type',c?.contractType,request.type],['barrier',c?.barrier,request.barrier],['mode',decision.mode,request.mode]])if(expected!==actual)throw decisionMismatch(name,expected,actual);
 if(!Number.isFinite(decision.lockedAt)||decision.expiresAt!==c.createdAt+5000||now>decision.expiresAt||now<decision.lockedAt-1000)throw Object.assign(Error('TRADE BLOCKED — DECISION EXPIRED; require fresh current analysis'),{code:'DECISION_EXPIRED'});
 if(request.candidate&&JSON.stringify(request.candidate)!==JSON.stringify(c))throw decisionMismatch('candidate snapshot',c,request.candidate);
 if(request.balanceState&&JSON.stringify(request.balanceState)!==JSON.stringify(decision.balanceState))throw decisionMismatch('balance snapshot ID',decision.balanceState.id,request.balanceState.id);
 assertCandidate(c,decision.balanceState,{now,allowManual:decision.mode==='manual'});
 return decision;
}
