import {randomUUID} from 'node:crypto';
// Volatile permission only: never serialize or restore this object.
export function resetExecution(session) {
  session.executionGeneration=(session.executionGeneration??0)+1;
  session.autoControl=null;
  session.manualIntent=null;
  session.executionPageId=randomUUID();
}
export function purchasePermission(session,request,now=Date.now) {
  const generation=session.executionGeneration??0;
  const started=now();
  const control=session.autoControl;
  const intent=session.manualIntent;
  if(request.mode==='manual')session.manualIntent=null; // one request only
  const allowed=()=>{
    if(!Number.isFinite(session.expiresAt)||session.expiresAt<=now()||(session.executionGeneration??0)!==generation||now()-started>5000)return false;
    if(request.mode==='manual')return !!intent&&intent.id===request.executionSessionId&&intent.attemptId===request.attemptId&&intent.accountId===request.accountId&&intent.type===request.type&&intent.expiresAt>now();
    return request.mode==='auto'&&!!control&&session.autoControl===control&&control.running===true&&control.live===true&&control.accountId===request.accountId&&control.runId===request.executionSessionId&&control[request.strategy==='DIFFER'?'differ':'overUnder']===true&&typeof request.decisionId==='string'&&request.decisionId.length>0&&Number.isFinite(request.signalAt)&&request.signalAt>=control.startedAt&&request.signalAt<=now()+1000&&now()-request.signalAt<=5000&&request.gatePassed===true;
  };
  allowed.snapshot=()=>({botState:session.autoControl?.running===true,autoTrading:request.mode==='auto'&&session.autoControl?.running===true,liveFeed:session.autoControl?.live===true,executionSessionId:request.executionSessionId??null,signalId:request.decisionId??null,generationCurrent:(session.executionGeneration??0)===generation});
  return allowed;
}
