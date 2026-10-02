import {DiagnosticLog,healthWarnings} from './public/rise-fall/diagnostics.js';
import {supports} from './public/rise-fall/contracts.js';

// Observes existing controls; never grants authority or changes an order.
export function executionStatus(service,c,a,now){
 if(!c)return {authenticated:false,demo:false,enabled:false,authorized:false,checks:[],blockers:['No authenticated demo execution connection']};
 const day=new Date(now).toISOString().slice(0,10),today=service.journal.filter(o=>o.accountId===c.account.account_id&&new Date(o.createdAt).toISOString().startsWith(day)&&o.state!=='REJECTED');
 const loss=today.reduce((n,o)=>n+Math.max(0,-(o.profit??0)),0),checks=[];
 const add=(key,label,value,required,pass)=>checks.push({key,label,value,required,pass,reason:pass?'Passed':`${label}: ${value}; requires ${required}`});
 add('authentication','Authentication',c.session.expiresAt>now?'Current':'Expired','Current session',c.session.expiresAt>now);
 add('demo','Account type',c.account.account_type??'Unverified','Active demo account',c.account.account_type==='demo'&&c.account.status==='active');
 add('connection','Broker connection',c.rpc.closed?'Disconnected':'Connected','Connected',!c.rpc.closed);
 add('auto','Auto enabled',c.running?'On':'Off','Explicitly started Auto',!!c.running);
 add('heartbeat','Authorization heartbeat',c.heartbeat?`${Math.max(0,now-c.heartbeat)} ms old`:'Not started','≤ 20000 ms and active Auto',!!c.running&&now-c.heartbeat<=20000);
 add('replay','Replay evidence',c.order?`${c.symbol} / ${c.order.duration}${c.order.unit}`:'No execution duration selected','Verified market/settings/duration',!!c.order&&service.validation(c.config,c.symbol,c.order.duration,c.order.unit));
 add('contracts','Contract duration',c.order?`${c.order.duration}${c.order.unit}`:'Not selected','Both CALL and PUT support duration',!!c.order&&['CALL','PUT'].every(t=>supports(c.contracts,t,c.order.duration,c.order.unit)));
 add('stake','Demo stake',c.order?.stake??'Not selected','> 0 and ≤ 50',Number.isFinite(c.order?.stake)&&c.order.stake>0&&c.order.stake<=50);
 add('lock','Account contract lock',service.busy(c.account.account_id)||service.otherBusy(c.account.account_id)?'Unresolved contract':'Clear','Clear',!service.busy(c.account.account_id)&&!service.otherBusy(c.account.account_id));
 add('episode','Signal episode',a.signalId?(c.used.has(a.signalId)?'Already consumed':'New'):'No qualified setup','New qualified setup',!!a.signalId&&!c.used.has(a.signalId));
 add('budget','Daily order / loss budget',`${today.length} orders / ${loss} gross loss`,'< 100 orders; loss + next stake ≤ 100',today.length<100&&Number.isFinite(c.order?.stake)&&loss+c.order.stake<=100);
 const blockers=checks.filter(x=>!x.pass&&x.key!=='episode').map(x=>x.reason);
 if(a.signalId&&c.used.has(a.signalId))blockers.push('This signal episode was already consumed; waiting for a new qualifying episode');
 const warnings=c.error?[c.error]:[];
 return {authenticated:c.session.expiresAt>now,demo:c.account.account_type==='demo',enabled:!!c.running,authorized:!!c.running&&!blockers.length,checks,blockers,warnings,proposalChecks:'A fresh matching proposal, current signal and authorization are checked again before BUY.'};
}
function collect(service,c,a){
 const localNow=service.now(),now=localNow+(c.clockOffset??0),execution=executionStatus(service,c,a,localNow);
 c.diagnosticLog??=new DiagnosticLog({source:'authenticated-server'});
 c.feedHealth??={state:c.rpc.closed?'closed':'connecting',startedAt:now,subscribed:false};
 c.diagnosticLog.observe(a,now,execution,c.feedHealth);
 const summary=c.diagnosticLog.summary();
 return {execution,diagnostics:{...summary,ticksAnalyzed:a.sequence,health:c.feedHealth,warnings:healthWarnings(a,c.feedHealth,now,summary),observedAt:now}};
}

export function observe(service,c,a){try{return collect(service,c,a);}catch(error){return {execution:{authenticated:false,authorized:false,enabled:!!c.running,checks:[],blockers:['Execution diagnostics unavailable; authority not verified'],warnings:[error.message]},diagnostics:{warnings:['Diagnostic collector failed: '+error.message],observedAt:service.now(),source:'authenticated-server'}};}}
