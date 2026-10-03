export function demoLimits(input={mode:'unlimited'}){
 if(!input||!['unlimited','custom'].includes(input.mode))throw Error('Choose UNLIMITED or CUSTOM demo limits');
 if(input.mode==='unlimited')return {mode:'unlimited'};
 if(!Number.isSafeInteger(input.maxTrades)||input.maxTrades<1)throw Error('Custom daily trade limit must be a positive whole number');
 if(!Number.isFinite(input.maxLoss)||input.maxLoss<=0)throw Error('Custom daily loss limit must be positive');
 return {mode:'custom',maxTrades:input.maxTrades,maxLoss:input.maxLoss};
}
export function demoBudget(journal,c,now,excludeId=null){
 const limits=demoLimits(c.demoLimits),day=new Date(now).toISOString().slice(0,10);
 if(limits.mode==='unlimited')return {mode:'unlimited',allowed:true,reason:null,day};
 const today=journal.filter(o=>o.accountId===c.account.account_id&&o.id!==excludeId&&o.state!=='REJECTED'&&new Date(o.createdAt).toISOString().slice(0,10)===day);
 const loss=today.reduce((n,o)=>n+Math.max(0,-(o.profit??0)),0),count=today.length;
 const reason=count>=limits.maxTrades?'Your custom daily demo trade limit was reached':loss+(c.order?.stake??0)>limits.maxLoss?'Your custom daily demo loss limit would be exceeded':null;
 return {...limits,day,count,loss,allowed:!reason,reason};
}
export function demoStatistics(journal,accountId){
 const trades=journal.filter(o=>o.accountId===accountId&&o.contractId!=null&&o.state!=='REJECTED');
 const settled=trades.filter(o=>o.state==='SETTLED').sort((a,b)=>(a.settledAt??a.createdAt)-(b.settledAt??b.createdAt));
 let wins=0,losses=0,consecutiveWins=0,consecutiveLosses=0,maxConsecutiveWins=0,maxConsecutiveLosses=0,netProfit=0,peak=0,maxDrawdown=0;
 for(const o of settled){
  if(o.result==='won'){wins++;consecutiveWins++;consecutiveLosses=0;}else if(o.result==='lost'){losses++;consecutiveLosses++;consecutiveWins=0;}else{consecutiveWins=0;consecutiveLosses=0;}
  maxConsecutiveWins=Math.max(maxConsecutiveWins,consecutiveWins);maxConsecutiveLosses=Math.max(maxConsecutiveLosses,consecutiveLosses);
  netProfit+=Number.isFinite(o.profit)?o.profit:0;peak=Math.max(peak,netProfit);maxDrawdown=Math.max(maxDrawdown,peak-netProfit);
 }
 return {totalTrades:trades.length,settledTrades:settled.length,wins,losses,winRate:wins+losses?wins/(wins+losses):null,netProfit,riseTrades:trades.filter(o=>o.type==='CALL').length,fallTrades:trades.filter(o=>o.type==='PUT').length,consecutiveWins,consecutiveLosses,maxConsecutiveWins,maxConsecutiveLosses,maxDrawdown,scope:'All retained Rise/Fall broker-confirmed trades for this demo account; drawdown uses realized demo P/L'};
}
