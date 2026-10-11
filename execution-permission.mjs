import {randomUUID} from 'node:crypto';
import {ALL_BARRIERS,eligibility} from './public/decision-brain.js';
export function setAutoEligibility(session,mask){const next=eligibility(mask);if(JSON.stringify(next)!==JSON.stringify(session.autoEligibility??ALL_BARRIERS)){session.autoEligibilityGeneration=(session.autoEligibilityGeneration??0)+1;}session.autoEligibility=next;}
const barrierAllowed=(session,r)=>r.mode!=='auto'||r.strategy==='DIFFER'||(session.autoEligibility??ALL_BARRIERS)[`${r.type==='DIGITOVER'?'OVER':'UNDER'}:${r.barrier}`]===true;
// Volatile permission only: never serialize or restore this object.
export function authEvent(session,event,reason) {
  const previous=session.autoLastEvent?.currentState??'AUTO_OFF';
  const current=session.autoControl?.running?(session.autoControl.suspended?'AUTO_RECOVERING':'AUTO_AUTHORIZED'):'AUTO_OFF';
  session.autoLastEvent={timestamp:Date.now(),event,reason,previousState:previous,currentState:current,generation:session.executionGeneration??0};
  return session.autoLastEvent;
}
export function suspendExecution(session,reason='Trading WebSocket disconnected') {
  session.executionGeneration=(session.executionGeneration??0)+1;
  session.manualIntent=null;
  if(session.autoControl?.running)session.autoControl={...session.autoControl,suspended:true};
  return authEvent(session,'PartOneExecution.disconnect',reason);
}
export function autoAuthorization(session) {
  const c=session.autoControl;
  return {state:c?.running?(c.suspended?'AUTO_RECOVERING':'AUTO_AUTHORIZED'):'AUTO_OFF',runId:c?.runId??null,pageId:session.executionPageId??null,generation:session.executionGeneration??0,lastEvent:session.autoLastEvent??null};
}
export function resetExecution(session,reason='Explicit execution reset / page initialization') {
  session.executionGeneration=(session.executionGeneration??0)+1;
  session.autoControl=null;
  session.autoControlRevision=undefined;
  session.autoEligibilityRevision=undefined;
  session.manualIntent=null;
  session.tradabilityControl=null;
  session.tradabilityPending=false;
  session.tradabilityRevision=undefined;
  session.executionPageId=randomUUID();
  authEvent(session,'resetExecution',reason);
}
export function purchasePermission(session,request,now=Date.now) {
  const generation=session.executionGeneration??0;
  const eligibilityGeneration=session.autoEligibilityGeneration??0;
  const eligibilityChanged=()=>request.mode==='auto'&&request.strategy!=='DIFFER'&&(session.autoEligibilityGeneration??0)!==eligibilityGeneration;
  const started=now();
  const control=session.autoControl;
  const intent=session.manualIntent;
  if(request.mode==='manual')session.manualIntent=null; // one request only
  const allowed=()=>{
    if(!barrierAllowed(session,request))return false;
    if(eligibilityChanged())return false;
    if(!Number.isFinite(session.expiresAt)||session.expiresAt<=now()||(session.executionGeneration??0)!==generation||now()-started>5000)return false;
    if(request.mode==='manual')return !!intent&&intent.id===request.executionSessionId&&intent.attemptId===request.attemptId&&intent.accountId===request.accountId&&intent.type===request.type&&intent.expiresAt>now();
    return request.mode==='auto'&&!!control&&session.autoControl===control&&control.running===true&&!control.suspended&&control.live===true&&control.accountId===request.accountId&&control.runId===request.executionSessionId&&control[request.strategy==='DIFFER'?'differ':'overUnder']===true&&typeof request.decisionId==='string'&&request.decisionId.length>0&&Number.isFinite(request.signalAt)&&request.signalAt>=control.startedAt&&request.signalAt<=now()+1000&&now()-request.signalAt<=5000&&request.gatePassed===true;
  };
  allowed.failureReason=()=>{
    if(!barrierAllowed(session,request))return 'TRADE BLOCKED — BARRIER DISABLED';
    if(eligibilityChanged())return 'TRADE BLOCKED — eligibility changed; fresh decision required';
    if(!Number.isFinite(session.expiresAt)||session.expiresAt<=now())return 'Account session expired; reconnect your account.';
    if((session.executionGeneration??0)!==generation)return 'Execution was reset after this request.';
    if(now()-started>5000)return 'Execution request exceeded its 5-second freshness limit.';
    if(request.mode==='manual')return allowed()?null:'Manual click permission missing, expired, or already used.';
    if(request.mode!=='auto'||!control||session.autoControl!==control||control.running!==true)return 'Auto session stopped or replaced; explicitly start Auto again.';
    if(control.live!==true)return 'Auto session has no active live feed.';
    if(control.suspended)return 'Trading connection lost; positive server reauthorization required.';
    if(control.accountId!==request.accountId||control.runId!==request.executionSessionId)return 'Order account or Auto session does not match the current authorization.';
    if(control[request.strategy==='DIFFER'?'differ':'overUnder']!==true)return 'Requested strategy is disarmed.';
    if(request.gatePassed!==true)return 'Existing strategy condition gate did not pass.';
    if(!Number.isFinite(request.signalAt)||request.signalAt<control.startedAt||request.signalAt>now()+1000||now()-request.signalAt>5000)return 'Signal timestamp is stale or outside server time; check the device clock.';
    return allowed()?null:'Missing signal identifier.';
  };
  allowed.snapshot=()=>({authorization:autoAuthorization(session),market:request.symbol,direction:request.type,barrier:request.barrier,eligibility:session.autoEligibility??ALL_BARRIERS,botState:session.autoControl?.running===true&&!session.autoControl?.suspended,autoTrading:request.mode==='auto'&&session.autoControl?.running===true&&!session.autoControl?.suspended,liveFeed:session.autoControl?.live===true,executionSessionId:request.executionSessionId??null,signalId:request.decisionId??null,generationCurrent:(session.executionGeneration??0)===generation,failureReason:allowed.failureReason()});
  return allowed;
}
