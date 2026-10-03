import {recoverStaleFeed} from './rise-fall-feed-recovery.mjs';
import {loadMarketScan,selectMarket,scanStatus} from './rise-fall-market-selection.mjs';
import {existsSync,readFileSync,writeFileSync,renameSync,mkdirSync,statSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {RiseFallEngine,configuration} from './public/rise-fall/engine.js';
import {availableContracts,proposalRequest,validateProposal,supports} from './public/rise-fall/contracts.js';
import {RpcSocket} from './rise-fall-transport.mjs';
import {observe,executionStatus} from './rise-fall-diagnostics.mjs';
import {brokerBalance} from './public/rise-fall/balance.js';
export const fingerprint=c=>createHash('sha256').update(JSON.stringify(configuration(c))).digest('hex');
export function reduceSettlement(order,c){
 if(String(c.contract_id)!==String(order.contractId))return order;
 const next={...order,entryPrice:order.entryPrice??c.entry_tick??c.entry_spot??null,entryTime:order.entryTime??c.entry_tick_time??c.date_start??null};
 if(c.is_sold===1||c.is_sold===true){if(!['won','lost','sold'].includes(c.status)||c.profit==null||c.profit===''||!Number.isFinite(Number(c.profit)))return {...next,state:'UNKNOWN',error:'Incomplete Deriv settlement'};
  return {...next,state:'SETTLED',result:c.status,profit:Number(c.profit),exitPrice:c.exit_tick??c.exit_spot??null,exitTime:c.exit_tick_time??c.date_expiry??null,settledAt:Date.now()};}
 return next;
}
export class RiseFallService{
 constructor({connect,accounts,file,validationFile,now=Date.now,otherBusy=()=>false}){Object.assign(this,{connect,accounts,file,validationFile,otherBusy,now});this.contexts=new Map();this.preparing=new Set();this.journal=file&&existsSync(file)?JSON.parse(readFileSync(file,'utf8')):[];for(const o of this.journal)if(!['SETTLED','REJECTED'].includes(o.state)){o.state=o.buySent?'UNKNOWN':'REJECTED';o.error='Server restarted; no automatic purchase retry';}}
 save(){if(!this.file)return;mkdirSync(dirname(this.file),{recursive:true});writeFileSync(this.file+'.tmp',JSON.stringify(this.journal,null,2));renameSync(this.file+'.tmp',this.file);}
 busy(accountId){return this.journal.some(o=>o.accountId===accountId&&!['SETTLED','REJECTED'].includes(o.state));}
 replayEvidence(){const stat=statSync(this.validationFile),key=`${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;if(this.replayCache?.key!==key)this.replayCache={key,value:JSON.parse(readFileSync(this.validationFile,'utf8'))};return this.replayCache.value;}
 verifiedDurations(config,symbol){try{const v=this.replayEvidence(),p=v.profiles.find(p=>fingerprint(p.config)===fingerprint(config));return v.results.filter(r=>r.symbol===symbol&&r.profile===p?.name&&r.partition==='validation'&&this.validation(config,symbol,r.duration,r.unit)).map(r=>({duration:r.duration,unit:r.unit}));}catch{return [];}}
 async balance(owner,session,accountId){
  const list=await this.accounts(session),account=list.find(a=>a.account_id===accountId&&a.account_type==='demo'&&a.status==='active');
  if(!account)throw Error('Select a demo options account belonging to your connected Deriv login');
  const ctx=this.contexts.get(owner),shared=ctx?.session===session&&ctx.account.account_id===accountId&&!ctx.rpc.closed;
  const rpc=shared?ctx.rpc:new RpcSocket(await this.connect({token:session.accessToken,accountId,accountType:'demo'}));
  try{return {...brokerBalance(await rpc.request({balance:1}),account),updatedAt:this.now()};}finally{if(!shared)rpc.close();}
 }
 validation(config,symbol=null,duration=null,unit=null){try{const v=this.replayEvidence(),profile=v.profiles.find(p=>fingerprint(p.config)===fingerprint(config));return v.realData===true&&v.replayCompleted===true&&!!profile&&v.symbols.length>=2&&v.validationTicks>=2000&&(!symbol||v.results.some(r=>r.symbol===symbol&&r.profile===profile.name&&r.partition==='validation'&&(duration===null||r.duration===duration&&r.unit===unit)));}catch{return false;}}
 async prepare(owner,session,body){
  if(this.preparing.has(owner))throw Error('Connection setup in progress');this.preparing.add(owner);
  try{
   this.stop(owner);const prev=this.contexts.get(owner);if(prev?.pending)throw Error('Purchase confirmation is in progress');prev?.rpc.close();
   const list=await this.accounts(session),account=list.find(a=>a.account_id===body.accountId&&a.account_type==='demo'&&a.status==='active');if(!account)throw Error('Choose an authenticated demo account. Rise/Fall real trading is disabled.');
   const cfg=configuration(body.config),symbol=body.symbol;if(!/^[A-Za-z0-9_]{2,30}$/.test(symbol??''))throw Error('Invalid symbol');
   const rpc=new RpcSocket(await this.connect({token:session.accessToken,accountId:account.account_id,accountType:'demo'}));
   const ctx={id:randomUUID(),owner,session,account,symbol,autoSelect:body.autoSelect===true,scanDuration:body.duration,scanUnit:body.unit,config:cfg,engine:new RiseFallEngine(symbol,cfg).enableTrace(),rpc,running:false,heartbeat:0,used:new Set(),pending:false,contracts:[],error:null};
   this.contexts.set(owner,ctx);
   rpc.listeners.add(d=>{if(d.disconnected){ctx.feedHealth={...ctx.feedHealth,state:'closed'};ctx.running=false;ctx.error='Connection lost; reconnect to monitor and restart explicitly';for(const o of this.journal)if(o.accountId===account.account_id&&o.buySent&&!['SETTLED','REJECTED'].includes(o.state)){o.state='UNKNOWN';o.error='Trading connection lost; reconnect for contract reconciliation';}this.save();}
    if(d.error){ctx.error='Broker subscription: '+d.error.message;ctx.feedHealth={...ctx.feedHealth,error:ctx.error};}
    if(d.tick&&ctx.autoSelect&&d.tick.symbol!==ctx.symbol){const row=ctx.marketScan?.rows.get(d.tick.symbol);if(row?.engine&&row.engine.add(d.tick)){const at=this.now()+(ctx.clockOffset??0);row.feedHealth={...row.feedHealth,state:'live',error:null,subscriptionId:d.subscription?.id??row.feedHealth?.subscriptionId,subscribed:!!d.subscription?.id||row.feedHealth?.subscribed,lastReceivedAt:at,lastAcceptedAt:at,lastAcceptedSequence:row.engine.sequence};void this.maybeExecute(ctx);}}
    if(d.tick?.symbol===ctx.symbol){const receivedAt=this.now()+(ctx.clockOffset??0);ctx.feedHealth={...ctx.feedHealth,state:'live',error:null,subscriptionId:d.subscription?.id??ctx.feedHealth?.subscriptionId,subscribed:!!d.subscription?.id||!!ctx.feedHealth?.subscribed,lastReceivedAt:receivedAt};if(ctx.engine.add(d.tick)){ctx.feedHealth.lastAcceptedAt=receivedAt;ctx.feedHealth.lastAcceptedSequence=ctx.engine.sequence;const row=ctx.marketScan?.rows.get(ctx.symbol);if(row)row.feedHealth=ctx.feedHealth;ctx.analysis=ctx.engine.snapshot(receivedAt);observe(this,ctx,ctx.analysis);void this.maybeExecute(ctx);}}
    if(d.proposal_open_contract){const o=this.journal.find(o=>o.accountId===account.account_id&&String(o.contractId)===String(d.proposal_open_contract.contract_id));if(o&&o.state!=='SETTLED'){Object.assign(o,reduceSettlement(o,d.proposal_open_contract));this.save();}}
   });
   const [meta,h,time]=await Promise.all([rpc.request({contracts_for:symbol}),rpc.request({ticks_history:symbol,count:1500,end:'latest',style:'ticks'}),rpc.request({time:1})]);
   if(!Number.isFinite(time.time))throw Error('Deriv clock verification failed');ctx.clockOffset=time.time*1000-this.now();ctx.feedHealth={state:'subscribing',subscribed:false,startedAt:time.time*1000};
   ctx.contracts=availableContracts(meta.contracts_for,symbol);ctx.contractsAt=this.now();
   if(!ctx.contracts.length)throw Error('No Rise/Fall contracts returned for this symbol');
   h.history?.prices.forEach((quote,i)=>ctx.engine.add({quote,epoch:h.history.times[i],symbol}));
   const subscription=await rpc.request({ticks:symbol,subscribe:1});ctx.feedHealth.subscriptionId=subscription.subscription?.id;ctx.feedHealth.subscribed=!!subscription.subscription?.id;ctx.feedHealth.state=ctx.feedHealth.subscribed?'live':'unconfirmed';ctx.analysis=ctx.engine.snapshot(this.now()+ctx.clockOffset);
   // Restore known contracts without issuing another purchase.
   for(const o of this.journal.filter(o=>o.accountId===account.account_id&&['OPEN','UNKNOWN'].includes(o.state)&&o.contractId))await this.monitor(ctx,o);
   if(ctx.autoSelect)ctx.scanTask=loadMarketScan(this,ctx);
   return this.status(owner);
  }catch(e){const ctx=this.contexts.get(owner);if(ctx){ctx.running=false;ctx.error=e.message;ctx.rpc.close();}throw e;}finally{this.preparing.delete(owner);}
 }
 status(owner){
  const c=this.contexts.get(owner);if(!c)return {connected:false,running:false,realEnabled:false,orders:[],execution:executionStatus(this,null,null,this.now())};
  if(c.running&&(this.now()-c.heartbeat>20000||c.session.expiresAt<=this.now())){c.error=c.session.expiresAt<=this.now()?'Authentication expired; reconnect the demo account':'Auto authorization heartbeat expired; explicitly restart Auto';c.running=false;}
  void recoverStaleFeed(this,c);
  const analysis=c.engine.snapshot(this.now()+(c.clockOffset??0)),diagnostic=observe(this,c,analysis);
  return {connected:!c.rpc.closed,sessionId:c.id,running:c.running,realEnabled:false,demoReplayVerified:this.validation(c.config,c.symbol),verifiedDurations:this.verifiedDurations(c.config,c.symbol),autoSelect:!!c.autoSelect,marketScan:scanStatus(this,c),symbol:c.symbol,accountId:c.account.account_id,currency:c.account.currency,analysis,contracts:c.contracts,error:c.error,orders:this.journal.filter(o=>o.accountId===c.account.account_id).slice(-100),blocked:this.busy(c.account.account_id),...diagnostic};
 }
 diagnostics(owner){const c=this.contexts.get(owner);return c?{...c.diagnosticLog?.export(),tickTrace:c.engine.tickTrace??[],receivedTicks:c.engine.received,rejectedTicks:c.engine.rejectedTicks,marketFeeds:[...(c.marketScan?.rows.values()??[])].map(r=>({symbol:r.symbol,lastTick:r.engine?.history.at(-1)?.epoch,health:r.feedHealth,error:r.error}))}:{records:[],totalCandidates:0,scope:'No diagnostic session recorded'};}

 start(owner,body){const c=this.contexts.get(owner);if(!c||c.id!==body.sessionId||c.rpc.closed||c.session.expiresAt<=this.now())throw Error('Connect the current demo session first');if(c.autoSelect&&(c.marketScan?.loading||c.marketScan?.error))throw Error(c.marketScan?.error||'Market scan is still loading');
  const scanDuration=c.autoSelect&&[...c.marketScan.rows.values()].some(r=>r.verifiedDurations.some(d=>d.duration===body.duration&&d.unit===body.unit)&&['CALL','PUT'].every(t=>supports(r.contracts,t,body.duration,body.unit))&&!r.error&&r.feedHealth?.subscribed);
  if(c.autoSelect?!scanDuration:!this.validation(c.config,c.symbol,body.duration,body.unit))throw Error('Historical replay must be completed for this symbol, duration and settings before Auto is enabled');
  if(!Number.isFinite(body.stake)||body.stake<=0||body.stake>50)throw Error('Demo verification stake must be between 0 and 50');
  if(!c.autoSelect&&!['CALL','PUT'].every(t=>supports(c.contracts,t,body.duration,body.unit)))throw Error('Select a Deriv-supported duration for both Rise and Fall');
  if(this.busy(c.account.account_id)||this.otherBusy(c.account.account_id))throw Error('Account has an unresolved contract');
  for(const other of this.contexts.values())if(other!==c&&other.account.account_id===c.account.account_id)this.stop(other.owner);
  c.order={stake:body.stake,duration:body.duration,unit:body.unit};c.runId=randomUUID();c.running=true;c.heartbeat=this.now();c.error=null;return this.status(owner);
 }
 stop(owner){const c=this.contexts.get(owner);if(c){c.running=false;c.runId=null;}return {running:false};}
 heartbeat(owner,body){const c=this.contexts.get(owner);if(!c||c.id!==body.sessionId||!c.running||c.rpc.closed||c.session.expiresAt<=this.now())throw Error('Auto is stopped; start explicitly');c.heartbeat=this.now();return {running:true};}
 purchaseBlockers(c,signalId,type,run){
  const now=this.now(),a=c.engine.snapshot(now+(c.clockOffset??0)),reasons=[];
  if(!c.running)reasons.push('Demo Auto is stopped');
  if(c.runId!==run)reasons.push('Auto session changed during proposal');
  if(c.session.expiresAt<=now)reasons.push('Demo authentication expired');
  if(now-c.heartbeat>20000)reasons.push(`Auto heartbeat expired (${Math.floor((now-c.heartbeat)/1000)} seconds old)`);
  if(c.rpc.closed)reasons.push('Broker connection closed');
  if(c.feedHealth?.recovering)reasons.push('Tick subscription recovery in progress');
  const age=now+(c.clockOffset??0)-(a.epoch??0)*1000;
  if(!a.epoch||age>c.config.staleMs||age < -2000)reasons.push(`Market feed stale or clock invalid (last tick ${Math.max(0,age/1000).toFixed(1)} seconds ago)`);
  if(a.signalId!==signalId)reasons.push('Qualifying signal episode changed during proposal');
  if(a.winner?.type!==type)reasons.push('Setup no longer qualifies: '+((a.candidates??[]).find(x=>x.type===type)?.blocked??['direction changed']).join(', '));
  if(!this.validation(c.config,c.symbol,c.order.duration,c.order.unit))reasons.push('Replay verification no longer matches market, duration or settings');
  return reasons;
 }
 authorized(c,signalId,type,run){return this.purchaseBlockers(c,signalId,type,run).length===0;}
 async maybeExecute(c){
  if(c.pending||!c.running)return;if(!c.autoSelect&&(c.feedHealth?.recovering||c.feedHealth?.state==='awaiting-live'))return;if(c.session.expiresAt<=this.now()||this.now()-c.heartbeat>20000){c.running=false;return;}
  if(!selectMarket(this,c))return;
  const a=c.engine.snapshot(this.now()+(c.clockOffset??0)),id=c.account.account_id;if(!a.winner||c.used.has(a.signalId)||this.busy(id)||this.otherBusy(id))return;
  c.pending=true;c.used.add(a.signalId);const run=c.runId;
  const o={id:randomUUID(),signalId:a.signalId,accountId:id,accountType:'demo',symbol:c.symbol,type:a.winner.type,state:'PROPOSAL',createdAt:this.now(),confidence:a.winner.confidence,marketState:a.marketState,evidence:{checks:a.winner.checks,efficiency:a.efficiency,chop:a.chop,trendStrength:a.trendStrength,epoch:a.epoch,configFingerprint:fingerprint(c.config)},...c.order};this.journal.push(o);
  try{
   this.save();const day=new Date(this.now()).toISOString().slice(0,10),today=this.journal.filter(x=>x.accountId===id&&new Date(x.createdAt).toISOString().startsWith(day)&&x.state!=='REJECTED');
   if(today.length>100||today.reduce((n,x)=>n+Math.max(0,-(x.profit??0)),0)+o.stake>100)throw Error('Demo verification daily trade/loss budget reached');
   if(this.now()-c.contractsAt>60000){c.contracts=availableContracts((await c.rpc.request({contracts_for:c.symbol})).contracts_for,c.symbol);c.contractsAt=this.now();}
   const request=proposalRequest({...o,currency:c.account.currency},c.contracts),at=this.now();
   const response=await c.rpc.request(request);const buy=validateProposal(response,request,this.now(),at);o.proposalRequest=request;o.proposalReceivedAt=this.now();o.payout=Number(response.proposal.payout);
   const blockers=this.purchaseBlockers(c,a.signalId,o.type,run);if(this.otherBusy(id))blockers.push('Part One account lock changed before purchase');if(blockers.length){o.rejectionReasons=blockers;throw Error('Purchase cancelled: '+blockers.join(' · '));}
   o.buySent=true;o.state='BUY_PENDING';o.proposalId=buy.buy;o.buySubmittedAt=this.now();this.save();
   const d=await c.rpc.request(buy);if(!Number.isSafeInteger(Number(d.buy?.contract_id))||Number(d.buy.contract_id)<=0)throw Error('Purchase confirmation missing; reconcile before retry');
   o.contractId=d.buy.contract_id;o.buyPrice=Number(d.buy.buy_price);o.state='OPEN';c.error=null;o.buyConfirmedAt=this.now();this.save();await this.monitor(c,o);
  }catch(e){if(o.state!=='SETTLED'){o.state=o.buySent?'UNKNOWN':'REJECTED';o.error=e.message;this.save();}c.error=e.message;if(o.buySent)c.running=false;}finally{c.pending=false;}
 }
 async monitor(c,o){const response=await c.rpc.request({proposal_open_contract:1,contract_id:o.contractId,subscribe:1});if(response.proposal_open_contract){Object.assign(o,reduceSettlement(o,response.proposal_open_contract));this.save();}}
 async refresh(owner){const c=this.contexts.get(owner);if(!c||c.rpc.closed||c.refreshing||this.now()-(c.lastRefresh??0)<15000)return;c.refreshing=true;c.lastRefresh=this.now();try{for(const o of this.journal.filter(o=>o.accountId===c.account.account_id&&o.contractId&&!['SETTLED','REJECTED'].includes(o.state))){const d=await c.rpc.request({proposal_open_contract:1,contract_id:o.contractId});if(d.proposal_open_contract){Object.assign(o,reduceSettlement(o,d.proposal_open_contract));this.save();}}}catch(e){c.error='Contract reconciliation: '+e.message;c.running=false;}finally{c.refreshing=false;}}
}
export function riseFallRoutes(service,{getSession,cookieValue,json,readJson}){return async(req,res,url)=>{
 if(!url.pathname.startsWith('/api/rise-fall/'))return false;const session=getSession(req);if(!session){json(res,401,{error:'Connect your Deriv account first'});return true;}const owner=cookieValue(req,'deriv_session');
 try{if(req.method==='GET'&&url.pathname==='/api/rise-fall/diagnostics'){json(res,200,service.diagnostics(owner));return true;}
  if(req.method==='GET'&&url.pathname==='/api/rise-fall/balance'){json(res,200,await service.balance(owner,session,url.searchParams.get('accountId')));return true;}
  if(req.method==='GET'&&url.pathname==='/api/rise-fall/status'){await service.refresh(owner);json(res,200,service.status(owner));return true;}
  if(req.method!=='POST')throw Error('Unsupported request');if(req.headers.origin&&!['http://'+req.headers.host,'https://'+req.headers.host].includes(req.headers.origin))throw Error('Invalid request origin');const body=await readJson(req);let result;
  switch(url.pathname){case '/api/rise-fall/connect':result=await service.prepare(owner,session,body);break;case '/api/rise-fall/start':result=service.start(owner,body);break;case '/api/rise-fall/stop':result=service.stop(owner);break;case '/api/rise-fall/heartbeat':result=service.heartbeat(owner,body);break;default:throw Error('Unknown route');}json(res,200,result);
 }catch(e){json(res,409,{error:e.message});}return true;
};}
