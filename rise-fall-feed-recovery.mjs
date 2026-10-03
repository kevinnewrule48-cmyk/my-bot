// Repairs tick subscriptions only. Never reconnects trading authority or sends orders.
export function recoverStaleFeed(service,c){
 if(c.feedRecovery||c.rpc.closed||c.pending||service.busy(c.account.account_id)||service.otherBusy(c.account.account_id)||c.marketScan?.loading)return;
 const now=service.now()+(c.clockOffset??0);
 const rows=c.autoSelect?[...(c.marketScan?.rows.values()??[])]:[{symbol:c.symbol,engine:c.engine,feedHealth:c.feedHealth}];
 const row=rows.find(r=>r.engine&&r.feedHealth&&!r.feedHealth.recovering&&
  now-(r.engine.history?.at(-1)?.epoch??now/1000)*1000>c.config.staleMs&&
  now-(r.feedHealth.lastRecoveryAt??0)>=30000&&(r.feedHealth.recoveryAttempts??0)<3);
 if(!row)return;
 const engine=row.engine;
 const health=()=>row.feedHealth;
 const update=patch=>{row.feedHealth={...health(),...patch};if(c.engine===engine)c.feedHealth=row.feedHealth;};
 update({recovering:true,state:'recovering',lastRecoveryAt:now,recoveryAttempts:(health().recoveryAttempts??0)+1,error:'Feed stalled; refreshing tick subscription'});
 c.feedRecovery=(async()=>{
  try{
   if(health().subscriptionId)await c.rpc.request({forget:health().subscriptionId});
   const h=await c.rpc.request({ticks_history:row.symbol,count:1500,end:'latest',style:'ticks'});
   if(service.contexts.get(c.owner)!==c||c.rpc.closed)return;
   // Keep episode identity and history; historical backfill never invokes execution.
   (h.history?.prices??[]).forEach((quote,i)=>engine.add({symbol:row.symbol,quote,epoch:h.history.times[i]}));
   const sub=await c.rpc.request({ticks:row.symbol,subscribe:1});
   if(!sub.subscription?.id)throw Error('Replacement tick subscription not confirmed');
   row.error=null;update({subscriptionId:sub.subscription.id,lastAcceptedSequence:engine.sequence,subscribed:true,state:'awaiting-live',error:'Subscription refreshed; waiting for a fresh live tick'});
  }catch(e){update({subscribed:false,state:'failed',error:'Feed recovery failed: '+e.message+'; reconnect analysis if this persists'});}
  finally{update({recovering:false});c.feedRecovery=null;}
 })();
 return c.feedRecovery;
}
