// Explicit fixed demo transport test; shares production purchase locks and settlement engine.
export async function demoTestRoute(req,res,{session,json,readJson,deriv,execution,demoRisk,guardedDemoOrder,riseFall}){
 if(!session)return json(res,401,{error:'Connect your demo account first.'});
 try{
  const b=await readJson(req);if(b.confirm!==true||!/^[-a-zA-Z0-9]{8,100}$/.test(b.attemptId??''))return json(res,400,{error:'Explicit one-trade confirmation required.'});
  const response=await deriv('/trading/v1/options/accounts',session.accessToken,{signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('Could not verify demo account.');
  const a=((await response.json()).data??[]).find(a=>a.account_id===b.accountId&&a.account_type==='demo'&&a.status==='active'&&a.currency==='USD');
  if(!a)return json(res,403,{error:'Select an active USD demo account. Real accounts cannot use this test.'});
  if(session.autoControl?.running)return json(res,409,{error:'Stop Part One Auto before running this test.'});
  if(riseFall.busy(a.account_id))return json(res,409,{error:'Rise/Fall has an active purchase. Stop its Auto and wait for settlement.'});
  const existing=execution.find(a.account_id,b.attemptId);
  if(existing){if(existing.request.decisionId!=='demo-connection-test:'+b.attemptId)return json(res,409,{error:'Attempt belongs to another order.'});return json(res,200,{execution:execution.snapshot(a.account_id)});}
  if(session.demoTestAttempt)return json(res,409,{error:'This login session already submitted a diagnostic. Inspect its result; no replacement purchase was sent.'});
  if(execution.current(a.account_id)||demoRisk.status(a.account_id).pending)return json(res,409,{error:'An order is active or unresolved. Reconcile it before testing.'});
  session.demoTestAttempt=b.attemptId;const generation=session.executionGeneration;
  const request={attemptId:b.attemptId,decisionId:'demo-connection-test:'+b.attemptId,executionSessionId:b.attemptId,type:'DIGITOVER',strategy:'OVER_UNDER',barrier:2,symbol:'R_10',stake:1,currency:'USD',mode:'manual',authorizePurchase:()=>session.expiresAt>Date.now()&&session.executionGeneration===generation&&!session.autoControl?.running&&!riseFall.busy(a.account_id)};
  const flow=await guardedDemoOrder(demoRisk,a.account_id,request,()=>execution.execute({accountId:a.account_id,accountType:'demo',token:session.accessToken},request));
  try{await flow.entry;}catch{/* Broker rejection or uncertainty is shown by the engine snapshot. */}
  return json(res,200,{execution:execution.snapshot(a.account_id)});
 }catch(e){return json(res,400,{error:e.message||'Demo diagnostic failed.'});}
}
