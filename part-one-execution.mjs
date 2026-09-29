// Existing Part One execution transport, isolated from all signal/strategy calculations.
import {existsSync,readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';import {createHash,randomUUID} from 'node:crypto';
import {proposalRequest,validateProposal,extractLastDigit} from './public/digit-barrier-engine.js';
const terminal=a=>['SETTLED','REJECTED'].includes(a.state);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});promise.catch(()=>{});return {promise,resolve,reject};};
const safe=x=>{if(!x||typeof x!=='object')return x;if(Array.isArray(x))return x.map(safe);return Object.fromEntries(Object.entries(x).filter(([k])=>!/(token|authorize|otp|password|secret)/i.test(k)).map(([k,v])=>[k,typeof v==='object'?safe(v):v]));};
export class PartOneExecution {
 constructor({connect,file=null,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout,onTick=()=>{},onSettled=()=>{},onRejected=()=>{},log=()=>{},timeouts={}}){
  Object.assign(this,{connect,file,now,setTimer,clearTimer,onTick,onSettled,onRejected,log});
  this.timeouts={PROPOSAL_PENDING:8000,BUY_PENDING:10000,CONTRACT_PENDING:15000,SETTLEMENT_PENDING:15000,RECONCILING:10000,...timeouts};
  this.data=file&&existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{accounts:{},requestSequence:0};
  this.channels=new Map();this.connecting=new Map();this.credentials=new Map();this.flows=new Map();this.timers=new Map();this.recovering=new Set();
  // Never replay a BUY on restart. Durable intent may or may not have reached Deriv.
  for(const account of Object.values(this.data.accounts))for(const a of account.attempts)if(!terminal(a)){a.state=a.buySent?'RECONCILIATION_REQUIRED':'REJECTED';a.error={code:'PROCESS_RESTART',message:a.buySent?'Purchase outcome requires reconciliation':'Restarted before any BUY was sent'};a.blocking=!!a.buySent;}
 }
 key(id){return createHash('sha256').update(String(id)).digest('hex');}
 account(id){const key=this.key(id);return this.data.accounts[key]??={sequence:0,attempts:[],events:[],seen:[]};}
 save(){if(this.file){mkdirSync(dirname(this.file),{recursive:true});writeFileSync(this.file+'.tmp',JSON.stringify(this.data));renameSync(this.file+'.tmp',this.file);}}
 event(id,a,stage,details={}){const account=this.account(id);const e={timestamp:this.now(),attemptId:a?.attemptId??null,tradeNumber:a?.number??null,state:a?.state??null,symbol:a?.request.symbol??null,contractType:a?.request.type??null,barrier:a?.request.type==='DIGITOVER'?'1':a?'8':null,stake:a?.request.stake??null,proposalId:a?.proposalId??null,contractId:a?.contractId??null,stage,...safe(details)};account.events.push(e);if(account.events.length>1000)account.events.shift();this.save();this.log(e);return e;}
 state(id,a,state,detail={}){a.state=state;a.stageAt=this.now();a.blocking=!terminal(a);this.event(id,a,state,detail);}
 current(id){return this.account(id).attempts.find(a=>!terminal(a))??null;}
 find(id,attemptId){return this.account(id).attempts.find(a=>a.attemptId===attemptId);}
 flow(id,a){const key=this.key(id)+':'+a.attemptId;if(!this.flows.has(key)){const entry=deferred(),settlement=deferred();this.flows.set(key,{entry,settlement});if(a.entry)entry.resolve(a.entry);if(a.result&&a.state==='SETTLED')settlement.resolve(a.result);if(a.state==='REJECTED'){const e=Object.assign(Error(a.error.message),{...a.error,orderNotSubmitted:true,attemptId:a.attemptId});entry.reject(e);settlement.reject(e);}}const f=this.flows.get(key);return {entry:f.entry.promise,settlement:f.settlement.promise,attemptId:a.attemptId};}
 callbacks(id,a){this.flow(id,a);return this.flows.get(this.key(id)+':'+a.attemptId);}
 cancelTimer(a){if(this.timers.has(a.attemptId))this.clearTimer(this.timers.get(a.attemptId));this.timers.delete(a.attemptId);}
 watch(id,a,state){this.cancelTimer(a);const timer=this.setTimer(()=>{this.timers.delete(a.attemptId);if(terminal(a))return;this.event(id,a,'WATCHDOG_TIMEOUT',{waitingStage:state,waitedMs:this.now()-a.stageAt});if(!a.buySent)this.reject(id,a,{code:'PROPOSAL_TIMEOUT',message:'Proposal response timed out before BUY'});else{this.unresolved(id,a,{code:state+'_TIMEOUT',message:'Purchase/settlement not yet confirmed; no replacement BUY will be sent'});void this.reconcile(this.credentials.get(this.key(id)),a).catch(e=>this.event(id,a,'RECONCILE_ERROR',{error:{code:e.code,message:e.message}}));}},this.timeouts[state]??10000);timer?.unref?.();this.timers.set(a.attemptId,timer);}
 async channel(credentials){
  const {accountId:id}=credentials,key=this.key(id);this.credentials.set(key,credentials);
  if(this.channels.get(key)?.ws.readyState===1)return this.channels.get(key);
  if(this.connecting.has(key))return this.connecting.get(key);
  const promise=(async()=>{const ws=await this.connect(credentials),ch={ws,requests:new Map(),warm:new Map(),warmConfig:null,tickSymbols:new Set(),latestTicks:new Map()};this.channels.set(key,ch);
   ws.addEventListener('message',e=>{try{this.receive(id,ch,JSON.parse(e.data));}catch(error){const a=this.current(id);this.event(id,a,'HANDLER_ERROR',{error:{code:error.code??'HANDLER',message:error.message}});if(a)this.unresolved(id,a,{code:'HANDLER_ERROR',message:error.message});}});
   let closed=false;const disconnect=()=>{if(closed||this.channels.get(key)!==ch)return;closed=true;if(this.channels.get(key)===ch)this.channels.delete(key);ch.warm.clear();if(ws.readyState===1)ws.close();this.event(id,this.current(id),'SOCKET_DISCONNECTED');const a=this.current(id);if(!a)return;if(!a.buySent)this.reject(id,a,{code:'DISCONNECTED_BEFORE_BUY',message:'Connection lost before BUY; no purchase sent'});else{this.unresolved(id,a,{code:'DISCONNECTED_AFTER_BUY',message:'Connection lost after BUY; reconciling without buying again'});void this.reconcile(credentials,a).catch(e=>this.event(id,a,'RECONNECT_ERROR',{error:{code:e.code,message:e.message}}));}};
   ws.addEventListener('close',disconnect);ws.addEventListener('error',disconnect);this.event(id,this.current(id),'SOCKET_CONNECTED');return ch;
  })();this.connecting.set(key,promise);try{return await promise;}finally{this.connecting.delete(key);}
 }
 send(id,ch,payload,meta={}){const req_id=++this.data.requestSequence;this.save();ch.requests.set(req_id,{...meta,payload,req_id});if(ch.requests.size>500){for(const [key,m] of ch.requests)if(!m.subscribe&&m.kind!=='buy'){ch.requests.delete(key);break;}}
  const a=meta.attemptId?this.find(id,meta.attemptId):null;this.event(id,a,'REQUEST_PREPARED',{kind:meta.kind,req_id,echo_req:{...payload,req_id}});ch.ws.send(JSON.stringify({...payload,req_id}));this.event(id,a,'REQUEST_SENT',{kind:meta.kind,req_id});return req_id;}
 forget(id,ch,subscription){if(subscription&&ch.ws.readyState===1)this.send(id,ch,{forget:subscription},{kind:'forget'});}
 cleanup(id,a){const ch=this.channels.get(this.key(id));if(ch)for(const [key,m] of ch.requests)if(m.attemptId===a.attemptId){this.forget(id,ch,m.subscription);ch.requests.delete(key);}this.cancelTimer(a);}
 reject(id,a,error){if(terminal(a))return;a.error=safe(error);a.blocking=false;this.state(id,a,'REJECTED',{error});this.cleanup(id,a);const e=Object.assign(Error(error.message),{...error,orderNotSubmitted:true,attemptId:a.attemptId});const f=this.callbacks(id,a);f.entry.reject(e);f.settlement.reject(e);this.onRejected(id,a);this.event(id,a,'STATE_RESET',{execution:'IDLE',outcome:'NOT_PURCHASED'});}
 unresolved(id,a,error){if(terminal(a))return;this.cancelTimer(a);a.error=safe(error);this.state(id,a,'RECONCILIATION_REQUIRED',{error});if(!a.entry)this.callbacks(id,a).entry.reject(Object.assign(Error(error.message),{...error,attemptId:a.attemptId,uncertain:true}));}
 async prepare(credentials,request){const id=credentials.accountId,ch=await this.channel(credentials);this.ticks(id,ch,request.symbol);const a=this.current(id);if(a){if(a.buySent)await this.reconcile(credentials,a);return {ready:false,state:a.state};}
  const key=[request.symbol,request.stake,request.currency].join(':');if(ch.warmConfig!==key){for(const [req,m] of ch.requests)if(m.kind==='warm'){this.forget(id,ch,m.subscription);ch.requests.delete(req);}ch.warm.clear();ch.warmConfig=key;
   for(const type of ['DIGITOVER','DIGITUNDER'])this.send(id,ch,{...proposalRequest({...request,type}),subscribe:1},{kind:'warm',subscribe:true,key:type});}
  return {ready:true,warmed:true};}
 ticks(id,ch,symbol){if(!/^[A-Za-z0-9_]{2,30}$/.test(symbol??'')||ch.tickSymbols.has(symbol))return;ch.tickSymbols.add(symbol);this.send(id,ch,{ticks:symbol,subscribe:1},{kind:'ticks',subscribe:true,symbol});}
 execute(credentials,request){const id=credentials.accountId;this.credentials.set(this.key(id),credentials);const attemptId=request.attemptId||randomUUID(),previous=this.find(id,attemptId);if(previous)return this.flow(id,previous);
  const account=this.account(id);if(account.seen.includes(attemptId))throw Error('Attempt already completed and archived; it will not be purchased again');if(this.current(id))throw Object.assign(Error('Execution is already active or requires reconciliation'),{code:'EXECUTION_BUSY'});if(account.seen.length>=10000)throw Error('Execution journal capacity reached; archive requires review');
  const a={attemptId,number:++account.sequence,request:{type:request.type,symbol:request.symbol,stake:request.stake,currency:request.currency,mode:request.mode??'manual',accountType:credentials.accountType,decisionId:request.decisionId??null},state:'SIGNAL_READY',startedAt:this.now(),stageAt:this.now(),buySent:false,blocking:true,reconcileCount:0};account.attempts.push(a);account.seen.push(attemptId);while(account.attempts.length>50&&terminal(account.attempts[0])){const old=account.attempts.shift();this.flows.delete(this.key(id)+':'+old.attemptId);}this.save();this.event(id,a,'TRADE_AUTHORIZED',{source:'server account and risk checks',strategyEvidence:request.strategyEvidence??null});const flow=this.flow(id,a);
  void this.begin(credentials,a).catch(error=>{if(!a.buySent)this.reject(id,a,{code:error.code??'PRE_BUY_ERROR',message:error.message});else this.unresolved(id,a,{code:error.code??'POST_BUY_ERROR',message:error.message});});return flow;
 }
 async begin(credentials,a){const id=credentials.accountId,ch=await this.channel(credentials);if(terminal(a))return;this.ticks(id,ch,a.request.symbol);
  const warm=ch.warm.get(a.request.type);ch.warm.delete(a.request.type);
  if(warm&&this.now()-warm.at<=5000&&warm.config===[a.request.symbol,a.request.stake,a.request.currency].join(':')){this.event(id,a,'PROPOSAL_RESPONSE_RECEIVED',{cached:true,ageMs:this.now()-warm.at});this.proposal(id,ch,a,warm.proposal);}
  else{if(warm)this.event(id,a,'STALE_PROPOSAL_IGNORED');this.state(id,a,'PROPOSAL_PENDING');this.watch(id,a,'PROPOSAL_PENDING');this.send(id,ch,proposalRequest(a.request),{kind:'proposal',attemptId:a.attemptId});}
 }
 proposal(id,ch,a,p){if(terminal(a)||a.buySent)return;let buy;try{buy=validateProposal(p,a.request.stake);}catch(error){return this.reject(id,a,{code:'INVALID_PROPOSAL',message:error.message});}
  a.proposalId=p.id;a.proposalValidation={validated:true,ask:buy.price,payout:Number(p.payout)};this.state(id,a,'PROPOSAL_READY');this.event(id,a,'PROPOSAL_ID_RECEIVED');
  // Persist the intent BEFORE sending. A crash here requires review, never a replacement BUY.
  const observed=ch.latestTicks.get(a.request.symbol);
  a.purchaseTick=observed&&this.now()-observed.receivedAt<=5000?{...observed}:null;
  a.buySubmittedAt=this.now();
  a.buySent=true;this.state(id,a,'BUY_PENDING');this.watch(id,a,'BUY_PENDING');this.send(id,ch,buy,{kind:'buy',attemptId:a.attemptId});
  this.event(id,a,'AUTHORIZATION_TO_BUY',{authorizedAt:a.startedAt,buySubmittedAt:a.buySubmittedAt,elapsedMs:a.buySubmittedAt-a.startedAt,purchaseTick:a.purchaseTick});
 }
 receive(id,ch,data){if(this.channels.get(this.key(id))!==ch)return;const meta=ch.requests.get(data.req_id);const a=meta?.attemptId?this.find(id,meta.attemptId):null;
  if(!meta){if(data.subscription?.id)this.forget(id,ch,data.subscription.id);this.event(id,null,'UNMATCHED_RESPONSE_IGNORED',{req_id:data.req_id,msg_type:data.msg_type,contractId:data.proposal_open_contract?.contract_id,error:data.error?{code:data.error.code,message:data.error.message,echo_req:safe(data.echo_req)}:null});return;}
  if(data.subscription?.id)meta.subscription=data.subscription.id;
  if(data.error){const error={code:data.error.code??'DERIV_ERROR',message:data.error.message??'Deriv rejected request',req_id:data.req_id,echo_req:safe(data.echo_req)};this.event(id,a,'API_ERROR',{error});
   if(meta.kind==='warm'){ch.warm.delete(meta.key);ch.warmConfig=null;}
   if(!meta.subscribe)ch.requests.delete(data.req_id);
   if(a&&!terminal(a)){if(meta.kind==='proposal'||meta.kind==='buy'&&!a.contractId)this.reject(id,a,error);else if(meta.kind==='contract'){this.unresolved(id,a,error);void this.reconcile(this.credentials.get(this.key(id)),a).catch(e=>this.event(id,a,'RECONCILE_ERROR',{error:{message:e.message}}));}}return;
  }
  if(meta.kind==='ticks'&&data.tick){
   const t=data.tick;
   if(t.symbol===meta.symbol&&Number.isFinite(t.epoch))try{
    const normalized=extractLastDigit(t.quote,t.pip_size),previous=ch.latestTicks.get(t.symbol);
    if(!previous||t.epoch>=previous.epoch)ch.latestTicks.set(t.symbol,{price:normalized.quote,digit:normalized.digit,pipSize:t.pip_size,epoch:t.epoch,tickId:t.id??null,receivedAt:this.now(),source:'server tick observed before BUY submission'});
   }catch{/* Missing/invalid observation must never hold up a purchase. */}
   this.onTick(id,data.tick);return;
  }
  if(meta.kind==='warm'&&data.proposal){ch.warm.set(meta.key,{at:this.now(),proposal:data.proposal,config:ch.warmConfig});return;}
  if(meta.kind==='proposal'&&data.proposal){this.event(id,a,'PROPOSAL_RESPONSE_RECEIVED',{req_id:data.req_id});ch.requests.delete(data.req_id);if(a)this.proposal(id,ch,a,data.proposal);return;}
  if(meta.kind==='buy'&&data.buy){this.event(id,a,'BUY_RESPONSE_RECEIVED',{req_id:data.req_id});if(!a||terminal(a)||a.contractId)return;
   const idNumber=Number(data.buy.contract_id);if(!Number.isSafeInteger(idNumber)||idNumber<=0){this.unresolved(id,a,{code:'INVALID_BUY_RESPONSE',message:'BUY response has no valid contract ID'});return;}
   a.contractId=idNumber;a.buyPrice=Number(data.buy.buy_price);a.transactionId=data.buy.transaction_id;a.entry={...a.request,attemptId:a.attemptId,contractId:idNumber,buyPrice:a.buyPrice,transactionId:a.transactionId,entryTick:null,purchaseTick:a.purchaseTick,buySubmittedAt:a.buySubmittedAt,buyConfirmedAt:this.now(),proposalValidation:a.proposalValidation};this.state(id,a,'CONTRACT_OPEN');this.event(id,a,'CONTRACT_ID_RECEIVED');this.callbacks(id,a).entry.resolve(a.entry);this.monitor(id,ch,a,true);return;
  }
  if(meta.kind==='contract'&&data.proposal_open_contract){if(!a||terminal(a)){this.forget(id,ch,meta.subscription);ch.requests.delete(data.req_id);return;}const c=data.proposal_open_contract;
   if(String(c.contract_id)!==String(a.contractId)){this.event(id,a,'WRONG_CONTRACT_IGNORED',{receivedContractId:c.contract_id,req_id:data.req_id});return;}
   this.event(id,a,data.subscription?.id?'OPEN_CONTRACT_SUBSCRIPTION_ACTIVE':'CONTRACT_UPDATE',{req_id:data.req_id,subscriptionId:data.subscription?.id});
   const entryTick=c.entry_tick??c.entry_spot??null,exitTick=c.exit_tick??c.exit_spot??null;
   if(entryTick!==null&&a.entry?.entryTick==null){a.entry={...a.entry,entryTick,entryTickTime:c.entry_tick_time??c.date_start??null};this.save();}
   if(c.is_sold===1||c.is_sold===true||['won','lost','sold'].includes(c.status)){
    if(c.profit==null||!Number.isFinite(Number(c.profit))||!['won','lost','sold'].includes(c.status)){this.unresolved(id,a,{code:'INVALID_SETTLEMENT',message:'Terminal contract lacks valid status/profit'});return;}
    a.result={...a.entry,...a.request,contractId:a.contractId,entryTick:a.entry?.entryTick??entryTick,exitTick,exitTickTime:c.exit_tick_time??c.date_expiry??null,status:c.status,profit:Number(c.profit),payout:c.payout,attemptId:a.attemptId};this.event(id,a,'WIN_LOSS_DETECTED',{status:c.status,profit:Number(c.profit)});this.complete(id,a);
   }else{this.event(id,a,'CONTRACT_RUNNING');if(a.state!=='SETTLEMENT_PENDING'){this.state(id,a,'SETTLEMENT_PENDING');this.watch(id,a,'SETTLEMENT_PENDING');}}
   if(!meta.subscribe)ch.requests.delete(data.req_id);return;
  }
  if(meta.kind==='reconciliation-evidence'){this.event(id,a,'RECONCILIATION_EVIDENCE',{req_id:data.req_id,contractIds:(data.portfolio?.contracts??data.statement?.transactions??[]).map(c=>c.contract_id).filter(Boolean).slice(0,50),note:'Evidence only; cannot associate an unknown BUY solely by symbol/time'});ch.requests.delete(data.req_id);return;}
  if(!meta.subscribe)ch.requests.delete(data.req_id);
 }
 monitor(id,ch,a,subscribe){this.state(id,a,'CONTRACT_PENDING');this.watch(id,a,'CONTRACT_PENDING');this.send(id,ch,{proposal_open_contract:1,contract_id:a.contractId,...(subscribe?{subscribe:1}:{})},{kind:'contract',subscribe,attemptId:a.attemptId});}
 complete(id,a){
  // Accounting can fail independently of broker settlement. Keep the verified result
  // and an explicit lock until the idempotent ledger hook has recorded it.
  try{this.onSettled(id,a,a.result);}catch(error){this.unresolved(id,a,{code:'ACCOUNTING_FAILED',message:error.message});return;}
  a.error=null;this.state(id,a,'SETTLED');this.event(id,a,'PROFIT_LOSS_RECORDED');this.callbacks(id,a).settlement.resolve(a.result);this.cleanup(id,a);this.event(id,a,'STATE_RESET',{execution:'IDLE'});this.event(id,a,'READY_FOR_NEXT_TRADE',{note:'Execution lock released; strategy/risk/cooldown still apply'});
 }
 async reconcile(credentials,a=this.current(credentials?.accountId),manual=false){if(!credentials||!a||terminal(a))return;if(a.result){this.complete(credentials.accountId,a);return;}const id=credentials.accountId,key=a.attemptId;if(this.recovering.has(key))return;if(!manual&&a.reconcileCount>=3){this.unresolved(id,a,{code:'RECONCILIATION_REQUIRED',message:'Read-only recovery limit reached. Recheck execution or review Deriv account; no new BUY permitted.'});return;}
  this.recovering.add(key);a.reconcileCount++;try{this.state(id,a,'RECONCILING');const ch=await this.channel(credentials);if(terminal(a))return;this.ticks(id,ch,a.request.symbol);
   if(a.contractId){for(const [req,m] of ch.requests)if(m.kind==='contract'&&m.attemptId===a.attemptId){this.forget(id,ch,m.subscription);ch.requests.delete(req);}this.monitor(id,ch,a,true);}
   else{this.send(id,ch,{portfolio:1},{kind:'reconciliation-evidence',attemptId:a.attemptId});this.send(id,ch,{statement:1,limit:50,description:1},{kind:'reconciliation-evidence',attemptId:a.attemptId});this.unresolved(id,a,{code:'BUY_OUTCOME_UNKNOWN',message:'BUY confirmation missing. Account history requested; manual reconciliation required unless the correlated BUY reply arrives. Never resending BUY.'});}
  }catch(error){this.unresolved(id,a,{code:'RECONNECT_FAILED',message:error.message});}finally{this.recovering.delete(key);}}
 async resume(credentials,manual=false){const first=!this.credentials.has(this.key(credentials.accountId));this.credentials.set(this.key(credentials.accountId),credentials);for(const a of this.account(credentials.accountId).attempts){if(a.state==='SETTLED')this.onSettled(credentials.accountId,a,a.result);if(a.state==='REJECTED')this.onRejected(credentials.accountId,a);}const a=this.current(credentials.accountId);if(a&&(first||manual))await this.reconcile(credentials,a,manual);}
 snapshot(id){const account=this.account(id),a=this.current(id),last=a??account.attempts.at(-1);return {state:a?.state??'IDLE',blocking:!!a,last:last?structuredClone(last):null,attempts:structuredClone(account.attempts.slice(-20)),events:structuredClone(account.events.slice(-150)),serverTime:this.now()};}
 receipt(id){const a=this.current(id)??this.account(id).attempts.at(-1);if(!a)return null;return {...a.request,...(a.result??a.entry??{}),attemptId:a.attemptId,contractId:a.contractId,state:a.state==='SETTLED'?'settled':a.state==='REJECTED'?'rejected':a.state==='RECONCILIATION_REQUIRED'?'unresolved':'entered',executionState:a.state,error:a.error?.message??null,mode:a.request.mode};}
}
