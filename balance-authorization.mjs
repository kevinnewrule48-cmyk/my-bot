import {validateTradeDecision,decisionMismatch} from './public/trade-decision.js';
import {analyzeBalance,assertCandidate} from './public/balance-engine.js';
export function validateBalanceRequest(request,now=Date.now()){
 if(request.decision)validateTradeDecision(request.decision,request,now);
 const state=request.balanceState,candidate=request.candidate;
 if(!state||!candidate)throw Object.assign(Error('Canonical balance state and candidate required'),{code:'BALANCE_REQUIRED'});
 const rebuilt=analyzeBalance(state.market,state.ticks);
 if(JSON.stringify(rebuilt)!==JSON.stringify(state))throw Object.assign(Error('Balance state does not match its digit evidence'),{code:'BALANCE_MISMATCH'});
 assertCandidate(candidate,rebuilt,{type:request.type,barrier:request.barrier,symbol:request.symbol,now,allowManual:request.mode==='manual'});
 if(request.decisionId!==candidate.id)throw Object.assign(Error('Decision ID does not match selected candidate'),{code:'BALANCE_MISMATCH'});
 return candidate;
}
export function validateBalancePurchase(request,observed,now=Date.now()){
 const candidate=validateBalanceRequest(request,now);
 if(!observed||now-observed.receivedAt>5000||observed.epoch*1000<request.balanceState.createdAt)throw Object.assign(Error('Current server market tick required before balance purchase'),{code:'BALANCE_STALE'});
 const last=request.balanceState.ticks.at(-1);
 if(observed.epoch===last.epoch&&observed.digit!==last.digit)throw Object.assign(Error('Server digit disagrees with analyzed tick'),{code:'BALANCE_MISMATCH'});
 if(observed.epoch>last.epoch){
  const history=observed.history??[];
  if(!history.some(t=>t.epoch===last.epoch&&t.digit===last.digit))throw Object.assign(Error('Server has no continuous observations from the analyzed tick'),{code:'BALANCE_STALE'});
  const fresh=history.filter(t=>t.epoch>last.epoch);
  const next=analyzeBalance(request.symbol,[...request.balanceState.ticks,...fresh]);
  const matching=next.candidates.find(c=>c.direction===candidate.direction&&c.barrier===candidate.barrier);
  if(next.createdAt!==observed.epoch*1000||!matching?.ready||next.lean!==candidate.direction)throw Object.assign(Error('Balance deteriorated between analysis and purchase'),{code:'BALANCE_DETERIORATED'});
 }

 return true;
}
export function assertProposalBinding(request,payload){
 if(!request.candidate)return;
 if(!payload||payload.contract_type!==request.candidate.contractType||String(payload.barrier)!==String(request.candidate.barrier)||payload.underlying_symbol!==request.candidate.market)throw decisionMismatch('proposal',{market:request.candidate.market,type:request.candidate.contractType,barrier:request.candidate.barrier},{market:payload?.underlying_symbol,type:payload?.contract_type,barrier:payload?.barrier});
}
