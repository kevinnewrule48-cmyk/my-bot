import {createTradeDecision} from './trade-decision.js';
import {BalanceBook,assertCandidate,analyzeBalance} from './balance-engine.js';
import {mountBalanceScale,BalanceEvidence} from './balance-scale.js';
import {DigitBarrierEngine,extractLastDigit,proposalRequest} from './digit-barrier-engine.js';
import {liveDigitWheel} from './live-digit-wheel.js';
import {heatMap} from './premium-model.js';
import {diagnoseSnapshot} from './part-one-diagnostics.js';
import {DifferEngine} from './differ-engine.js';
import {TradabilityEngine,tradabilityBlocks} from './tradability-engine.js';
import {TradabilityMarkets} from './tradability-markets.js';
const EntryStabilityRecovery = class {
  constructor({recoveryObservations=3,excellentObservations=5}={}){this.recoveryObservations=recoveryObservations;this.excellentObservations=excellentObservations;this.reset();}
  reset(){this.state='STABLE';this.blocked=false;this.recoveryRun=0;this.excellentRun=0;this.trigger=null;this.last=null;this.sequence=-1;}
  observe(history,sequence=history.length){if(sequence<=this.sequence)return this.snapshot();this.sequence=sequence;const d=history.slice(-12).map(x=>Number(x?.digit)).filter(x=>Number.isInteger(x)&&x>=0&&x<=9),ext=new Set([0,1,8,9]),tr=d.slice(1).map((x,i)=>[d[i],x]),danger=tr.filter(([a,b])=>ext.has(a)&&ext.has(b)&&Math.abs(a-b)>=7).length,recentDanger=tr.slice(-4).filter(([a,b])=>ext.has(a)&&ext.has(b)&&Math.abs(a-b)>=7).length,er=d.length?d.filter(x=>ext.has(x)).length/d.length*100:0,mid=d.length?d.filter(x=>x>=2&&x<=7).length/d.length*100:0,dr=tr.length?danger/tr.length*100:0,severe=danger>=2||(er>=58&&danger>=1);
    if(severe&&!this.blocked){this.trigger={extremeRevisitRate:er,dangerousTransitionRate:dr,sequence};this.blocked=true;this.state='UNSTABLE';this.recoveryRun=0;this.excellentRun=0;}
    else if(this.blocked){const clear=recentDanger===0&&er<=Math.max(12,(this.trigger?.extremeRevisitRate??58)*.75)&&mid>=40;if(clear){this.recoveryRun++;this.excellentRun++;this.state=this.recoveryRun>=this.recoveryObservations?(this.excellentRun>=this.excellentObservations?'EXCELLENT':'STABLE'):'RECOVERING';if(this.state==='STABLE'||this.state==='EXCELLENT')this.blocked=false;}else{this.recoveryRun=0;this.excellentRun=0;this.state='UNSTABLE';}}
    else {this.excellentRun++;this.state=this.excellentRun>=this.excellentObservations?'EXCELLENT':'STABLE';}this.last={window:d.length,extremeRevisitRate:er,dangerousTransitions:danger,recentDangerousTransitions:recentDanger,dangerousTransitionRate:dr,middleConcentration:mid,sequence};return this.snapshot();}
  snapshot(){return {state:this.state,blocked:this.blocked,recoveryRun:this.recoveryRun,requiredRecovery:this.recoveryObservations,recoveryConfidence:Math.min(100,Math.round(this.recoveryRun/this.recoveryObservations*100)),...(this.last??{window:0,extremeRevisitRate:0,dangerousTransitions:0,dangerousTransitionRate:0,middleConcentration:0}),trigger:this.trigger};}
};
// One-way research telemetry: no return value is read by the trading code.
const observeDigitRegime = (event, data) => {
  try {
    if(globalThis.partOneRegimeObserver)globalThis.partOneRegimeObserver(event,data);
    else {const queue=globalThis.partOneRegimeQueue??(globalThis.partOneRegimeQueue=[]);if(queue.length>=256){queue.shift();globalThis.partOneRegimeQueueDropped=(globalThis.partOneRegimeQueueDropped??0)+1;}queue.push([event,JSON.parse(JSON.stringify(data))]);}
  } catch (error) { console.warn('Shadow observer failed; execution unchanged', error.message); }
};
const regimeAttempt = (attemptId,type,mode,stake,barrier) => { try { observeDigitRegime('attempt',{
  attemptId,type,mode,stake,barrier,market:$('symbol').value,sequence:balanceBook.current($('symbol').value)?.sequence??liveTickNumber,capturedAt:Date.now(),tickTime:ticks.at(-1)?.time??null,
  accountId:selectedAccount()?.accountId??null,accountType:selectedAccount()?.accountType??null,currency:selectedAccount()?.currency??null,
  quotedPayout:type==='DIGITOVER'?quotes.over?.payout??null:type==='DIGITUNDER'?quotes.under?.payout??null:null,
  existing:{barrier:barrierSnapshot,barrierConfig:barrierEngine.config,minimumConfidence:null,requiredPersistence:Number($('barrierPersistence').value),
    entryStrength:{display:$('entryStrength').textContent,recovery:entryStability.snapshot(),sample:strengthSample},differ:{candidate:differEngineState.candidate,signal:differEngineState.signal,status:differEngineState.status},risk:diagnosticRisk()}
}); } catch(error) { console.warn('Shadow snapshot unavailable; execution unchanged',error.message); } };
// Broker epochs use a monotonic reference, independent of the computer clock.
let marketClockAnchor=null;
const marketNow=()=>marketClockAnchor?marketClockAnchor.epochMs+performance.now()-marketClockAnchor.receivedAt:NaN;
const syncMarketClock=epoch=>{if(Number.isFinite(epoch)&&epoch>0)marketClockAnchor={epochMs:epoch*1000,receivedAt:performance.now()};};
const balanceBook=new BalanceBook({now:marketNow});
const balanceEvidence=new BalanceEvidence();
const balanceSeenSettlements=new Set();
const tradabilityEvents=[];
const tradabilityMarkets=new TradabilityMarkets({onTick:tick=>{balanceBook.push(tick.market,tick);observeDigitRegime('tick',{...tick,sequence:tick.epoch});if(!tick.historical)queueMicrotask(()=>balanceCycle());},onEvent:event=>{tradabilityEvents.push(event);if(tradabilityEvents.length>200)tradabilityEvents.shift();auditStage('tradability-state',event);}});
const tradabilityEngine=new Proxy({}, {get:(_,key)=>{const engine=tradabilityMarkets.engine(document.getElementById('symbol')?.value||'R_100');const value=engine[key];return typeof value==='function'?value.bind(engine):value;}});
let tradabilityMode='monitor',tradabilityServer=null,tradabilitySyncing=false,tradabilityRevision=Date.now(),tradabilitySyncKey=null;
const syncTradability=async()=>{
  const account=selectedAccount();if(!demoConnected||!account)return;
  if(tradabilityMode==='auto-block'&&!isRunning)return;
  await executionReset;
  const pageId=executionPageId,mode=tradabilityMode,symbol=$('symbol').value,windowSize=tradabilityEngine.config.windowSize;
  const key=[pageId,account.accountId,mode,symbol,windowSize].join(':');if(key===tradabilitySyncKey)return;
  tradabilitySyncKey=key;tradabilitySyncing=true;
  try{const response=await fetch('/api/tradability/control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pageId,mode,symbol,windowSize,accountId:account.accountId,accountType:account.accountType,revision:++tradabilityRevision,live:isRunning})});const result=await response.json();if(!response.ok)throw Error(result.error||'Tradability settings rejected');if(tradabilitySyncKey===key)tradabilityServer=result;}
  catch(error){if(tradabilitySyncKey===key){tradabilityServer={allowed:false,reason:error.message};tradabilitySyncKey=null;}}
  finally{if(tradabilitySyncKey===key||tradabilitySyncKey===null)tradabilitySyncing=false;}
};
const tradabilityBlocked=()=>tradabilityMode==='auto-block'&&(tradabilitySyncing||!tradabilityServer?.allowed||tradabilityBlocks(tradabilityEngine.snapshot,'auto-block',tradabilityEngine.config.warmupPolicy));
const tradabilityState=()=>({engine:tradabilityEngine,markets:tradabilityMarkets.snapshots(),environments:tradabilityMarkets.environment.states,now:marketNow(),connection:tradabilityMarkets.connection,mode:tradabilityMode,server:tradabilityServer,syncing:tradabilitySyncing,events:tradabilityEvents,
 selectWindow:size=>{tradabilityMarkets.selectWindow(size);tradabilityServer=null;void syncTradability();},
 setMode:mode=>{tradabilityMode=mode;tradabilityServer=null;void syncTradability();}});
const overUnderEngineState={armed:true,status:'ANALYZING'};
let differEngineState=new DifferEngine();
let parallelRunId='',parallelRevision=Date.now(),parallelAutoReady=false;
let autoAuthorizationState='AUTO_OFF',autoControlPending=false,autoStatusPending=false;
let serverClockOffsetMs=0;
const executionNow=()=>Date.now()+serverClockOffsetMs;
let executionPageId=null,executionReset=Promise.resolve();
const revokeExecution=()=>{
  tradabilitySyncKey=null;tradabilityServer=null;
  autoEnabled=false;parallelAutoReady=false;parallelRunId='';
  autoAuthorizationState='AUTO_OFF';
  differEngineState.candidate=null;differEngineState.signal=null;
  executionPageId=null;
  executionReset=executionReset.then(()=>fetch('/api/execution/reset',{method:'POST',keepalive:true})).then(r=>r.json()).then(r=>{executionPageId=r.pageId;}).catch(()=>{executionPageId=null;});
  return executionReset;
};
const syncParallelControl=async(recover=false)=>{
  parallelAutoReady=false;const runId=recover?parallelRunId:crypto.randomUUID();parallelRunId=runId;
  autoControlPending=true;autoAuthorizationState=recover?'AUTO_RECOVERING':'AUTO_REQUESTING';
  try{
    await executionReset;if(parallelRunId!==runId)return;
    const response=await fetch('/api/auto/control',{method:'POST',signal:globalThis.AbortSignal?.timeout?.(15000),headers:{'content-type':'application/json'},body:JSON.stringify({pageId:executionPageId,runId,recover,revision:++parallelRevision,running:autoEnabled&&botMode==='auto'&&isRunning,live:isRunning&&socket?.readyState===1,accountId:selectedAccount()?.accountId,overUnder:overUnderEngineState.armed,differ:differEngineState.armed})});
    const controlResult=await response.json();
    if(!response.ok)throw Error(controlResult.error||`Auto acknowledgment failed (${response.status})`);
    if(Number.isFinite(controlResult.serverTime))serverClockOffsetMs=controlResult.serverTime-Date.now();
    if(parallelRunId===runId){parallelAutoReady=autoEnabled&&isRunning&&controlResult.runId===runId&&controlResult.authorization?.state==='AUTO_AUTHORIZED'&&controlResult.authorization?.pageId===executionPageId;autoAuthorizationState=parallelAutoReady?'AUTO_AUTHORIZED':autoEnabled?'AUTO_ERROR':'AUTO_OFF';autoLastError=parallelAutoReady?'':autoEnabled?'Server did not confirm this Auto session':'';auditStage('auto-acknowledgment',{browserState:autoAuthorizationState,server:controlResult.authorization});}
  }catch(error){if(parallelRunId===runId){parallelAutoReady=false;autoAuthorizationState='AUTO_ERROR';autoLastError=error.message;auditStage('auto-control-error',{reason:error.message});} }
  finally{if(parallelRunId===runId)autoControlPending=false;}
  renderParallel();
};
const verifyAutoAuthorization=async()=>{
  if(!autoEnabled||autoControlPending||autoStatusPending||!parallelRunId)return;
  autoStatusPending=true;const runId=parallelRunId,pageId=executionPageId;
  try{
    const response=await fetch('/api/auto/status',{cache:'no-store',signal:globalThis.AbortSignal?.timeout?.(5000)}),result=await response.json();
    if(runId!==parallelRunId||pageId!==executionPageId||autoControlPending)return;
    if(!response.ok)throw Error(result.error||'Auto status unavailable');
    const a=result.authorization;
    if(a?.runId!==runId||a?.pageId!==pageId||a?.state==='AUTO_OFF'){parallelAutoReady=false;autoEnabled=false;autoAuthorizationState='AUTO_ERROR';autoLastError=`Authorization revoked: ${a?.lastEvent?.event??'session mismatch'} — ${a?.lastEvent?.reason??'Start a fresh Auto session'}`;}
    else if(a?.state==='AUTO_RECOVERING'){parallelAutoReady=false;autoAuthorizationState='AUTO_RECOVERING';tradabilitySyncKey=null;tradabilityServer=null;auditStage('AUTO AUTH LOST',{server:a,browserState:autoAuthorizationState});await syncParallelControl(true);if(parallelAutoReady)void syncTradability();}
    else if(a?.state==='AUTO_AUTHORIZED'){parallelAutoReady=isRunning&&botMode==='auto';autoAuthorizationState=parallelAutoReady?'AUTO_AUTHORIZED':'AUTO_OFF';}
    else throw Error('Unknown server Auto state');
  }catch(error){if(runId===parallelRunId){
    parallelAutoReady=false;autoAuthorizationState='AUTO_ERROR';autoLastError=error.message;
    // The OAuth cookie can expire while the account selector still displays
    // the previously loaded account list. Clear that stale UI state so the
    // user gets an accurate reconnect action instead of a misleading pause.
    if(/session expired|reconnect your account/i.test(error.message??'')){
      demoConnected=false;autoEnabled=false;parallelRunId='';availableAccounts=[];
      const button=$('connect');if(button){button.disabled=false;button.textContent='Reconnect account';}
      const selector=$('accountSelector');if(selector){selector.innerHTML='';const option=document.createElement('option');option.textContent='Reconnect your Deriv account first';option.disabled=true;option.selected=true;selector.append(option);selector.disabled=true;}
      $('entryExecutionStatus').textContent='SESSION EXPIRED · Reconnect your Deriv demo account.';
      $('entryExecutionStatus').className='entryExecutionStatus negative';
    }
  }}
  finally{autoStatusPending=false;renderParallel();updateAutoState();}
};
const renderParallel=()=>{
  if(!$('differStatus'))return;
  $('ouArm').textContent=overUnderEngineState.armed?'OVER/UNDER · ARMED':'OVER/UNDER · DISARMED';
  $('differArm').textContent=differEngineState.armed?'DIFFER · ARMED':'DIFFER · DISARMED';
  $('parallelMasterStatus').textContent=!autoEnabled?'AUTO OFF':!parallelAutoReady?autoAuthorizationState.replaceAll('_',' '):autoInFlight||autoContractIds.size?'AUTO EXECUTING':'AUTOBOT ON · SERVER CONFIRMED';
  $('ouEngineStatus').textContent=!overUnderEngineState.armed?'DISARMED':!autoEnabled?'AUTOBOT OFF':autoInFlight||autoContractIds.size?'CONTRACT OPEN':differEngineState.executionLock||executionBlocked()?'ANALYZING · ACCOUNT PURCHASE LOCK':autoAwaitingReset?'WAITING FOR MOMENTUM RESET':barrierSnapshot?.selected?'READY':'ANALYZING';
  $('differStatus').textContent=`${differEngineState.status}${differEngineState.candidate?' · digit '+differEngineState.candidate.digit:''}${differEngineState.cooldown?' · '+differEngineState.cooldown+' ticks':''}`;
};
const maybeDifferOrder=async(signal)=>{
  if(!signal)return;
  if(tradabilityBlocked()){auditStage('tradability-block',{strategy:'DIFFER',state:tradabilityEngine.snapshot?.state});return;}
  const engine=differEngineState;
  const account=selectedAccount(),stake=Number($('stake').value);
  if(!parallelAutoReady||!autoEnabled||botMode!=='auto'||!engine.armed||!demoConnected||account?.accountType!=='demo'){engine.record('NOT AUTHORIZED');renderParallel();return;}
  if(executionBlocked()||autoInFlight||manualHttpPending||manualOrderPending||autoContractIds.size||engine.executionLock){engine.record('ACCOUNT BUSY · signal expired; no delayed purchase');renderParallel();return;}
  if(!Number.isFinite(stake)||stake<=0||stake>Number($('maxStake').value)){engine.record('INVALID STAKE');renderParallel();return;}
  const attemptId=crypto.randomUUID();engine.pending(attemptId);liveDigitWheel.register(attemptId);
  regimeAttempt(attemptId,'DIGITDIFF','auto',stake,signal.barrier);
  try{
    const response=await fetch('/api/order',{method:'POST',headers:{'content-type':'application/json'},signal:globalThis.AbortSignal?.timeout?.(45000),body:JSON.stringify({attemptId,browserAutoState:autoAuthorizationState,tradabilityMode,executionSessionId:parallelRunId,decisionId:attemptId,signalAt:executionNow(),gatePassed:true,runId:parallelRunId,armed:true,mode:'auto',type:'DIGITDIFF',barrier:signal.barrier,symbol:$('symbol').value,stake,accountId:account.accountId,accountType:'demo',riskLimits:demoRiskLimits(),strategyEvidence:{...signal,jumpDigit:ticks.at(-1)?.digit}})});
    const result=await response.json();
    if(!response.ok){
      // Explicit pre-purchase rejections are safe; transport failures remain locked for reconciliation.
      if(response.status===400||response.status===403||result.riskCode||['INVALID_PROPOSAL','AUTO_STOPPED','EXECUTION_BUSY'].includes(result.executionCode))engine.executionLock=false;
      throw Error(result.error||'DIFFER request failed');
    }
    observeDigitRegime('receipt',{attemptId,receipt:result});
    engine.observe(result);if(selectedAccount()?.accountId!==account.accountId)return;showOrderEntry('DIGITDIFF',result,'DIFFER Auto');
  }catch(error){engine.record((engine.executionLock?'RECONCILIATION REQUIRED · ':'BLOCKED · ')+error.message);}
  finally{trackRecentOrder();renderParallel();}
};
const $ = (id) => document.getElementById(id);
const demoRiskLimits=()=>({maxStake:Number($('maxStake').value),maxSessionLoss:Number($('dailyLoss').value),maxTrades:Number($('maxTrades').value),maxConsecutiveLosses:Number($('maxConsecutiveLosses').value),cooldownTicks:Number($('autoCooldownTicks').value)});
const barrierEngine = new DigitBarrierEngine();
const barrierAudit = [];
let barrierSnapshot = null;
let auditEventSequence=0,auditDropped=0,currentDecisionId=null;
const orderDecisionIds=new Map();
let executionView=null,recentOrderFetch=false,executionTransportError='',manualHttpPending=false;
const executionBlocked=()=>Boolean(executionView?.blocking);
let authoritativeAutoDecision=null;let authoritativeDecisionState='ANALYZING';let authoritativeDecisionError='';
const executionRequest=trace=>({attemptId:trace.attemptId,decisionId:trace.decision.decisionId,decision:trace.decision,barrier:trace.decision.candidate.barrier,strategyEvidence:{selected:trace.candidate.type,checks:trace.candidate.checks}});
const auditStage = (stage,detail) => {
  const event={eventId:++auditEventSequence,time:Date.now(),sequence:liveTickNumber,decisionId:currentDecisionId,market:$('symbol').value,stage,...detail};
  barrierAudit.push(event);
  if(barrierAudit.length>2000){barrierAudit.shift();auditDropped++;}
  return event.eventId;
};
const diagnosticRisk=()=>({connected:demoConnected,accountType:selectedAccount()?.accountType??null,mode:botMode,armed:autoEnabled,
  pending:autoInFlight||manualOrderPending||autoContractIds.size>0,awaitingMomentumReset:autoAwaitingReset,
  cooldownRemaining:0,
  configuredCooldown:selectedAutoCooldown(),stake:Number($('stake').value),maximumStake:Number($('maxStake').value),
  realAutoEnabled:false,dailyAccountLimits:'Demo server session ledger; not account-wide daily limits',requestedDemoLimits:demoRiskLimits()});
const beginOrderAudit=(type,mode,stake,candidate)=>{
  const balanceState=balanceBook.current(candidate.market);assertCandidate(candidate,balanceState,{type,now:marketNow(),allowManual:mode==='manual'});
  const decision=createTradeDecision(candidate,balanceState,{mode,now:marketNow(),regime:globalThis.partOneRegimeSnapshot?.(candidate.market)??null});
  balanceBook.consume(candidate);balanceEvidence.attempt(candidate,balanceState);
  if(mode==='auto'){authoritativeAutoDecision=decision;authoritativeDecisionState='LOCKED';authoritativeDecisionError='';}
  auditStage('decision-locked',{decision});
  const decisionId=decision.decisionId;
  const attemptId=globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random().toString(36).slice(2)}`;
  liveDigitWheel.register(attemptId);
  auditStage('signal-detected',{attemptId,decisionId,type,mode});
  auditStage('condition-gate',{attemptId,decisionId,checks:candidate.checks,mode});
  const requestId=auditStage('proposal-request',{attemptId,decisionId,type,mode,symbol:$('symbol').value,stake,risk:diagnosticRisk(),
    request:{contract_type:type,barrier:String(candidate.barrier),duration:1,duration_unit:'t',basis:'stake'},
    note:'Client order request; server determines actual account currency and proposal'});
  regimeAttempt(attemptId,type,mode,stake,candidate.barrier);
  return {decisionId:decision.decisionId,requestId,attemptId,decision,candidate:decision.candidate,balanceState:decision.balanceState};
};
const acceptedOrderAudit=(trace,result)=>{
  if(authoritativeAutoDecision?.decisionId===trace.decisionId)authoritativeDecisionState='PURCHASED';
  observeDigitRegime('receipt',{attemptId:trace.attemptId,receipt:result});balanceEvidence.receipt(result);
  auditStage('proposal-validation',{...trace,validation:result.proposalValidation??null,status:result.proposalValidation?.validated?'validated':'not reported'});
  auditStage('execution-accepted',{...trace,contractId:result.contractId,entryTick:result.entryTick,buyPrice:result.buyPrice,currency:result.currency});
  orderDecisionIds.set(result.contractId,trace);if(orderDecisionIds.size>250)orderDecisionIds.delete(orderDecisionIds.keys().next().value);
};
const analyzeBoth = () => {
 const state=balanceBook.current($('symbol').value);
 const snapshot=state??{id:null,sequence:0,candidates:[],selected:null};
 if(snapshot!==barrierSnapshot){barrierSnapshot=snapshot;currentDecisionId=state?.selected?.id??state?.id??null;
  auditStage('balance-evaluation',{balanceStateId:state?.id,position:state?.position,candidates:state?.candidates.map(c=>({label:c.label,ready:c.ready,checks:c.checks}))});
  if(state)observeDigitRegime('candidate',{market:state.market,sequence:state.sequence,candidates:state.candidates.map(c=>({type:c.contractType,barrier:c.barrier,ready:c.ready}))});
  $('barrierDiagnostics').textContent=snapshot.candidates.map(c=>`${c.label}: ${c.status} · ${c.checks.filter(x=>!x.pass).map(x=>`${x.name}: ${x.value} requires ${x.required}`).join('; ')}`).join('\n');
 }
 return snapshot;
};
let ticks = [], distributionDigits = [], socket, distributionTimer, isRunning = false, lastSignalIndex = -Infinity, liveTickNumber = 0;
const entryStability = new EntryStabilityRecovery();
const pending = [], settled = [];
const quotes = { over: null, under: null };
let strengthSample = null;
const strengthContext = () => `${$('symbol').value.trim()}:${Number($('window').value) || 200}`;
const sampleRateChanges = (previous, current) => Object.fromEntries(
  ['over1', 'under8'].map(key => [key, previous && current
    ? Math.round((current.options[key].observed - previous.options[key].observed) * 100 * 1e9) / 1e9 : null])
);
const selectedRateChange = (signal) => strengthSample?.context === strengthContext()
  ? strengthSample.changes[signal?.type === 'OVER' ? 'over1' : 'under8'] ?? null : null;
let manualOrdersInSetup = 0;
let targetRunBaseline = 0;
let demoConnected = false;
let availableAccounts = [], realTradingEnabled = false;
let botMode = 'manual', autoEnabled = false, autoInFlight = false;
let manualOrderPending = false;
let lastAutoSignalTick = -Infinity;
let autoMomentumTrades = 0, autoAwaitingReset = false;
let autoLastError = '';
const autoContractIds = new Set();
const storedOrders = () => { try { const value = JSON.parse(localStorage.getItem('derivAccountOrders') || '[]'); return Array.isArray(value) ? value.map(order=>order.lifecycle?.schema===1?{...order,...order.lifecycle}:{...order,entryDigit:null,settlementDigit:null,result:'UNVERIFIED'}) : []; } catch { return []; } };
let accountOrderHistory = storedOrders();
const displayedContractIds = new Set(accountOrderHistory.map(order=>String(order.contractId)));
let lastSettledOrder = accountOrderHistory.at(-1) ?? null;
let recentOrderPoll;
let digitFlash = null, digitFlashTimer;
const selectedAutoCooldown = () => Number($('autoCooldownTicks')?.value || 5);
const momentumResetEnabled = () => $('momentumResetEnabled')?.checked !== false;
let executionPreparing = false;
let warmPrepareTimer;
const scannerSymbols = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'];
let lastMarketScan = [], marketScanBusy = false, scannerTimer, scannerRecommendedSymbol = null;
// Each market keeps its own rolling tick memory. Switching markets restores
// the sample already collected for that market instead of starting at zero.
const marketTickMemory = new Map();
let performanceStats = { grossProfit:0, grossLoss:0, net:0, recovery:0, drawdown:0, wins:0, losses:0, consecutiveWins:0, consecutiveLosses:0 };
const money = (value) => Number(value || 0).toLocaleString('en-US', { style:'currency', currency:'USD' });
const updateRiskSummary = () => {
  $('riskSummary').textContent = `${money($('maxStake').value)} / ${money($('dailyLoss').value)} / ${Number($('maxTrades').value || 0)}`;
  const stake = Number($('stake').value || 0), max = Number($('maxStake').value || 0);
  $('stake').setCustomValidity(stake > max ? 'Stake cannot exceed the maximum stake.' : '');
  if (typeof updatePerformance === 'function') updatePerformance();
  if (typeof updateDemoArmState === 'function') updateDemoArmState();
  if (typeof updateAutoState === 'function') updateAutoState();
};
let updateDemoArmState;
let updatePerformance;
let updateAutoState;
const counts = (history) => Array.from({length:10}, (_, digit) => history.filter(x => x.digit === digit).length);
const cloneTicks = (history = []) => history.map((tick) => ({ ...tick }));
const saveMarketTicks = (symbol, history = ticks) => {
  if (!symbol || !history.length) return;
  const size = Number($('window')?.value || 200);
  marketTickMemory.set(symbol, cloneTicks(history.slice(-size)));
};
const restoreMarketTicks = (symbol) => {
  const saved = marketTickMemory.get(symbol);
  if (!saved?.length) { ticks=[];distributionDigits=[];return false; }
  ticks = cloneTicks(saved);
  distributionDigits = cloneTicks(saved);
  return true;
};
const selectedAccount = () => availableAccounts.find((account) => account.accountId === $('accountSelector').value);
const showSelectedBalance = () => {
  const account = selectedAccount();
  liveDigitWheel.setAccount(account?.accountId ?? null);
  if (!account) { $('accountBalance').textContent = 'Account balance: connect your account to view it.'; return; }
  const label = 'Account balance';
  const numericBalance = Number(account.balance);
  const balance = Number.isFinite(numericBalance) ? numericBalance.toLocaleString('en-US', { style:'currency', currency:account.currency || 'USD' }) : 'Unavailable from Deriv';
  $('accountBalance').textContent = `${label}: ${balance}`;
  $('accountBalance').className = `accountBalance ${account.accountType === 'demo' ? 'positive' : ''}`;
};
const logger = (html) => { const e = document.createElement('div'); e.className = 'entry'; e.innerHTML = html; const blank = $('.log').querySelector('.empty'); if(blank) blank.remove(); $('.log').prepend(e); };
const saveAccountOrderHistory = () => {
  try { localStorage.setItem('derivAccountOrders', JSON.stringify(accountOrderHistory.slice(-250))); }
  catch (error) { auditStage('history-storage-error', { message:error.message, note:'Result remains in memory; server execution journal is unchanged.' }); }
};
const renderContractPayoutHistory = () => {
  const list = $('contractPayoutList'), count = $('contractPayoutCount');
  if (!list || !count) return;
  const completed = accountOrderHistory.filter((order) => order.state === 'settled' || order.exitTick !== undefined && order.exitTick !== null).slice().reverse();
  count.textContent = `${completed.length} CONTRACT${completed.length === 1 ? '' : 'S'}`;
  if (!completed.length) { list.innerHTML = '<p class="empty">No completed contracts yet.</p>'; return; }
  list.innerHTML = completed.map((order) => {
    const won = order.won === true;
    const stake = Number(order.buyPrice ?? order.stake ?? 0);
    const payout = Number(order.payout ?? 0);
    const profit = Number(order.profit ?? 0);
    return `<article class="contractPayoutRow ${won ? 'contractWon' : 'contractLost'}"><div><b>${order.label ?? 'CONTRACT'} · ${order.result??'UNVERIFIED'}</b><small>Entry ${order.entryDigit ?? '—'} → settlement ${order.settlementDigit ?? '—'} · ${order.source ?? 'Account order'}</small></div><div><span>Contract amount</span><strong>${money(stake)}</strong></div><div><span>Deriv payout</span><strong>${money(payout)}</strong></div><div><span>Profit / loss</span><strong class="${profit >= 0 ? 'positive' : 'negative'}">${profit >= 0 ? '+' : ''}${money(profit)}</strong></div></article>`;
  }).join('');
};
const updateActualPerformance = () => {
  let grossProfit = 0, grossLoss = 0, net = 0, peak = 0, drawdown = 0, wins = 0, losses = 0, currentWins = 0, currentLosses = 0;
  for (const order of accountOrderHistory) {
    const profit = Number(order.profit || 0), won = order.won === true;
    if (won) { wins++; currentWins++; currentLosses = 0; } else { losses++; currentLosses++; currentWins = 0; }
    if (profit > 0) grossProfit += profit;
    if (profit < 0) grossLoss += Math.abs(profit);
    net += profit; peak = Math.max(peak, net); drawdown = Math.max(drawdown, peak - net);
  }
  const set = (id, value, className = '') => { const node = $(id); if (!node) return; node.textContent = value; node.className = className; };
  set('actualGrossProfit', money(grossProfit), grossProfit > 0 ? 'positive' : '');
  set('actualGrossLoss', money(grossLoss), grossLoss > 0 ? 'negative' : '');
  set('actualNetProfit', money(net), net > 0 ? 'positive' : net < 0 ? 'negative' : '');
  set('actualRecovery', money(Math.max(0, peak - net)), peak > net ? 'negative' : '');
  set('actualTotalOrders', accountOrderHistory.length);
  set('actualWinningOrders', wins, wins ? 'positive' : '');
  set('actualLosingOrders', losses, losses ? 'negative' : '');
  set('actualWinRate', accountOrderHistory.length ? `${(wins / accountOrderHistory.length * 100).toFixed(1)}%` : '—', wins / Math.max(1, accountOrderHistory.length) >= .5 ? 'positive' : 'negative');
  set('actualConsecutiveWins', currentWins, currentWins ? 'positive' : '');
  set('actualConsecutiveLosses', currentLosses, currentLosses ? 'negative' : '');
  set('actualDrawdown', money(drawdown), drawdown ? 'negative' : '');
  set('actualHistoryNote', accountOrderHistory.length ? `${accountOrderHistory.length} RECORDED` : 'THIS BROWSER');
  renderContractPayoutHistory();
};
const renderLastSettledOrder = (order) => {
  if (!order) return;
  const settled = order.state === 'settled' || order.exitTick !== undefined && order.exitTick !== null;
  const won = order.won === true;
  $('actualEntryTick').textContent = order.entryDigit ?? '—';
  $('actualEntryDigit').textContent = order.entrySource==='purchase-time'?`Purchase-time price: ${order.purchaseQuote??'unavailable'} · Broker entry digit: ${order.brokerEntryDigit??'pending'}`:`Broker entry price: ${order.entryTick ?? '—'}`;
  $('actualExitTick').textContent = settled ? (order.settlementDigit ?? '—') : '—';
  $('actualExitDigit').textContent = `Settlement price: ${settled ? order.exitTick : 'waiting for the next tick'}`;
  $('actualOrderOutcome').textContent = settled ? (order.result ?? 'UNVERIFIED') : 'ORDER ENTERED';
  $('actualOrderOutcome').className = settled ? (won ? 'positive' : 'negative') : '';
  $('actualOrderSide').textContent = settled ? `${order.label ?? 'ORDER'} · ${order.source ?? 'Account order'}` : `${order.label ?? 'ORDER'} · waiting for settlement`;
};
const showOrderEntry = (type, result, source) => {
  if(result.lifecycle?.accountId&&result.lifecycle.accountId!==selectedAccount()?.accountId)return;
  if(!liveDigitWheel.confirm(result))return;
  const record=liveDigitWheel.contracts.contracts.get(String(result.contractId));
  if(!record||record.state==='settled')return;
  const label = type==='DIGITDIFF'?`DIFFER ${result.barrier}`:`${result.type==='DIGITOVER'?'OVER':'UNDER'} ${result.barrier??'UNKNOWN'}`;
  lastSettledOrder = { ...record, lifecycle:record, label, source, time:Date.now() };
  $('entryExecutionStatus').textContent = `ORDER ENTERED · ${label} · ${source} · entry number ${record.entryDigit??'pending from Deriv'} · waiting for settlement · contract ${record.contractId}`;
  $('entryExecutionStatus').className = 'entryExecutionStatus';
  clearTimeout(digitFlashTimer); digitFlash = { entryDigit:lastSettledOrder.entryDigit }; digitFlashTimer = setTimeout(() => { digitFlash = null; update(); }, 800);
  renderLastSettledOrder(lastSettledOrder); update();
};
const balanceSettlementWatermark = result => {
  const raw = Number(result?.exitTickTime ?? result?.lifecycle?.exitTickTime);
  if(Number.isFinite(raw)&&raw>0)return raw<1e12?raw*1000:raw;
  // A receipt without broker settlement time still advances from the latest
  // accepted balance tick; the next tick must create newer evidence.
  return balanceBook.current(result?.symbol)?.createdAt ?? Date.now();
};
const showContractResult = (type, result, source) => {
  observeDigitRegime('receipt',{receipt:result});
  balanceEvidence.receipt(result);if(result.candidate&&!balanceSeenSettlements.has(String(result.contractId))){balanceSeenSettlements.add(String(result.contractId));balanceBook.settled(result.symbol,balanceSettlementWatermark(result));if(authoritativeAutoDecision?.decisionId===result.decisionId)authoritativeDecisionState='SETTLED';}
  if(result.lifecycle?.accountId&&result.lifecycle.accountId!==selectedAccount()?.accountId)return;
  liveDigitWheel.settle(result);
  const record=liveDigitWheel.contracts.accept(result);
  if(!record||record.state!=='settled')return;
  const alreadyReported=displayedContractIds.has(String(result.contractId));
  displayedContractIds.add(String(result.contractId));
  if(displayedContractIds.size>1000)displayedContractIds.delete(displayedContractIds.values().next().value);
  auditStage('order-result',{...(orderDecisionIds.get(result.contractId)||{decisionId:null}),contractId:result.contractId,type,source,
    status:result.status,entryTick:result.entryTick,exitTick:result.exitTick,profit:result.profit,payout:result.payout,buyPrice:result.buyPrice});
  const label = type==='DIGITDIFF'?`DIFFER ${result.barrier}`:`${result.type==='DIGITOVER'?'OVER':'UNDER'} ${result.barrier??'UNKNOWN'}`;
  const won = record.result==='WON';
  const outcome = record.result;
  const completedOrder={...record,lifecycle:record,won,buyPrice:Number(result.buyPrice||0),payout:Number(result.payout||0),profit:Number(result.profit||0),label,source,time:Date.now()};
  const current=liveDigitWheel.activeContractId===record.contractId||!liveDigitWheel.activeContractId&&(!lastSettledOrder||String(lastSettledOrder.contractId)===record.contractId);
  if(current){
  $('entryExecutionStatus').textContent = `ORDER PLACED · ${outcome} · ${label} · ${source} · entry ${record.entryDigit??'unavailable'} · settlement ${record.settlementDigit??'unavailable'} · contract ${record.contractId}`;
  $('entryExecutionStatus').className = `entryExecutionStatus ${won ? 'positive' : 'negative'}`;
  lastSettledOrder = completedOrder;
  clearTimeout(digitFlashTimer); digitFlash = { exitDigit:record.settlementDigit, won }; digitFlashTimer = setTimeout(() => { digitFlash = null; update(); }, 800);
  renderLastSettledOrder(lastSettledOrder);
  }
  const storedIndex=accountOrderHistory.findIndex(order=>String(order.contractId)===record.contractId);
  if(storedIndex<0)accountOrderHistory.push(completedOrder);else accountOrderHistory[storedIndex]=completedOrder;
  saveAccountOrderHistory(); updateActualPerformance();
  manualOrderPending = false;
  if (!alreadyReported&&source === 'Auto bot'&&result.strategy!=='DIFFER') handleAutoSettlement(result, won);
  if (botMode === 'manual') updateDemoArmState();
  update();
  loadAccounts({ preserveSelection:true, refreshOnly:true });
};
const updateAutoIndicator = () => {
  const indicator = $('autoBotIndicator');
  if (!indicator) return;
  if (botMode !== 'auto' || !autoEnabled) {
    indicator.textContent = 'AUTO BOT OFF'; indicator.className = 'autoBotIndicator'; return;
  }
  if(!parallelAutoReady){indicator.textContent=autoAuthorizationState.replaceAll('_',' ');indicator.className='autoBotIndicator negative';return;}
  if(executionBlocked()){indicator.textContent=`AUTO BOT · ${executionView.state.replaceAll('_',' ')}`;indicator.className='autoBotIndicator negative';return;}
  if (autoAwaitingReset && liveTickNumber - lastAutoSignalTick >= selectedAutoCooldown()) {
    indicator.textContent = 'AUTO BOT PAUSED · WAITING FOR FRESH EVIDENCE';
    indicator.className = 'autoBotIndicator negative'; return;
  }
  if (Number.isFinite(lastAutoSignalTick)) {
    const total = selectedAutoCooldown(), elapsed = Math.max(0, liveTickNumber - lastAutoSignalTick);
    if (elapsed < total) {
      indicator.textContent = `AUTO BOT ON · COOLDOWN ${elapsed}/${total}`;
      indicator.className = 'autoBotIndicator regime-consolidation'; return;
    }
  }
  indicator.textContent = 'AUTO BOT ON · READY'; indicator.className = 'autoBotIndicator positive';
};
const handleAutoSettlement = (result, won) => {
  autoContractIds.delete(result.contractId);
  // One completed order ends this momentum, regardless of its outcome.
  autoAwaitingReset = false;
  lastAutoSignalTick = liveTickNumber;
  updateCooldownMonitor();
  updateAutoState();
};
const updateCooldownMonitor = () => {
 const c=balanceBook.current($('symbol').value)?.selected;
 $('cooldownMonitor').textContent=c&&balanceBook.available(c)?'FRESH AUTHORIZATION':'AWAITING FRESH EVIDENCE';
 $('cooldownMonitorNote').textContent='Each balance authorization is used once. A completed contract requires new post-settlement analysis. No fixed tick cooldown applies to OVER/UNDER.';
};
const updateReport = () => {
  const wins = settled.filter(x => x.won).length;
  $('evaluated').textContent = settled.length;
  $('winRate').textContent = settled.length ? `${(wins / settled.length * 100).toFixed(1)}%` : '—';
  $('winRate').className = settled.length ? (wins / settled.length >= .5 ? 'positive' : 'negative') : '';
  $('outcomes').textContent = settled.length ? `${wins} win · ${settled.length - wins} loss` : 'No settled signals';
  $('pending').textContent = pending.length;
  $('rule').textContent = 'OVER 1 / UNDER 8';
  updatePerformance();
};
updatePerformance = () => {
  let grossProfit = 0, grossLoss = 0, net = 0, peak = 0, drawdown = 0, wins = 0, losses = 0, consecutiveWins = 0, consecutiveLosses = 0, currentWins = 0, currentLosses = 0;
  for (const trade of settled) {
    if (trade.won) { wins++; currentWins++; currentLosses = 0; consecutiveWins = Math.max(consecutiveWins, currentWins); }
    else { losses++; currentLosses++; currentWins = 0; consecutiveLosses = Math.max(consecutiveLosses, currentLosses); }
    if (!Number.isFinite(trade.pnl)) continue;
    if (trade.pnl > 0) grossProfit += trade.pnl;
    if (trade.pnl < 0) grossLoss += Math.abs(trade.pnl);
    net += trade.pnl; peak = Math.max(peak, net); drawdown = Math.max(drawdown, peak - net);
  }
  const targetProgress = net - targetRunBaseline;
  performanceStats = { grossProfit, grossLoss, net, targetProgress, recovery:Math.max(0, peak-net), drawdown, wins, losses, consecutiveWins:currentWins, consecutiveLosses:currentLosses };
  $('grossProfit').textContent = money(grossProfit); $('grossLoss').textContent = money(grossLoss); $('netProfit').textContent = money(net); $('recoveryNeeded').textContent = money(performanceStats.recovery);
  $('dailyProfit').textContent = money(grossProfit); $('dailyLossValue').textContent = money(grossLoss); $('drawdown').textContent = money(drawdown);
  $('totalTrades').textContent = settled.length; $('winningTrades').textContent = wins; $('consecutiveWins').textContent = currentWins; $('consecutiveLosses').textContent = currentLosses;
  $('grossProfit').className = grossProfit > 0 ? 'positive' : ''; $('grossLoss').className = grossLoss > 0 ? 'negative' : '';
  $('netProfit').className = net > 0 ? 'positive' : net < 0 ? 'negative' : ''; $('recoveryNeeded').className = performanceStats.recovery > 0 ? 'negative' : '';
  $('dailyProfit').className = grossProfit > 0 ? 'positive' : ''; $('dailyLossValue').className = grossLoss > 0 ? 'negative' : ''; $('drawdown').className = drawdown > 0 ? 'negative' : '';
  $('winningTrades').className = wins > 0 ? 'positive' : ''; $('consecutiveWins').className = currentWins > 0 ? 'positive' : ''; $('consecutiveLosses').className = currentLosses > 0 ? 'negative' : '';
  const target = Number($('dailyProfitTarget').value || 0);
  $('dailyTargetValue').textContent = target > 0 ? `${money(targetProgress)} / ${money(target)}` : 'OFF';
  const lossLimit = Number($('dailyLoss').value || 0), maxLosses = Number($('maxConsecutiveLosses').value || 0);
  const reasons = [];
  if (lossLimit > 0 && grossLoss >= lossLimit) reasons.push('daily paper-loss limit reached');
  if (maxLosses > 0 && currentLosses >= maxLosses) reasons.push('maximum consecutive paper losses reached');
  if (target > 0 && targetProgress >= target) reasons.push('current-run paper-profit target reached');
  $('riskGuard').textContent = reasons.length ? `Research guard: PAUSED — ${reasons.join('; ')}.` : 'Research guard: READY. It applies to paper-test signals, not confirmed account settlement.';
  $('riskGuard').className = reasons.length ? 'hint negative' : 'hint positive';
  if (typeof updateDemoArmState === 'function') updateDemoArmState();
  if (typeof updateAutoState === 'function') updateAutoState();
};
const researchGuardPaused = () => false;
const digitStability = (history) => {
  const result = entryStability.observe(history, liveTickNumber);
  return {...result, unstable:result.blocked, remaining:0};
};
const updateSideScores = (signal) => {
  for (const [id, key, type] of [['over', 'over1', 'OVER'], ['under', 'under8', 'UNDER']]) {
    const side = signal?.options[key];
    const state = !side ? 'WAITING' : !signal.type ? 'EQUAL' : signal.type === type ? 'STRONGER' : 'WEAKER';
    const rate = side ? side.observed * 100 : 0;
    $(`${id}ScoreBar`).value = rate;
    $(`${id}ScoreText`).textContent = `${side ? rate.toFixed(1) + '%' : '—'} · ${state}`;
    $(`${id}ScoreRow`).className = `sideScore score-${state.toLowerCase()}`;
  }
};
const updateEntryStrength = () => {
 const state=analyzeBoth(),candidate=state.selected;
 $('entryStrength').textContent=candidate?'FULLY QUALIFIED':state.status??'WARMING UP';
 $('entryStrengthNote').textContent=candidate?candidate.entryReason:'No current balance candidate qualifies. Inspect the scale conditions.';
};

const updatePricing = () => {
  const render = (quote, priceId, breakEvenId) => {
    if (!quote) { $(priceId).textContent = '—'; $(breakEvenId).textContent = 'No current quote'; return; }
    const breakEven = quote.ask / quote.payout;
    $(priceId).textContent = `$${quote.ask.toFixed(2)} → $${quote.payout.toFixed(2)}`;
    $(breakEvenId).textContent = `Break-even win rate ${(breakEven * 100).toFixed(1)}%`;
  };
  render(quotes.over, 'overPrice', 'overBreakEven'); render(quotes.under, 'underPrice', 'underBreakEven');
  const signal = analyzeBoth().selected;
  if (!signal?.type || !quotes.over || !quotes.under) { $('pricingGate').textContent = 'WAIT'; $('pricingGate').className = ''; $('pricingNote').textContent = signal && !signal.type ? 'Both sides have equal sample strength.' : 'Waiting for live quotes and current edge analysis'; updateEntryStrength(); return; }
  if(signal.barrier!==1&&signal.barrier!==8){$('pricingGate').textContent='FRESH PROPOSAL REQUIRED';$('pricingNote').textContent=signal.label+' receives its own validated proposal on execution; legacy 1/8 quotes do not apply.';updateEntryStrength();return;}
  const quote = signal.type === 'OVER' ? quotes.over : quotes.under;
  const expected = signal.observed * quote.payout - quote.ask;
  $('pricingGate').textContent = expected > 0 ? 'PASS' : 'BLOCK'; $('pricingGate').className = expected > 0 ? 'positive' : 'negative';
  $('pricingNote').textContent = `${signal.label}: sample EV ${expected >= 0 ? '+' : ''}$${expected.toFixed(3)} per $${quote.ask.toFixed(2)} stake`;
  updateEntryStrength();
};
const settleSignals = () => {
  const current = ticks.length - 1;
  for (let index = pending.length - 1; index >= 0; index--) {
    const trade = pending[index];
    if (current < trade.settleAt) continue;
    const exit = ticks[trade.settleAt];
    trade.exitDigit = exit.digit;
    trade.won = trade.type === 'OVER' ? exit.digit > trade.barrier : exit.digit < trade.barrier;
    trade.pnl = trade.won && Number.isFinite(trade.paperPayout) && Number.isFinite(trade.paperCost) ? trade.paperPayout - trade.paperCost : (!trade.won && Number.isFinite(trade.paperCost) ? -trade.paperCost : null);
    settled.push(trade); pending.splice(index, 1);
    const result = Number.isFinite(trade.pnl) ? ` · paper P/L ${trade.pnl >= 0 ? '+' : ''}${money(trade.pnl)}` : '';
    logger(`<span><b class="${trade.type === 'OVER' ? 'positive' : 'negative'}">${trade.type} ${trade.barrier}</b> · ${trade.confidence}% test score · exit digit ${exit.digit}</span><span><b class="${trade.won ? 'positive' : 'negative'}">${trade.won ? 'WIN' : 'LOSS'}</b>${result}</span>`);
  }
  updateReport();
};
const calculateSignal = (history) => {
  const n = history.length;
  if (n < 50) return null;
  const c = Array.from({length:10}, (_, digit) => history.filter(x => x.digit === digit).length);
  const over1 = { type:'OVER', barrier:1, label:'OVER 1', observed:c.slice(2).reduce((a,b)=>a+b,0)/n, risk:(c[0]+c[1])/n };
  const under8 = { type:'UNDER', barrier:8, label:'UNDER 8', observed:c.slice(0,8).reduce((a,b)=>a+b,0)/n, risk:(c[8]+c[9])/n };
  // Equal loss counts give neither side an advantage; never default to OVER.
  const candidate = over1.risk === under8.risk
    ? { type:null, barrier:null, label:'NO STRONGER SIDE', observed:null, risk:null }
    : over1.risk < under8.risk ? over1 : under8;
  const strength = Math.min(1, n / 200);
  return {...candidate, confidence: Math.round(Math.max(0, Math.min(95, 50 + Math.abs(over1.risk-under8.risk) * 300 * strength))), options:{over1, under8}};
};
const update = () => {
  const windowSize = Number($('window').value) || 200; ticks = ticks.slice(-windowSize); distributionDigits = distributionDigits.slice(-windowSize);
  // Cached history is retained for reconnect continuity, but it is never
  // presented as current analysis before this page has received a fresh tick
  // from an explicitly started live-feed socket.
  if(!isRunning || !hasFreshLiveTick){
   $('sample').textContent='0'; $('sampleNote').textContent='Start Live Feed for current analysis';
   $('price').textContent='—'; $('tickTime').textContent='Waiting for live feed';
   $('priceDigitCursor').textContent='Live feed is off'; $('digits').innerHTML='';
   showSignal(null); updateEntryStrength();
   return;
  }
  const canonical=analyzeBoth();updateSideScores({type:canonical.lean,options:{over1:canonical.candidates.find(c=>c.label==='OVER 1'),under8:canonical.candidates.find(c=>c.label==='UNDER 8')}});
  if (typeof updateDemoArmState === 'function') updateDemoArmState();
  updateCooldownMonitor();
  const c = counts(ticks), n = ticks.length, displayed = ticks.length, latest = ticks.at(-1);
  $('sample').textContent = n; $('sampleNote').textContent = n < 2 ? `Need ${2-n} more tick for sequence analysis` : `Rolling last ${n} ticks`;
  if(latest){ $('price').textContent = latest.price; $('tickTime').textContent = new Date(latest.time * 1000).toLocaleTimeString(); }
  if(latest) $('priceDigitCursor').textContent = `Live ${$('symbol').value.trim()} price: ${latest.price} · last digit ${latest.digit}`;
  $('digits').innerHTML = c.map((value,digit) => {
    return `<div class="digit"><b>${digit}</b><span>${displayed ? (value/displayed*100).toFixed(1) : '0.0'}%</span></div>`;
  }).join('');
  if(n < 2) { showSignal(null); updateEntryStrength(); liveDigitWheel.setLive(latest, heatMap(ticks), $('symbol').value); return; }
  showSignal(canonical.selected);
  updatePricing();
  // Strategy/authorization/request dispatch above must never wait for wheel rendering.
  liveDigitWheel.setLive(latest, heatMap(ticks), $('symbol').value);
};
const showSignal = signal => {
 $('signal').textContent=signal?.label??'NO TRADE';$('signal').className=signal?'positive':'';
 $('signalNote').textContent=signal?signal.entryReason:'No current balance candidate qualifies. Inspect all four candidates below the scale.';
 $('executeOver').classList.toggle('suggested',signal?.type==='OVER');$('executeUnder').classList.toggle('suggested',signal?.type==='UNDER');
};
const addTick = (price, epoch=Math.floor(Date.now()/1000), pipSize) => {
  let parsed;
  try { parsed=extractLastDigit(price,pipSize); } catch(error) { auditStage('invalid-tick',{reason:error.message}); return; }
  liveTickNumber++;
  const raw=parsed.quote,digit=parsed.digit;
  if(Number.isInteger(digit)){
    const tick = {price:raw,time:epoch,digit};
    ticks.push(tick);
    // Canonical balance/regime histories come from independent five-market subscriptions.
    // Advance only on price ticks, never on quote responses or UI redraws.
    // Compare each side with itself, even when the suggested side changes.
    const context = strengthContext();
    const current = calculateSignal(ticks.slice(-(Number($('window').value) || 200)));
    const previous = strengthSample?.context === context ? strengthSample.signal : null;
    strengthSample = { context, signal:current, changes:sampleRateChanges(previous, current) };
    if (!distributionDigits.length) distributionDigits = [tick];
    if (!distributionTimer) distributionTimer = setTimeout(() => { distributionDigits = ticks.slice(); distributionTimer = undefined; update(); }, 5000);
    const differSignal=differEngineState.tick(ticks.slice(-(Number($('window').value)||200)),{context:strengthContext()+':'+selectedAccount()?.accountId,sequence:liveTickNumber,running:autoEnabled&&botMode==='auto',cooldownTicks:selectedAutoCooldown()});
    observeDigitRegime('candidate',{market:$('symbol').value,sequence:liveTickNumber,time:epoch,candidates:[{type:'DIGITDIFF',barrier:differSignal?.barrier??differEngineState.candidate?.digit,ready:Boolean(differSignal)}]});
    // Both analyses see the same tick; neither awaits the other engine's network work.
    // Alternate dispatch precedence on simultaneous signals; the account safety lock remains authoritative.
    if(liveTickNumber%2===0)void maybeDifferOrder(differSignal);
    settleSignals(); update();
    if(liveTickNumber%2!==0)void maybeDifferOrder(differSignal);
    renderParallel();saveMarketTicks($('symbol').value.trim()); updateCooldownMonitor();
  }
};
const refreshPricing = () => {
  if (!socket || socket.readyState !== WebSocket.OPEN) { logger('<span class="negative">Start the live feed before requesting current Deriv pricing.</span>'); return; }
  const amount = Number($('stake').value) || 1, symbol = $('symbol').value.trim();
  for (const type of ['OVER','UNDER']) socket.send(JSON.stringify(proposalRequest({type,symbol,stake:amount})));
};
const renderMarketScan = () => {
 const best=balanceBook.best();scannerRecommendedSymbol=best?.market??null;
 $('scannerRecommendation').textContent=best?`${best.market} · ${best.label}`:'NO QUALIFIED MARKET';
 $('scannerRecommendationNote').textContent='Independent digit balance analysis; no price-trend fallback or direction quota.';
 $('useScannerMarket').disabled=!best;
 $('marketScanResults').textContent=[...balanceBook.states.values()].map(s=>`${s.market}: ${s.selected?.label??s.status}`).join(' · ');
 return {best,bestIsTrend:false};
};
const useScannerMarket = symbol => {
 if(!symbol||$('symbol').value===symbol||autoInFlight||manualHttpPending||executionBlocked()||autoContractIds.size)return;
 $('symbol').value=symbol;balanceBook.executionMarket=symbol;startLive();
};
// Scanner analysis is a live-feed feature.  Do not subscribe to market data or
// advance the balance engines while the user has not explicitly started Feed.
const scanMarkets = async () => {
 if(!isRunning || socket?.readyState!==WebSocket.OPEN){
  $('scannerRecommendation').textContent='LIVE FEED OFF';
  $('scannerRecommendationNote').textContent='Start Live Feed to analyze markets.';
  $('marketScanResults').textContent='Waiting for an explicit live-feed start.';
  return;
 }
 tradabilityMarkets.start();renderMarketScan();balanceCycle();
};
const balanceCycle = () => {
 renderMarketScan();const current=analyzeBoth();showSignal(current.selected);updateEntryStrength();renderParallel();
 if(botMode!=='auto'||!autoEnabled)return;
 const best=$('autoSwitchMarket').checked?balanceBook.best():balanceBook.current($('symbol').value)?.selected;
 if(!best)return;
 if(best.market!==$('symbol').value){useScannerMarket(best.market);return;}
 analyzeBoth();void maybeAutoOrder(best);
};

const syncScannerTimer = () => {
  clearInterval(scannerTimer); scannerTimer = undefined;
  if (botMode === 'auto' && autoEnabled) scannerTimer = setInterval(scanMarkets, 30000);
};
let liveFeedSymbol = null;
let feedWanted=false,feedRetryTimer=null,feedWatchdog=null,feedRetryCount=0,hasFreshLiveTick=false;
const pauseFeedExecution=reason=>{
  isRunning=false;hasFreshLiveTick=false;parallelAutoReady=false;
  // Invalidate in-flight acknowledgments, but retain the user's Auto intent.
  parallelRunId='';autoControlPending=false;tradabilitySyncKey=null;tradabilityServer=null;
  autoAuthorizationState=autoEnabled?'AUTO_RECOVERING':'AUTO_OFF';autoLastError=reason;
  differEngineState.candidate=null;differEngineState.signal=null;
  renderParallel();updateAutoState();
};
const stopLiveFeed=()=>{
  feedWanted=false;clearTimeout(feedRetryTimer);clearTimeout(feedWatchdog);
  feedRetryTimer=null;const previous=socket;socket=null;previous?.close();
  isRunning=false;
};
const startLive = () => {
  const symbol=$('symbol').value.trim();
  feedWanted=true;
  if(liveFeedSymbol===symbol&&socket&&(socket.readyState===0||socket.readyState===1))return;
  clearTimeout(feedRetryTimer);clearTimeout(feedWatchdog);feedRetryTimer=null;
  if(liveFeedSymbol!==symbol){
    saveMarketTicks(liveFeedSymbol);restoreMarketTicks(symbol);
    clearTimeout(distributionTimer);distributionTimer=undefined;quotes.over=null;quotes.under=null;
    $('price').textContent='—';$('tickTime').textContent='Waiting for selected market';
    $('priceDigitCursor').textContent=`Waiting for ${symbol} live price`;update();
  }
  balanceBook.executionMarket=symbol;
  // This is the single point where the independent scanner is allowed to
  // subscribe.  Page load and Auto intent alone must never create a live feed.
  tradabilityMarkets.start();
  tradabilityMarkets.start();strengthSample=null;
  pauseFeedExecution('Waiting for a fresh live tick');
  liveFeedSymbol=symbol;
  const previous=socket;socket=null;previous?.close();
  let feedSocket,brokerTime=null,brokerTimeReceived=0;
  const retry=reason=>{
    if(!feedWanted||(feedSocket&&socket!==feedSocket))return;
    clearTimeout(feedWatchdog);socket=null;feedSocket?.close();
    pauseFeedExecution(reason);
    $('connection').textContent='RECONNECTING · purchases paused';$('connection').className='pill negative';
    auditStage('feed-reconnecting',{symbol,reason});
    clearTimeout(feedRetryTimer);
    feedRetryTimer=setTimeout(()=>{feedRetryTimer=null;if(feedWanted)startLive();},Math.min(30000,1000*2**Math.min(feedRetryCount++,5)));
  };
  const watch=()=>{clearTimeout(feedWatchdog);feedWatchdog=setTimeout(()=>retry('Live feed stalled: no fresh ticks'),15000);};
  try {
    feedSocket=socket=new WebSocket('wss://api.derivws.com/trading/v1/options/ws/public');watch();
    feedSocket.onopen=()=>{
      if(socket!==feedSocket||!feedWanted)return;
      feedSocket.send(JSON.stringify({time:1}));
      feedSocket.send(JSON.stringify({ticks:symbol,subscribe:1}));
      $('connection').textContent=`CONNECTING · ${symbol} · waiting for tick`;
    };
    let lastEpoch=0;
    feedSocket.onmessage=e=>{
      if(socket!==feedSocket||!feedWanted)return;
      let data;try{data=JSON.parse(e.data);}catch{return;}
      if(Number.isFinite(data.time)){brokerTime=data.time*1000;brokerTimeReceived=performance.now();syncMarketClock(data.time);return;}
      if(data.error){if(data.echo_req?.ticks||data.echo_req?.time)retry('Live subscription rejected');else logger('Live pricing request failed');return;}
      if(data.tick&&data.tick.symbol===symbol){
        const epoch=Number(data.tick.epoch),quote=Number(data.tick.quote);
        if(!Number.isFinite(epoch)||!Number.isFinite(quote)||epoch<=lastEpoch||brokerTime===null||Math.abs(brokerTime+performance.now()-brokerTimeReceived-epoch*1000)>15000)return;
        lastEpoch=epoch;watch();feedRetryCount=0;
        if(!isRunning){isRunning=true;void syncTradability();if(autoEnabled)void syncParallelControl();refreshPricing();}
        hasFreshLiveTick=true;
        $('connection').textContent=`LIVE · ${symbol}`;$('connection').className='pill positive';
        addTick(data.tick.quote,epoch,data.tick.pip_size);
      }
      if(data.proposal){const kind=data.echo_req?.contract_type==='DIGITOVER'?'over':'under';quotes[kind]={ask:Number(data.proposal.ask_price),payout:Number(data.proposal.payout)};updatePricing();}
    };
    feedSocket.onerror=()=>retry('Live feed connection error');
    feedSocket.onclose=()=>retry('Live feed disconnected');
  }catch{retry('Could not open live feed');}
};
const backtest = () => {
  if(ticks.length<3){logger('Collect at least three ticks for a one-tick replay.');return;}
  const results=[];
  for(let i=1;i<ticks.length-1;i++){
    const analysis=analyzeBalance($('symbol').value,ticks.slice(Math.max(0,i-199),i+1));
    const c=analysis.selected;if(!c)continue;
    results.push(c.direction==='OVER'?ticks[i+1].digit>c.barrier:ticks[i+1].digit<c.barrier);i++;
  }
  const wins=results.filter(Boolean).length;
  logger(`EDGE REPLAY · ${results.length} hypothetical entries · ${wins} wins / ${results.length-wins} losses. Next-tick simulation only; no broker payout or execution verification.`);
};
const loadAccounts = async ({ preserveSelection = false, refreshOnly = false } = {}) => {
  try {
    const response = await fetch('/api/accounts', { cache:'no-store' }), result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Accounts are unavailable.');
    availableAccounts = result.accounts ?? []; realTradingEnabled = result.realTradingEnabled === true;
    const selector = $('accountSelector'), selectedBeforeRefresh = selector.value; selector.innerHTML = '';
    for (const account of availableAccounts) {
      const option = document.createElement('option'); option.value = account.accountId;
      option.textContent = `${account.accountType === 'demo' ? 'Demo' : 'Real'} account · ${account.currency}`;
      selector.append(option);
    }
    const priorAccount = availableAccounts.find((account) => account.accountId === selectedBeforeRefresh);
    const demo = availableAccounts.find((account) => account.accountType === 'demo');
    if (preserveSelection && priorAccount) selector.value = priorAccount.accountId;
    else if (demo) selector.value = demo.accountId;
    selector.disabled = availableAccounts.length === 0;
    showSelectedBalance();
    if (availableAccounts.length && !lastSettledOrder) { $('entryExecutionStatus').textContent = 'NO ORDER PLACED YET'; $('entryExecutionStatus').className = 'entryExecutionStatus'; }
    $('accountHelp').textContent = availableAccounts.length ? (refreshOnly ? 'Account balance refreshed from Deriv after the completed order.' : 'Select the account you want to use. Real-money ordering is disabled unless you explicitly enable it on the server.') : 'No active Options account was returned by Deriv.';
  } catch (error) { $('accountHelp').textContent = `Account connection unavailable: ${error.message}`; }
  updateDemoArmState();
  if(isRunning)void syncTradability();
};
// Retain existing callers without permitting account/stake changes to warm proposals.
const prepareFastExecution = async () => { if(isRunning)void syncTradability(); };
const scheduleFastPreparation = () => {
  clearTimeout(warmPrepareTimer);
  warmPrepareTimer = setTimeout(prepareFastExecution, 350);
};
const loadRecentOrder = async (reconcile=false) => {
  const account=selectedAccount();if(!account||recentOrderFetch)return;recentOrderFetch=true;
  try {
    const query=new URLSearchParams({accountId:account.accountId,accountType:account.accountType,...(reconcile===true?{reconcile:'1'}:{})});
    const response=await fetch('/api/orders/recent?'+query,{cache:'no-store',signal:globalThis.AbortSignal?.timeout?.(15000)}),result=await response.json();
    if(!response.ok)throw Error(result.error||'Execution status could not be retrieved');
    if(selectedAccount()?.accountId!==account.accountId)return;
    executionTransportError='';
    if(result.execution){executionView=result.execution;autoContractIds.clear();if(executionView.blocking&&executionView.last?.request.mode==='auto'&&executionView.last.request.strategy!=='DIFFER'&&executionView.last.contractId)autoContractIds.add(executionView.last.contractId);manualOrderPending=executionView.blocking||manualHttpPending;}
    liveDigitWheel.observeExecution(result.execution);
    const order=result.order;
    if(order?.decision?.mode==='auto'){authoritativeAutoDecision=order.decision;authoritativeDecisionState=order.state==='settled'?'SETTLED':order.contractId?'PURCHASED':order.state==='rejected'?'BLOCKED':'PROPOSAL';authoritativeDecisionError=order.error??'';}
    if(order){observeDigitRegime('receipt',{receipt:order});balanceEvidence.receipt(order);if(order.candidate&&order.state==='settled'&&!balanceSeenSettlements.has(String(order.contractId))){balanceSeenSettlements.add(String(order.contractId));balanceBook.settled(order.symbol,balanceSettlementWatermark(order));if(authoritativeAutoDecision?.decisionId===order.decisionId)authoritativeDecisionState='SETTLED';}}
    if(order?.strategy==='DIFFER'){
      if(!differEngineState.attemptId){differEngineState.pending(order.attemptId);differEngineState.pendingCooldown=Number($('autoCooldownTicks').value)||5;}
      differEngineState.observe(order);
    }
    renderParallel();
    if(order){
      const source=order.strategy==='DIFFER'?'DIFFER Auto':order.mode==='auto'||autoContractIds.has(order.contractId)?'Auto bot':'Manual bot';
      if(order.state==='settled'){
        autoContractIds.delete(order.contractId);manualOrderPending=false;
        const saved=accountOrderHistory.find(r=>String(r.contractId)===String(order.contractId));
        if(!displayedContractIds.has(String(order.contractId))||order.lifecycle&&(saved?.entryDigit!==order.lifecycle.entryDigit||saved?.settlementDigit!==order.lifecycle.settlementDigit))showContractResult(order.type,order,source);
      }else if(order.state==='rejected'||order.state==='failed'){
        auditStage('execution-terminal-error',{attemptId:order.attemptId,contractId:order.contractId,error:order.error});
        // Only explicit server rejection proves no purchase. A legacy failed receipt is unresolved.
        if(order.state==='rejected'){autoContractIds.delete(order.contractId);manualOrderPending=false;}
        else executionView={...executionView,blocking:true,state:'RECONCILIATION_REQUIRED'};
        $('demoOrderStatus').textContent=order.state==='rejected'?`Order rejected: ${order.error}`:`Outcome unresolved: ${order.error}. Recheck execution; do not submit a replacement.`;
      }else if(order.contractId){
        if(String(lastSettledOrder?.contractId)!==String(order.contractId)||lastSettledOrder?.entryTick!==order.entryTick)showOrderEntry(order.type,order,source);
      }
    }
    updateDemoArmState();updateAutoState();
  }catch(error){executionTransportError=error.message;auditStage('execution-status-error',{reason:error.message});}
  finally{recentOrderFetch=false;}
};
const trackRecentOrder = () => {
  if(recentOrderPoll)clearInterval(recentOrderPoll);
  recentOrderPoll=setInterval(loadRecentOrder,1000);loadRecentOrder();
};
const loadAuthStatus = async () => {
  try {
    await revokeExecution();
    const status = await fetch('/api/auth/status', { cache:'no-store' }).then(r => r.json());
    const button = $('connect');
    if (status.connected) { demoConnected = true; button.textContent = 'Deriv account connected'; button.disabled = true; loadAccounts().then(trackRecentOrder); return; }
    demoConnected = false; autoEnabled = false;
    $('entryExecutionStatus').textContent = 'NO ORDER PLACED YET · Connect an account to execute.';
    $('entryExecutionStatus').className = 'entryExecutionStatus negative';
    updateAutoState(); updateDemoArmState();
    if (!status.configured) { button.textContent = 'Configure account sign-in'; button.title = 'Set DERIV_CLIENT_ID and an HTTPS DERIV_REDIRECT_URI on the server first.'; return; }
    button.textContent = 'Connect account';
  } catch { $('connect').textContent = 'Account sign-in unavailable'; }
};
$('connect').onclick=()=>{ window.location.assign('/api/auth/start'); };
$('start').onclick=startLive; $('pricing').onclick=refreshPricing; $('backtest').onclick=backtest; $('stop').onclick=()=>{stopLiveFeed();void revokeExecution();isRunning=false;clearTimeout(distributionTimer);distributionTimer=undefined;if(socket)socket.close();$('connection').textContent='STOPPED';$('connection').className='pill muted';};
['window','duration','cooldown'].forEach(id=>$(id).addEventListener('change',()=>{ update(); updateReport(); })); updateReport(); update();
updateDemoArmState = () => {
  const stake = Number($('stake').value || 0), maximum = Number($('maxStake').value || 0);
  const account = selectedAccount(), realSelected = account?.accountType === 'real';
  const realConfirmed = $('realConfirm').checked;
  $('realConfirmWrap').classList.toggle('hidden', !realSelected);
  const accountReady = demoConnected && Boolean(account) && stake > 0 && stake <= maximum && (!realSelected || (realTradingEnabled && realConfirmed));
  if (!demoConnected) { $('executionMode').textContent = 'CONNECT ACCOUNT'; $('executionMode').className = ''; $('executionNote').textContent = 'Sign in to your Deriv account to unlock manual orders.'; }
  else if (!account) { $('executionMode').textContent = 'ACCOUNT LOADING'; $('executionMode').className = ''; $('executionNote').textContent = 'Retrieving your available Deriv accounts.'; }
  else if (realSelected && !realTradingEnabled) { $('executionMode').textContent = 'REAL CONNECTED'; $('executionMode').className = ''; $('executionNote').textContent = 'Your real account is visible, but real-money orders are disabled by the server setting.'; }
  else if (realSelected && !realConfirmed) { $('executionMode').textContent = 'REAL CONFIRM'; $('executionMode').className = 'negative'; $('executionNote').textContent = 'A separate real-money confirmation is required.'; }
  else if (accountReady) { $('executionMode').textContent = 'MANUAL READY'; $('executionMode').className = 'positive'; $('executionNote').textContent = 'Ready: press OVER 1 or UNDER 8 to send one order.'; }
  else { $('executionMode').textContent = 'ENTER STAKE'; $('executionMode').className = ''; $('executionNote').textContent = `Enter a stake up to ${money(maximum)} to enable manual execution.`; }
  const unstable = false;
  const manualReady = accountReady && botMode === 'manual' && !manualOrderPending && !manualHttpPending && !executionBlocked() && !unstable;
  $('executeOver').disabled = !manualReady; $('executeUnder').disabled = !manualReady;
  $('demoOrderStatus').textContent = !demoConnected ? 'Connect your Deriv account first.' : (manualOrderPending ? 'Current order is waiting for its one-tick settlement. Manual buttons will return immediately after settlement.' : (realSelected && !realTradingEnabled ? 'Real account is connected for later. Real-money ordering is disabled by the server setting.' : (accountReady ? `Ready for one order of ${money(stake)}.` : 'Select an account and enter a valid stake.')));
  if(executionBlocked())$('demoOrderStatus').textContent=`Execution: ${executionView.state.replaceAll('_',' ')}. ${executionView.last?.error?.message??executionView.errorSummary??'Monitoring the accepted request.'}`;
};
const executeOrder = async (type,chosen=null) => {
  const state=balanceBook.current($('symbol').value);const candidate=chosen??state?.candidates.find(c=>c.contractType===type&&c.barrier===(type==='DIGITOVER'?1:8));
  if(!balanceBook.available(candidate)){ $('demoOrderStatus').textContent='NO ORDER · chosen candidate is not currently qualified or its authorization was consumed';return;}
  if(tradabilityBlocked()){$('demoOrderStatus').textContent='NEW ENTRY BLOCKED · '+(tradabilityServer?.reason??tradabilityEngine.snapshot?.state??'COLLECTING DATA');auditStage('tradability-block',{mode:'manual',type});return;}
  if(botMode!=='manual')return;
  if(manualOrderPending||manualHttpPending||executionBlocked()||differEngineState.executionLock){trackRecentOrder();return;}
  auditStage('manual-attempt',{type,risk:diagnosticRisk(),note:'Manual path uses existing guards, not automatic READY gate'});
  const stake = Number($('stake').value || 0), account = selectedAccount();
  if (!demoConnected || !account || !Number.isFinite(stake) || stake <= 0) return updateDemoArmState();
  const title = candidate.label;
  if (account.accountType === 'real' && !window.confirm(`Place one ${title} real-money order for ${money(stake)}?`)) return;
  const button = type === 'DIGITOVER' ? $('executeOver') : $('executeUnder'); manualOrderPending = true; $('executeOver').disabled = true; $('executeUnder').disabled = true; $('demoOrderStatus').textContent = 'ORDER REQUEST SENT · Waiting for Deriv to accept it…';
  const trace=beginOrderAudit(type,'manual',stake,candidate);
  manualHttpPending=true;
  try {
    const intentResponse=await fetch('/api/execution/manual-intent',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pageId:executionPageId,intent:'manual-click',attemptId:trace.attemptId,accountId:account.accountId,type})});
    const intent=await intentResponse.json();if(!intentResponse.ok)throw Error(intent.error||'Manual authorization failed');
    assertCandidate(candidate,balanceBook.current(candidate.market),{type,now:marketNow(),allowManual:true});
    const submitted = fetch('/api/order', { method:'POST', headers:{'content-type':'application/json'}, signal:globalThis.AbortSignal?.timeout?.(45000), body:JSON.stringify({ ...executionRequest(trace),tradabilityMode,executionSessionId:intent.executionSessionId,armed:true, type, symbol:trace.candidate.market, stake, accountId:account.accountId, accountType:account.accountType, realConfirmed:$('realConfirm').checked,mode:'manual',riskLimits:demoRiskLimits() }) });
    trackRecentOrder();
    const response = await submitted;
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error || 'The order was not accepted.'),{riskCode:result.riskCode});
    acceptedOrderAudit(trace,result);
    $('demoOrderStatus').textContent = `ORDER ENTERED on digit ${result.lifecycle?.entryDigit??'pending from Deriv'}. Waiting for the next tick to settle. Contract ${result.contractId}.`;
    showOrderEntry(type, result, 'Manual bot'); trackRecentOrder();
  } catch (error) { auditStage('execution-error',{...trace,reason:error.message,riskCode:error.riskCode??null,proposalValidation:error.riskCode?'blocked by server risk before proposal/order':'not reported; failure stage unknown'}); manualOrderPending = false; $('demoOrderStatus').textContent = `${error.riskCode?'New request blocked':'Request failed; order outcome may need verification'}: ${error.message}`;trackRecentOrder();updateDemoArmState(); }
  finally{manualHttpPending=false;}
};
const maybeAutoOrder = async (signal) => {
  if(tradabilityBlocked()){auditStage('tradability-block',{strategy:'OVER_UNDER',state:tradabilityEngine.snapshot?.state});return;}
  if(!overUnderEngineState.armed||!parallelAutoReady)return;
  if(differEngineState.executionLock){if(overUnderEngineState.blockedSequence!==liveTickNumber){overUnderEngineState.blockedSequence=liveTickNumber;auditStage('account-purchase-lock',{strategy:'OVER_UNDER',reason:'DIFFER execution unresolved; analysis continues, no delayed purchase'});}return;}
  if(analyzeBoth().selected?.id!==signal.id||!balanceBook.available(signal))return;
  auditStage('risk-manager',{type:signal.type,connected:demoConnected,mode:botMode,armed:autoEnabled,pending:autoInFlight||autoContractIds.size>0,reset:autoAwaitingReset,cooldown:0});
  if(!signal.ready)return;
  const account = selectedAccount(), stake = Number($('stake').value || 0), currentTick = liveTickNumber;
  if (botMode !== 'auto' || !isRunning || socket?.readyState!==1 || !autoEnabled || autoInFlight || autoContractIds.size > 0 || executionBlocked() || !demoConnected || account?.accountType !== 'demo') return;
  const maximum = Number($('maxStake').value || 5000);
  if (!Number.isFinite(stake) || stake <= 0 || stake > maximum) {
    autoLastError = `Enter a stake between $0.01 and ${money(maximum)} before Auto Bot can send an order.`;
    updateAutoState();
    return;
  }
  const ticksSinceLast = currentTick - lastAutoSignalTick;
  // One current balance authorization is consumed per request; no fixed OU tick delay.
  autoInFlight = true; autoLastError = ''; $('autoStatus').textContent = `LIVE SUPPORT confirmed for ${signal.label}. Sending order…`;
  let trace;
  try {
    trace=beginOrderAudit(signal.contractType,'auto',stake,signal);
    authoritativeDecisionState='PROPOSAL';
    const response = await fetch('/api/order', { method:'POST', headers:{'content-type':'application/json'}, signal:globalThis.AbortSignal?.timeout?.(45000), body:JSON.stringify({ ...executionRequest(trace),browserAutoState:autoAuthorizationState,tradabilityMode,executionSessionId:parallelRunId,signalAt:executionNow(),gatePassed:barrierSnapshot?.selected?.ready===true,runId:parallelRunId,mode:'auto', armed:true, type:trace.candidate.contractType, symbol:trace.candidate.market, stake, accountId:account.accountId, accountType:'demo', realConfirmed:false,riskLimits:demoRiskLimits() }) });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error || 'Auto order was not accepted.'),{riskCode:result.riskCode});
    acceptedOrderAudit(trace,result);
    lastAutoSignalTick = liveTickNumber;
    autoMomentumTrades += 1;
    autoContractIds.add(result.contractId);
    autoAwaitingReset = false;
    $('autoStatus').textContent = `ORDER ENTERED on digit ${result.lifecycle?.entryDigit??'pending from Deriv'}. Waiting for the next tick to settle. A new post-settlement balance state is required before another order.`;
    showOrderEntry(signal.type, result, 'Auto bot'); trackRecentOrder();
    updateCooldownMonitor();
  } catch (error) {
    // A rejected request must not silently turn the bot off. Keep it armed and
    // show the exact reason so the next LIVE SUPPORT signal can retry.
    autoLastError = error.message || 'Deriv did not accept the Auto Bot order.';authoritativeDecisionState='BLOCKED';authoritativeDecisionError=autoLastError;
    auditStage('execution-error',{...trace,type:signal.type,reason:autoLastError,riskCode:error.riskCode??null,proposalValidation:error.riskCode?'blocked by server risk before proposal/order':'not reported; failure stage unknown'});
    $('autoStatus').textContent = `Auto Bot is still ON. Request error: ${autoLastError}. Checking execution status before another purchase.`;
    trackRecentOrder();
  }
  finally { autoInFlight = false; updateAutoState(); }
};
const setBotMode = (mode) => {
  botMode = mode;
  const auto = mode === 'auto';
  $('manualOrderPanel').classList.toggle('hidden', auto);
  $('manualMode').classList.toggle('active', !auto); $('manualMode').classList.toggle('secondary', auto);
  $('autoMode').classList.toggle('active', auto); $('autoMode').classList.toggle('secondary', !auto);
  $('botModeNote').textContent = auto ? 'Auto mode: the market scanner can run, but automatic orders remain off until you press Start Auto Bot.' : 'Manual mode: you decide whether to place each order.';
  if (!auto) { autoEnabled = false; autoAwaitingReset = false; autoMomentumTrades = 0; $('autoStatus').textContent = 'Manual execution: choose the button that matches Suggested entry.'; }
  updateAutoState(); updateDemoArmState(); updateAutoIndicator(); syncScannerTimer();
};
updateAutoState = () => {
  const account = selectedAccount();
  if (botMode !== 'auto') { updateAutoIndicator(); return; }
  if (!demoConnected) $('autoStatus').textContent = 'Connect your Deriv account first.';
  else if (account?.accountType !== 'demo') $('autoStatus').textContent = 'Auto mode is available only with the selected practice account.';
  else if (executionBlocked()) $('autoStatus').textContent = `Execution: ${executionView.state.replaceAll('_',' ')}. ${executionView.last?.error?.message??'Monitoring current contract; no additional purchase.'}`;
  else if (researchGuardPaused()) $('autoStatus').textContent = 'Auto bot is paused by the research guard.';
  else if (autoAwaitingReset) $('autoStatus').textContent = 'Waiting for fresh post-settlement edge analysis.';
  else if (autoInFlight) $('autoStatus').textContent = 'LIVE SUPPORT confirmed. Sending Auto Bot order…';
  else if (!parallelAutoReady&&autoEnabled) $('autoStatus').textContent = `${autoAuthorizationState.replaceAll('_',' ')} · purchases paused. ${autoLastError||'Waiting for positive server acknowledgment.'}`;
  else if (autoLastError) $('autoStatus').textContent = `${parallelAutoReady?'Server-authorized Auto · last request rejected':'Auto stopped'}. ${autoLastError}. See Execution engine for the verified outcome.`;
  else if (autoEnabled) $('autoStatus').textContent = `Auto Bot uses the canonical Balance State. Each order consumes its authorization; only new post-settlement evidence can authorize another.`;
  else $('autoStatus').textContent = 'Auto bot is not active.';
  updateAutoIndicator();
};
$('realConfirm').addEventListener('change', updateDemoArmState); $('accountSelector').addEventListener('change', () => { showSelectedBalance(); updateDemoArmState(); updateAutoState(); prepareFastExecution(); }); $('stake').addEventListener('change', () => { autoLastError = ''; scheduleFastPreparation(); }); $('symbol').addEventListener('change', () => { const selected = $('symbol').value.trim(); scheduleFastPreparation(); if (isRunning) { $('scannerStatus').textContent = `Changed to ${selected}. Loading its live feed now.`; startLive(); } }); $('autoCooldownTicks').addEventListener('change', updateCooldownMonitor); $('executeOver').onclick = () => executeOrder('DIGITOVER'); $('executeUnder').onclick = () => executeOrder('DIGITUNDER'); $('startAuto').onclick = () => { autoEnabled = true; autoAwaitingReset = false; autoMomentumTrades = 0; autoLastError = ''; lastAutoSignalTick = -Infinity; $('autoSwitchMarket').checked = true; setBotMode('auto'); $('autoStatus').textContent = 'Auto Bot started. Entry follows current scale direction and edge avoidance; no minimum score.'; updateCooldownMonitor(); scanMarkets(); }; $('stopAuto').onclick = () => { autoEnabled = false; autoAwaitingReset = false; autoMomentumTrades = 0; autoLastError = ''; lastAutoSignalTick = -Infinity; $('autoStatus').textContent = 'Auto Bot stopped. No new Auto orders will be sent.'; updateCooldownMonitor(); updateAutoState(); }; $('scanMarkets').onclick = scanMarkets; $('useScannerMarket').onclick = () => { if (!scannerRecommendedSymbol) return; const before = $('symbol').value.trim(); useScannerMarket(scannerRecommendedSymbol); $('scannerStatus').textContent = before === scannerRecommendedSymbol ? `${scannerRecommendedSymbol} is already the active market.` : `Changed the live market from ${before} to ${scannerRecommendedSymbol}.`; }; $('autoSwitchMarket').addEventListener('change', () => { $('scannerStatus').textContent = $('autoSwitchMarket').checked ? 'Auto Pair Selection follows independently qualified digit balance candidates. Inspection does not change execution.' : 'Automatic switching is off. The scanner will only show its recommendation.'; });
$('manualMode').onclick = () => setBotMode('manual'); $('autoMode').onclick = () => { setBotMode('auto'); $('autoStatus').textContent = 'Auto mode selected. The market scanner is running; press Start Auto Bot when you are ready to allow automatic orders.'; scanMarkets(); };
$('resetTargetCycle').onclick = () => { targetRunBaseline = performanceStats.net; updatePerformance(); updateDemoArmState(); };
$('deleteToday').onclick = () => {
  const approved = window.confirm('Delete today’s dashboard paper-test results, pending test signals, and log? This cannot delete Deriv account history or completed demo contracts.');
  if (!approved) return;
  pending.splice(0, pending.length); settled.splice(0, settled.length);
  manualOrdersInSetup = 0; targetRunBaseline = 0; lastSignalIndex = -Infinity;
  $('log').innerHTML = '<p class="empty">Today’s dashboard results were deleted. New test signals will appear here.</p>';
  updateReport(); updateDemoArmState();
};
$('clearActualPerformance').onclick = () => {
  if (!window.confirm('Clear the displayed order-performance figures from this browser? Your Deriv account, completed orders, and balance will not be changed.')) return;
  accountOrderHistory = []; lastSettledOrder = null; localStorage.removeItem('derivAccountOrders'); updateActualPerformance(); update();
  $('actualEntryTick').textContent = '—'; $('actualEntryDigit').textContent = 'Entry price: —'; $('actualExitTick').textContent = '—'; $('actualExitDigit').textContent = 'Settlement price: —'; $('actualOrderOutcome').textContent = 'NO ORDER'; $('actualOrderOutcome').className = ''; $('actualOrderSide').textContent = 'Waiting for an accepted order';
};
// Balance authorization replaces legacy momentum-reset pacing.
['stake','maxStake','dailyLoss','dailyProfitTarget','maxTrades','maxConsecutiveLosses','maxTradesPerSetup'].forEach(id=>$(id).addEventListener('input', updateRiskSummary)); updateRiskSummary();
updateActualPerformance();
renderLastSettledOrder(lastSettledOrder);
$('barrierPersistence').onchange=()=>{barrierEngine.reset();update();};
$('exportBarrierAudit').onclick=()=>{auditStage('export-state',{risk:diagnosticRisk()});const blob=new Blob([JSON.stringify({schema:'part-one-barrier-audit-v3',exportedAt:Date.now(),capacity:2000,droppedEvents:auditDropped,defaults:barrierEngine.config,experimentalConfidenceUsedForTrading:false,execution:executionView,records:barrierAudit},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='part-one-barrier-audit.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};

// Read-only presentation adapter. Rendering never advances analysis or submits orders.
if (typeof window !== 'undefined') import('./premium-dashboard.js').then(({mountDashboard}) => {
  mountDashboard(() => ({ticks,authoritativeAutoDecision,authoritativeDecisionState, sequence:liveTickNumber, analysis:barrierSnapshot,
    market:$('symbol').value, account:selectedAccount(), connected:demoConnected,
    feedLive:socket?.readyState===1 && isRunning, botMode, autoEnabled:autoEnabled&&parallelAutoReady,
    active:autoInFlight||manualOrderPending||autoContractIds.size>0,
    cooldown:0,
    awaitingReset:autoAwaitingReset, entryStability:entryStability.snapshot(), quotes, orders:accountOrderHistory,
    lastOrder:lastSettledOrder, flash:digitFlash, audit:barrierAudit,execution:executionView,executionTransportError,recheckExecution:()=>loadRecentOrder(true),
    minimum:null, persistence:Number($('barrierPersistence').value),
    stake:Number($('stake').value),tradability:tradabilityState()}));
mountBalanceScale({book:balanceBook,evidence:balanceEvidence,getExecution:()=>({decision:authoritativeAutoDecision,decisionState:authoritativeDecisionState,decisionError:authoritativeDecisionError,feed:tradabilityMarkets.connection,feedError:tradabilityMarkets.errors.get(balanceBook.inspectedMarket),market:$('symbol').value,mode:botMode,authorization:autoAuthorizationState,account:selectedAccount(),busy:autoInFlight||manualHttpPending||executionBlocked()}),execute:candidate=>{if(botMode!=='manual')return;useScannerMarket(candidate.market);return executeOrder(candidate.contractType,candidate);}});
}).catch(error => console.error('Dashboard presentation could not load',error));
// The main Start/Stop remains the only AutoBot switch. Arm switches do not start it.
for(const id of ['startAuto','stopAuto','manualMode']){
  const previous=$(id).onclick;
  $(id).onclick=(event)=>{if(id!=='startAuto')void revokeExecution();parallelAutoReady=false;previous?.(event);differEngineState.candidate=null;differEngineState.signal=null;if(id==='startAuto'&&!isRunning)startLive();if(isRunning||id!=='startAuto')void syncParallelControl();};
}
$('ouArm').onclick=()=>{overUnderEngineState.armed=!overUnderEngineState.armed;$('ouArm').setAttribute('aria-pressed',String(overUnderEngineState.armed));void syncParallelControl();renderParallel();};
$('differArm').onclick=()=>{differEngineState.arm(!differEngineState.armed);$('differArm').setAttribute('aria-pressed',String(differEngineState.armed));void syncParallelControl();renderParallel();};
$('accountSelector').addEventListener('change',()=>{void revokeExecution();autoEnabled=false;const armed=differEngineState.armed;differEngineState=new DifferEngine();differEngineState.arm(armed);void syncParallelControl();});
renderParallel();
setInterval(verifyAutoAuthorization,1500);
setInterval(async()=>{if(tradabilityMode!=='auto-block'||!isRunning||!demoConnected)return;try{const key=tradabilitySyncKey;if(!key){void syncTradability();return;}const response=await fetch('/api/tradability/status',{cache:'no-store'});if(!response.ok)throw Error('Server guard unavailable');const result=await response.json();if(key===tradabilitySyncKey)tradabilityServer=result;}catch{tradabilityServer={allowed:false,reason:'Server guard unavailable'};}},2000);
globalThis.addEventListener?.('pagehide',()=>{stopLiveFeed();void revokeExecution();});
loadAuthStatus();
