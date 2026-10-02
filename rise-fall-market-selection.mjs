import {RiseFallEngine} from './public/rise-fall/engine.js';
import {availableContracts,supports} from './public/rise-fall/contracts.js';
import {scanMarkets} from './public/rise-fall/market-selection.js';
import {rankMarkets} from './public/rise-fall/scanner.js';

export async function loadMarketScan(service,c){
 c.marketScan={loading:true,rows:new Map(),total:0,error:null};
 const scan=c.marketScan,current=()=>service.contexts.get(c.owner)===c&&!c.rpc.closed;
 try{
  const data=await c.rpc.request({active_symbols:'brief'});
  const markets=scanMarkets(data.active_symbols??[]);scan.total=markets.length;
  if(!markets.length)throw Error('No active Volatility, Jump or Step markets returned');
  for(const m of markets){
   if(!current())return;
   const row={...m,contracts:[],verifiedDurations:[],error:null};scan.rows.set(m.symbol,row);
   try{
    if(m.symbol===c.symbol){Object.assign(row,{engine:c.engine,contracts:c.contracts,contractsAt:c.contractsAt,feedHealth:c.feedHealth});}
    else{
     row.contracts=availableContracts((await c.rpc.request({contracts_for:m.symbol})).contracts_for,m.symbol);row.contractsAt=service.now();
     if(!row.contracts.length)continue;
     const h=await c.rpc.request({ticks_history:m.symbol,count:1500,end:'latest',style:'ticks'});
     row.engine=new RiseFallEngine(m.symbol,c.config).enableTrace();
     (h.history?.prices??[]).forEach((quote,i)=>row.engine.add({quote,epoch:h.history.times[i],symbol:m.symbol}));
     row.feedHealth={state:'subscribing',subscribed:false,startedAt:service.now()+(c.clockOffset??0)};
     const sub=await c.rpc.request({ticks:m.symbol,subscribe:1});
     if(!sub.subscription?.id)throw Error('Tick subscription not confirmed');
     row.feedHealth.subscribed=true;row.feedHealth.state='live';
    }
    row.verifiedDurations=service.verifiedDurations(c.config,m.symbol);
   }catch(e){row.error=e.message;}
  }
 }catch(e){scan.error=e.message;}finally{scan.loading=false;}
}

export function rankedScan(service,c,duration=c.order?.duration??c.scanDuration,unit=c.order?.unit??c.scanUnit){
 return rankMarkets([...(c.marketScan?.rows.values()??[])],c.config,duration,unit,service.now()+(c.clockOffset??0)).map(r=>{
  const verified=r.verifiedDurations.some(d=>d.duration===duration&&d.unit===unit);
  const consumed=!!r.analysis?.signalId&&c.used.has(r.analysis.signalId);
  const healthy=!!r.feedHealth?.subscribed&&!r.error;
  const both=['CALL','PUT'].every(t=>supports(r.contracts,t,duration,unit));
  return {...r,eligible:r.eligible&&verified&&healthy&&both&&!consumed,reason:r.error||(!healthy?'Live subscription unavailable':!both?'Selected duration unavailable':!verified?'Replay not verified for this duration':consumed?'Waiting for a new signal episode':r.reason)};
 }).sort((a,b)=>Number(b.eligible)-Number(a.eligible)||(b.candidate?.confidence??-1)-(a.candidate?.confidence??-1)||a.name.localeCompare(b.name));
}

export function selectMarket(service,c){
 if(!c.autoSelect)return true;
 if(c.marketScan?.loading||c.marketScan?.error||c.pending||service.busy(c.account.account_id)||service.otherBusy(c.account.account_id))return false;
 const best=rankedScan(service,c).find(r=>r.eligible);
 if(!best)return false;
 if(c.symbol!==best.symbol){
  c.symbol=best.symbol;c.engine=best.engine;c.contracts=best.contracts;c.contractsAt=best.contractsAt;c.feedHealth=best.feedHealth;
  c.diagnosticLog=null;c.analysis=best.analysis;c.selection={symbol:best.symbol,name:best.name,confidence:best.candidate.confidence,at:service.now()};
 }
 return true;
}

export function scanStatus(service,c){
 if(!c.autoSelect)return null;
 const scan=c.marketScan;
 return {loading:scan?.loading??true,total:scan?.total??0,checked:scan?.rows.size??0,error:scan?.error??null,selection:c.selection??null,
  rows:rankedScan(service,c).map(r=>({symbol:r.symbol,name:r.name,eligible:r.eligible,reason:r.reason,available:!!r.contracts.length,checked:true,verifiedDurations:r.verifiedDurations,analysis:{marketState:r.analysis?.marketState},candidate:r.candidate}))};
}
