import {DigitBarrierEngine,extractLastDigit,proposalRequest} from './digit-barrier-engine.js';
import {liveDigitWheel} from './live-digit-wheel.js';
import {heatMap} from './premium-model.js';
import {diagnoseSnapshot} from './part-one-diagnostics.js';
import {DifferEngine} from './differ-engine.js';
import {TradabilityEngine,tradabilityBlocks} from './tradability-engine.js';
import {TradabilityMarkets} from './tradability-markets.js';
const tradabilityEvents=[];
const tradabilityMarkets=new TradabilityMarkets({onEvent:event=>{tradabilityEvents.push(event);if(tradabilityEvents.length>200)tradabilityEvents.shift();auditStage('tradability-state',event);}});
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
const tradabilityState=()=>({engine:tradabilityEngine,markets:tradabilityMarkets.snapshots(),connection:tradabilityMarkets.connection,mode:tradabilityMode,server:tradabilityServer,syncing:tradabilitySyncing,events:tradabilityEvents,
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
  }catch(error){if(runId===parallelRunId){parallelAutoReady=false;autoAuthorizationState='AUTO_ERROR';autoLastError=error.message;}}
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
  try{
    const response=await fetch('/api/order',{method:'POST',headers:{'content-type':'application/json'},signal:globalThis.AbortSignal?.timeout?.(45000),body:JSON.stringify({attemptId,browserAutoState:autoAuthorizationState,tradabilityMode,executionSessionId:parallelRunId,decisionId:attemptId,signalAt:executionNow(),gatePassed:true,runId:parallelRunId,armed:true,mode:'auto',type:'DIGITDIFF',barrier:signal.barrier,symbol:$('symbol').value,stake,accountId:account.accountId,accountType:'demo',riskLimits:demoRiskLimits(),strategyEvidence:{...signal,jumpDigit:ticks.at(-1)?.digit}})});
    const result=await response.json();
    if(!response.ok){
      // Explicit pre-purchase rejections are safe; transport failures remain locked for reconciliation.
      if(response.status===400||response.status===403||result.riskCode||['INVALID_PROPOSAL','AUTO_STOPPED','EXECUTION_BUSY'].includes(result.executionCode))engine.executionLock=false;
      throw Error(result.error||'DIFFER request failed');
    }
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
const executionRequest=trace=>({attemptId:trace.attemptId,decisionId:trace.decisionId,strategyEvidence:{source:'client strategy, not broker authorization',selected:barrierSnapshot?.selected?.type??null,checks:barrierSnapshot?.selected?.checks??[]}});
const auditStage = (stage,detail) => {
  const event={eventId:++auditEventSequence,time:Date.now(),sequence:liveTickNumber,decisionId:currentDecisionId,market:$('symbol').value,stage,...detail};
  barrierAudit.push(event);
  if(barrierAudit.length>2000){barrierAudit.shift();auditDropped++;}
  return event.eventId;
};
const diagnosticRisk=()=>({connected:demoConnected,accountType:selectedAccount()?.accountType??null,mode:botMode,armed:autoEnabled,
  pending:autoInFlight||manualOrderPending||autoContractIds.size>0,awaitingMomentumReset:autoAwaitingReset,
  cooldownRemaining:Number.isFinite(lastAutoSignalTick)?Math.max(0,selectedAutoCooldown()-(liveTickNumber-lastAutoSignalTick)):0,
  configuredCooldown:selectedAutoCooldown(),stake:Number($('stake').value),maximumStake:Number($('maxStake').value),
  realAutoEnabled:false,dailyAccountLimits:'Demo server session ledger; not account-wide daily limits',requestedDemoLimits:demoRiskLimits()});
const beginOrderAudit=(type,mode,stake)=>{
  const decisionId=currentDecisionId;
  const attemptId=globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random().toString(36).slice(2)}`;
  liveDigitWheel.register(attemptId);
  auditStage('signal-detected',{attemptId,decisionId,type,mode});
  auditStage('condition-gate',{attemptId,decisionId,checks:barrierSnapshot?.candidates.find(c=>c.type===(type==='DIGITOVER'?'OVER':'UNDER'))?.checks??[],mode});
  const requestId=auditStage('proposal-request',{attemptId,decisionId,type,mode,symbol:$('symbol').value,stake,risk:diagnosticRisk(),
    request:{contract_type:type,barrier:type==='DIGITOVER'?'1':'8',duration:1,duration_unit:'t',basis:'stake'},
    note:'Client order request; server determines actual account currency and proposal'});
  return {decisionId,requestId,attemptId};
};
const acceptedOrderAudit=(trace,result)=>{
  auditStage('proposal-validation',{...trace,validation:result.proposalValidation??null,status:result.proposalValidation?.validated?'validated':'not reported'});
  auditStage('execution-accepted',{...trace,contractId:result.contractId,entryTick:result.entryTick,buyPrice:result.buyPrice,currency:result.currency});
  orderDecisionIds.set(result.contractId,trace);if(orderDecisionIds.size>250)orderDecisionIds.delete(orderDecisionIds.keys().next().value);
};
const analyzeBoth = () => {
  const persistence=Math.max(1,Math.min(100,Math.floor(Number($('barrierPersistence').value)||1)));
  const snapshot=barrierEngine.analyze(ticks,{context:strengthContext(),sequence:liveTickNumber,minimumConfidence:Math.max(0,Math.min(100,Number($('minimum').value)||0)),persistence});
  if(snapshot!==barrierSnapshot){
    barrierSnapshot=snapshot;
    currentDecisionId=`${snapshot.context}:${snapshot.sequence}:${auditEventSequence+1}`;
    const latest=ticks.at(-1);
    auditStage('candidate-evaluation',{...diagnoseSnapshot(snapshot,{timestamp:latest?.time??null,market:$('symbol').value,
      quote:latest?.price??null,lastDigit:latest?.digit??null,rollingWindow:Number($('window').value)||200,risk:diagnosticRisk(),
      config:{...barrierEngine.config,minimumConfidence:Number($('minimum').value),persistence}}),legacy:calculateSignal(ticks)});
    $('barrierDiagnostics').textContent=snapshot.candidates.map(c=>`${c.label}: support ${(c.observed*100).toFixed(1)}% | Momentum ${c.momentum===null?'waiting':c.momentum.toFixed(2)+' pp'} | Zone ${c.zone?'PASS':'FAIL'} | Stability ${c.stability} | Score ${c.score} | Persistence ${c.persistence} | Confidence ${c.confidence} (score) | Quality ${c.quality} | Gate ${c.gatePercent.toFixed(0)}% | ${c.ready?'READY':c.checks.filter(x=>!x.pass).map(x=>x.name).join(', ')}`).join('\n');
  }
  return snapshot;
};
let ticks = [], distributionDigits = [], socket, distributionTimer, isRunning = false, lastSignalIndex = -Infinity, liveTickNumber = 0;
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
  if (!saved?.length) return false;
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
  const label = type==='DIGITDIFF'?`DIFFER ${result.barrier}`:type === 'DIGITOVER' || type === 'OVER' ? 'OVER 1' : 'UNDER 8';
  lastSettledOrder = { ...record, lifecycle:record, label, source, time:Date.now() };
  $('entryExecutionStatus').textContent = `ORDER ENTERED · ${label} · ${source} · entry number ${record.entryDigit??'pending from Deriv'} · waiting for settlement · contract ${record.contractId}`;
  $('entryExecutionStatus').className = 'entryExecutionStatus';
  clearTimeout(digitFlashTimer); digitFlash = { entryDigit:lastSettledOrder.entryDigit }; digitFlashTimer = setTimeout(() => { digitFlash = null; update(); }, 800);
  renderLastSettledOrder(lastSettledOrder); update();
};
const showContractResult = (type, result, source) => {
  if(result.lifecycle?.accountId&&result.lifecycle.accountId!==selectedAccount()?.accountId)return;
  liveDigitWheel.settle(result);
  const record=liveDigitWheel.contracts.accept(result);
  if(!record||record.state!=='settled')return;
  const alreadyReported=displayedContractIds.has(String(result.contractId));
  displayedContractIds.add(String(result.contractId));
  if(displayedContractIds.size>1000)displayedContractIds.delete(displayedContractIds.values().next().value);
  auditStage('order-result',{...(orderDecisionIds.get(result.contractId)||{decisionId:null}),contractId:result.contractId,type,source,
    status:result.status,entryTick:result.entryTick,exitTick:result.exitTick,profit:result.profit,payout:result.payout,buyPrice:result.buyPrice});
  const label = type==='DIGITDIFF'?`DIFFER ${result.barrier}`:type === 'DIGITOVER' || type === 'OVER' ? 'OVER 1' : 'UNDER 8';
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
const autoResetThreshold = () => Math.max(0, Number($('minimum').value || 65) - 4);
const updateAutoIndicator = () => {
  const indicator = $('autoBotIndicator');
  if (!indicator) return;
  if (botMode !== 'auto' || !autoEnabled) {
    indicator.textContent = 'AUTO BOT OFF'; indicator.className = 'autoBotIndicator'; return;
  }
  if(!parallelAutoReady){indicator.textContent=autoAuthorizationState.replaceAll('_',' ');indicator.className='autoBotIndicator negative';return;}
  if(executionBlocked()){indicator.textContent=`AUTO BOT · ${executionView.state.replaceAll('_',' ')}`;indicator.className='autoBotIndicator negative';return;}
  if (autoAwaitingReset && liveTickNumber - lastAutoSignalTick >= selectedAutoCooldown()) {
    indicator.textContent = `AUTO BOT PAUSED · RESET AT ${autoResetThreshold()}%`;
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
  autoAwaitingReset = momentumResetEnabled();
  lastAutoSignalTick = liveTickNumber;
  updateCooldownMonitor();
  updateAutoState();
};
const updateCooldownMonitor = () => {
  const monitor = $('cooldownMonitor'), note = $('cooldownMonitorNote');
  if (!Number.isFinite(lastAutoSignalTick)) {
    monitor.textContent = autoAwaitingReset ? 'RESET MODE' : 'READY'; monitor.className = '';
    note.textContent = autoAwaitingReset ? `Waiting for confidence to reach ${autoResetThreshold()}% or lower.` : `Waiting for the next qualifying Auto signal. Cooldown is set to ${selectedAutoCooldown()} ticks.`;
    updateAutoIndicator(); return;
  }
  const cooldown = selectedAutoCooldown(), elapsed = Math.max(0, liveTickNumber - lastAutoSignalTick);
  if (elapsed >= cooldown) {
    lastAutoSignalTick = -Infinity;
    monitor.textContent = autoAwaitingReset ? 'RESET MODE' : 'READY'; monitor.className = 'positive';
    note.textContent = autoAwaitingReset ? `Cooldown complete. Waiting for confidence to reach ${autoResetThreshold()}% or lower.` : `Cooldown complete after ${cooldown} ticks. Waiting for the next qualifying Auto signal.`;
    updateAutoIndicator(); return;
  }
  monitor.textContent = `COOLDOWN · ${elapsed}/${cooldown}`; monitor.className = 'regime-consolidation';
  note.textContent = `${cooldown - elapsed} tick${cooldown - elapsed === 1 ? '' : 's'} remaining. New Auto orders are paused until the countdown finishes.`;
  updateAutoIndicator();
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
// User-defined digit-jump filter: five quiet transitions clear a large jump.
const digitStability = (history) => {
  const recent = history.slice(-6);
  for (let i = recent.length - 1; i > 0; i--) {
    if (Math.abs(recent[i].digit - recent[i - 1].digit) >= 7) {
      return { unstable:true, from:recent[i - 1].digit, to:recent[i].digit,
        remaining:5 - (recent.length - 1 - i) };
    }
  }
  return { unstable:false, remaining:0 };
};
const digitPercentageGate = (type, history = ticks) => {
  if (!['OVER', 'UNDER'].includes(type)) return {allowed:false, note:'Choose OVER 1 or UNDER 8.'};
  if (history.length < 50) return {allowed:false, note:'Collect at least 50 ticks for the digit percentage check.'};
  const c = counts(history), n = history.length;
  const low = type === 'OVER' ? [0,1] : [8,9];
  const allowed = low.every(d => c[d]*100 <= n*8);
  return {allowed, note:`${type === 'OVER' ? 'OVER 1' : 'UNDER 8'} needs ${low.join(' and ')} each ≤8%. No opposite-digit minimum. Current: ${low.map(d => `${d}: ${(c[d]/n*100).toFixed(2)}%`).join(', ')}`};
};
const qualifiesForLiveSupport = (signal, minimum) => Boolean(
  signal && ['OVER', 'UNDER'].includes(signal.type) &&
  signal.confidence >= minimum && signal.observed >= 0.90 &&
  selectedRateChange(signal) !== null && selectedRateChange(signal) >= 0 && digitPercentageGate(signal.type).allowed
);
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
  const analysis=analyzeBoth();
  const legacy=calculateSignal(ticks);
  const signal = analysis.selected ? {...analysis.selected,options:legacy?.options} : legacy;
  const minimum = Number($('minimum').value || 65);
  const stability = digitStability(ticks);
  if (stability.unstable) {
    $('entryStrength').textContent = 'UNSTABLE';
    $('entryStrength').className = 'negative';
    $('entryStrengthNote').textContent = `Digit jump ${stability.from} → ${stability.to}. Entries blocked: ${stability.remaining} ticks without a jump of 7+ required.`;
    return;
  }
  // Rearm before the normal signal gate. Otherwise a score below the minimum
  // returns early and an Auto Bot paused for a fresh momentum reset never wakes.
  if (autoAwaitingReset && autoContractIds.size === 0 && liveTickNumber - lastAutoSignalTick >= selectedAutoCooldown() && signal && signal.confidence <= autoResetThreshold()) {
    autoAwaitingReset = false;
    autoMomentumTrades = 0;
    updateCooldownMonitor();
    $('autoStatus').textContent = `Confidence reset to ${signal?.confidence ?? 0}%. Auto Bot is rearmed and waiting for the next LIVE SUPPORT entry.`;
    updateAutoIndicator();
  }
  const suggestedEntryIsActive = Boolean(signal?.type && signal.confidence >= minimum);
  if (!signal || !quotes.over || !quotes.under || !suggestedEntryIsActive) {
    $('entryStrength').textContent = 'WAITING'; $('entryStrength').className = '';
    $('entryStrengthNote').textContent = signal && !signal.type ? 'OVER 1 and UNDER 8 have equal sample strength. Waiting for a stronger side.' : signal && !suggestedEntryIsActive ? `Suggested Entry is not active: ${signal.label} score ${signal.confidence}% is below your ${minimum}% minimum. Strength waits until Suggested Entry gives a trade.` : 'It will assess the same selected entry after live data and pricing are available.';
    return;
  }
  const change = selectedRateChange(signal);
  const changeText = change === null ? 'Waiting for two live samples' : `${change > 0 ? '+' : ''}${change.toFixed(2)} percentage points this tick`;
  const displayedRate = (signal.observed * 100).toFixed(1);
  const digitGate = digitPercentageGate(signal.type);
  const liveSupport = Boolean(analysis.selected) && qualifiesForLiveSupport(signal, minimum);
  const label = !digitGate.allowed ? 'DIGIT FILTER' : change !== null && change < 0 ? 'DETERIORATING' : liveSupport ? 'LIVE SUPPORT' : 'WAITING';
  $('entryStrength').textContent = label;
  $('entryStrength').className = label === 'STRONG' || label === 'LIVE SUPPORT' ? 'positive' : label === 'CAUTION' ? 'regime-consolidation' : 'negative';
  $('entryStrengthNote').textContent = `${signal.label}: ${changeText} · ${displayedRate}% sample matches. ${label === 'DETERIORATING' ? 'Falling support: automatic entry blocked.' : liveSupport ? 'Not falling; confidence and 90% sample gates met.' : 'Waiting for live change, minimum confidence and 90% sample matches.'}`;
  if (!digitGate.allowed) $('entryStrengthNote').textContent = digitGate.note;
  if (label === 'LIVE SUPPORT' && botMode === 'auto' && autoEnabled && !autoAwaitingReset) maybeAutoOrder(signal);
};
const updatePricing = () => {
  const render = (quote, priceId, breakEvenId) => {
    if (!quote) { $(priceId).textContent = '—'; $(breakEvenId).textContent = 'No current quote'; return; }
    const breakEven = quote.ask / quote.payout;
    $(priceId).textContent = `$${quote.ask.toFixed(2)} → $${quote.payout.toFixed(2)}`;
    $(breakEvenId).textContent = `Break-even win rate ${(breakEven * 100).toFixed(1)}%`;
  };
  render(quotes.over, 'overPrice', 'overBreakEven'); render(quotes.under, 'underPrice', 'underBreakEven');
  const signal = calculateSignal(ticks);
  if (!signal?.type || !quotes.over || !quotes.under) { $('pricingGate').textContent = 'WAIT'; $('pricingGate').className = ''; $('pricingNote').textContent = signal && !signal.type ? 'Both sides have equal sample strength.' : 'Need live quotes and at least 50 ticks'; updateEntryStrength(); return; }
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
  updateSideScores(calculateSignal(ticks));
  if (typeof updateDemoArmState === 'function') updateDemoArmState();
  updateCooldownMonitor();
  const c = counts(ticks), n = ticks.length, displayed = ticks.length, latest = ticks.at(-1);
  $('sample').textContent = n; $('sampleNote').textContent = n < 50 ? `Need ${50-n} more ticks` : `Rolling last ${n} ticks`;
  if(latest){ $('price').textContent = latest.price; $('tickTime').textContent = new Date(latest.time * 1000).toLocaleTimeString(); }
  if(latest) $('priceDigitCursor').textContent = `Live ${$('symbol').value.trim()} price: ${latest.price} · last digit ${latest.digit}`;
  $('digits').innerHTML = c.map((value,digit) => {
    return `<div class="digit"><b>${digit}</b><span>${displayed ? (value/displayed*100).toFixed(1) : '0.0'}%</span></div>`;
  }).join('');
  if(n < 50) { showSignal(null); updateEntryStrength(); liveDigitWheel.setLive(latest, heatMap(ticks), $('symbol').value); return; }
  const candidate = calculateSignal(ticks);
  const confidence = candidate.confidence;
  const threshold = Number($('minimum').value);
  const selected=analyzeBoth().selected;
  showSignal(selected ? {...selected,options:candidate.options} : null, candidate, confidence);
  if(!selected)$('signalNote').textContent='No candidate passes every analysis condition. See the two-candidate diagnostics for failed checks.';
  updatePricing();
  // Strategy/authorization/request dispatch above must never wait for wheel rendering.
  liveDigitWheel.setLive(latest, heatMap(ticks), $('symbol').value);
};
const showSignal = (signal, candidate, confidence) => {
  if(!signal){ $('signal').textContent = 'NO SIGNAL'; $('signal').className=''; $('signalNote').textContent = candidate ? `${candidate.type ? `${candidate.label} score ${confidence}% is below your threshold` : 'No stronger side'} · OVER 1 ${(candidate.options.over1.observed*100).toFixed(1)}% · UNDER 8 ${(candidate.options.under8.observed*100).toFixed(1)}% sample rates` : 'Collecting data'; $('executeOver').classList.remove('suggested'); $('executeUnder').classList.remove('suggested'); return; }
  $('signal').textContent = signal.label; $('signal').className = 'positive'; $('signalNote').textContent = `Analysis score ${signal.confidence}% · OVER 1 sample rate ${(signal.options.over1.observed*100).toFixed(1)}% · UNDER 8 sample rate ${(signal.options.under8.observed*100).toFixed(1)}%`;
  $('executeOver').classList.toggle('suggested', signal.type === 'OVER'); $('executeUnder').classList.toggle('suggested', signal.type === 'UNDER');
};
const addTick = (price, epoch=Math.floor(Date.now()/1000), pipSize) => {
  let parsed;
  try { parsed=extractLastDigit(price,pipSize); } catch(error) { auditStage('invalid-tick',{reason:error.message}); return; }
  liveTickNumber++;
  const raw=parsed.quote,digit=parsed.digit;
  if(Number.isInteger(digit)){
    const tick = {price:raw,time:epoch,digit};
    ticks.push(tick);
    // Advance only on price ticks, never on quote responses or UI redraws.
    // Compare each side with itself, even when the suggested side changes.
    const context = strengthContext();
    const current = calculateSignal(ticks.slice(-(Number($('window').value) || 200)));
    const previous = strengthSample?.context === context ? strengthSample.signal : null;
    strengthSample = { context, signal:current, changes:sampleRateChanges(previous, current) };
    if (!distributionDigits.length) distributionDigits = [tick];
    if (!distributionTimer) distributionTimer = setTimeout(() => { distributionDigits = ticks.slice(); distributionTimer = undefined; update(); }, 5000);
    const differSignal=differEngineState.tick(ticks.slice(-(Number($('window').value)||200)),{context:strengthContext()+':'+selectedAccount()?.accountId,sequence:liveTickNumber,running:autoEnabled&&botMode==='auto',cooldownTicks:selectedAutoCooldown()});
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
const classifyMarket = (symbol, rawPrices) => {
  const prices = rawPrices.map(Number).filter(Number.isFinite);
  if (prices.length < 20) return { symbol, regime:'UNAVAILABLE', score:0, note:'Not enough recent prices' };
  const measure = (series) => {
    let movement = 0;
    for (let i = 1; i < series.length; i++) movement += Math.abs(series[i] - series[i - 1]);
    const net = series.at(-1) - series[0];
    return { net, efficiency: movement ? Math.abs(net) / movement : 0 };
  };
  const full = measure(prices);
  const recent = measure(prices.slice(-20));
  // Prefer a sustained recent move when the older candles hide a new trend.
  const bestWindow = recent.efficiency >= full.efficiency ? recent : full;
  const direction = bestWindow.net >= 0 ? 'UPTREND' : 'DOWNTREND';
  const trending = bestWindow.efficiency >= 0.22 && Math.abs(bestWindow.net) > 0;
  const score = Math.round(bestWindow.efficiency * 100);
  const windowNote = bestWindow === recent ? 'recent 20-minute movement' : 'recent 50-minute movement';
  return { symbol, regime: trending ? direction : 'CONSOLIDATION', score, note: trending ? `${direction === 'UPTREND' ? 'Up' : 'Down'} movement is consistent in the ${windowNote}` : 'Price movement is choppy / sideways across both scan windows' };
};
const scannerSampleSize = () => Math.max(50, Math.min(500, Number($('window').value || 50)));
const historyToTicks = (prices = [], times = []) => prices.map((price, index) => {
  const raw = String(price);
  const digit = Number(raw.at(-1));
  return Number.isInteger(digit) ? { price:raw, time:Number(times[index]) || Math.floor(Date.now() / 1000), digit } : null;
}).filter(Boolean);
const fetchMarketHistory = (symbol) => new Promise((resolve) => {
  let done = false;
  const finish = (value) => { if (done) return; done = true; clearTimeout(timeout); try { ws.close(); } catch {} resolve(value); };
  let ws;
  const timeout = setTimeout(() => finish(classifyMarket(symbol, [])), 8000);
  try {
    ws = new WebSocket('wss://api.derivws.com/trading/v1/options/ws/public');
    ws.onopen = () => ws.send(JSON.stringify({ ticks_history:symbol, count:scannerSampleSize(), end:'latest', style:'ticks' }));
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.error) return finish({ symbol, regime:'UNAVAILABLE', score:0, note:data.error.message || 'Market unavailable' });
      if (data.candles) {
        const prices = data.candles.map((candle) => candle.close);
        saveMarketTicks(symbol, historyToTicks(prices, data.candles.map((candle) => candle.epoch)));
        finish(classifyMarket(symbol, prices));
      } else if (data.history?.prices) {
        const prices = data.history.prices;
        saveMarketTicks(symbol, historyToTicks(prices, data.history.times));
        finish(classifyMarket(symbol, prices));
      }
    };
    ws.onerror = () => finish({ symbol, regime:'UNAVAILABLE', score:0, note:'Could not read this market' });
  } catch { finish({ symbol, regime:'UNAVAILABLE', score:0, note:'Could not open market scan' }); }
});
const renderMarketScan = () => {
  const current = lastMarketScan.find((result) => result.symbol === $('symbol').value.trim());
  const eligible = lastMarketScan.filter((result) => result.regime === 'UPTREND' || result.regime === 'DOWNTREND').sort((a,b) => b.score - a.score);
  const consolidating = lastMarketScan.filter((result) => result.regime === 'CONSOLIDATION').sort((a,b) => b.score - a.score);
  const best = eligible[0] ?? consolidating[0];
  const bestIsTrend = Boolean(eligible[0]);
  scannerRecommendedSymbol = best?.symbol ?? null;
  $('currentRegime').textContent = current?.regime ?? 'WAITING';
  $('currentRegime').className = current?.regime === 'CONSOLIDATION' ? 'regime-consolidation' : current?.regime === 'UNAVAILABLE' ? 'regime-unavailable' : current ? 'regime-trend' : '';
  $('currentRegimeNote').textContent = current ? `${current.note} · strength ${current.score}% from recent 1-minute candles` : 'Start a scan to classify the selected market.';
  $('scannerRecommendation').textContent = best ? `${best.symbol} · ${best.regime}` : 'WAIT — UNAVAILABLE';
  $('scannerRecommendation').className = best ? (bestIsTrend ? 'regime-trend' : 'regime-consolidation') : 'regime-unavailable';
  $('scannerRecommendationNote').textContent = best ? (bestIsTrend ? `Strongest scanner result: ${best.score}% trend strength. This does not predict the next digit.` : `Every available market is consolidating. ${best.symbol} has the highest relative movement score at ${best.score}%, so it is the selected fallback—not a trend signal.`) : 'No market data was available for comparison.';
  $('useScannerMarket').disabled = !best;
  $('useScannerMarket').textContent = best ? `Use ${best.symbol}` : 'Use recommended market';
  $('marketScanResults').innerHTML = lastMarketScan.map((result) => `<article><p>${result.symbol}</p><strong class="${result.regime === 'CONSOLIDATION' ? 'regime-consolidation' : result.regime === 'UNAVAILABLE' ? 'regime-unavailable' : 'regime-trend'}">${result.regime}</strong><small>Strength ${result.score}% · ${result.note}</small></article>`).join('');
  return { best, bestIsTrend };
};
const useScannerMarket = (symbol) => {
  if (!symbol || $('symbol').value.trim() === symbol) return;
  const previous = $('symbol').value.trim();
  saveMarketTicks(previous);
  $('symbol').value = symbol;
  const restored = restoreMarketTicks(symbol);
  if (!restored) { ticks = []; distributionDigits = []; }
  quotes.over = null; quotes.under = null;
  $('scannerStatus').textContent = restored ? `Switched to ${symbol} with its saved ${ticks.length}-tick scanner memory.` : `Switched to ${symbol}. Waiting for its scanner memory to load.`;
  update();
  startLive();
};
const scanMarkets = async () => {
  if (marketScanBusy) return;
  marketScanBusy = true; $('scanMarkets').disabled = true; $('scannerStatus').textContent = 'Checking recent price movement across markets…';
  const currentSymbol = $('symbol').value.trim();
  const symbols = [...new Set([currentSymbol, ...scannerSymbols].filter(Boolean))];
  lastMarketScan = await Promise.all(symbols.map(fetchMarketHistory));
  const recommendation = renderMarketScan();
  const best = recommendation.best;
  const canSwitch = botMode === 'auto' && autoEnabled && $('autoSwitchMarket').checked && best;
  if (canSwitch && best.symbol !== currentSymbol) {
    $('scannerStatus').textContent = `Auto bot switched from ${currentSymbol} to ${best.symbol} after the scanner selected the strongest ${recommendation.bestIsTrend ? 'trend' : 'consolidation fallback'}.`;
    useScannerMarket(best.symbol);
  } else if (botMode === 'auto' && $('autoSwitchMarket').checked && !best) {
    $('scannerStatus').textContent = 'Auto switching did not run because no market data was available.';
  } else if (best) {
    $('scannerStatus').textContent = `Recommendation: ${best.symbol} (${best.regime}, ${best.score}% strength). Manual mode leaves the choice with you.`;
  } else $('scannerStatus').textContent = 'No market data was available for a recommendation.';
  marketScanBusy = false; $('scanMarkets').disabled = false;
};
const syncScannerTimer = () => {
  clearInterval(scannerTimer); scannerTimer = undefined;
  if (botMode === 'auto' && autoEnabled) scannerTimer = setInterval(scanMarkets, 30000);
};
let liveFeedSymbol = null;
const startLive = () => {
  const symbol=$('symbol').value.trim();
  // Mode/Start clicks must not replace an open (or connecting) subscription.
  if(liveFeedSymbol===symbol&&socket&&(socket.readyState===0||socket.readyState===1))return;
  // Preserve same-market history across short reconnects. push() still resets
  // on an actual data gap, invalid quote, or change of market.
  tradabilityMarkets.start();
  tradabilitySyncKey=null;tradabilityServer=null;
  strengthSample = null;
  if (botMode === 'manual') { autoEnabled = false; syncScannerTimer(); }
  liveFeedSymbol=symbol; isRunning=false; if(socket) socket.close();
  try { socket=new WebSocket('wss://api.derivws.com/trading/v1/options/ws/public'); const feedSocket=socket;socket.onopen=()=>{if(socket!==feedSocket)return;isRunning=true;void syncTradability();if(autoEnabled)void syncParallelControl(); socket.send(JSON.stringify({ticks:symbol,subscribe:1})); refreshPricing(); $('connection').textContent=`LIVE · ${symbol}`; $('connection').className='pill positive';}; socket.onmessage=e=>{if(socket!==feedSocket)return;const data=JSON.parse(e.data); if(data.error){logger(`<span class="negative">Feed error: ${data.error.message}</span>`); return;} if(data.tick&&data.tick.symbol===symbol)addTick(data.tick.quote,data.tick.epoch,data.tick.pip_size); if(data.proposal){const kind=data.echo_req?.contract_type === 'DIGITOVER' ? 'over' : 'under'; quotes[kind]={ask:Number(data.proposal.ask_price), payout:Number(data.proposal.payout)}; updatePricing();}}; socket.onerror=()=>{if(socket!==feedSocket)return;isRunning=false;void revokeExecution();$('connection').textContent='LIVE FEED ERROR';$('connection').className='pill negative';logger('<span class="negative">Could not connect to the live Deriv feed. No simulated prices will be shown.</span>');}; socket.onclose=()=>{if(socket!==feedSocket)return;if(socket?.readyState!==1){isRunning=false;void revokeExecution();}if(!isRunning){$('connection').textContent='DISCONNECTED';$('connection').className='pill negative';}};
  } catch { $('connection').textContent='LIVE FEED ERROR'; $('connection').className='pill negative'; }
};
const backtest = () => {
  const duration = Number($('duration').value) || 1, windowSize = Number($('window').value) || 200, threshold = Number($('minimum').value), cooldown = Number($('cooldown').value) || 10;
  if (ticks.length < 50 + duration) { logger('<span class="negative">Collect at least 51 ticks before running a backtest.</span>'); return; }
  let last = -Infinity; const results = [];
  for (let entry = 50; entry + duration < ticks.length; entry++) {
    const signal = calculateSignal(ticks.slice(Math.max(0, entry-windowSize), entry));
    if (!signal?.type || signal.confidence < threshold || entry-last < cooldown) continue;
    const exit = ticks[entry + duration].digit;
    results.push(signal.type === 'OVER' ? exit > signal.barrier : exit < signal.barrier); last = entry;
  }
  const wins = results.filter(Boolean).length, rate = results.length ? (wins / results.length * 100).toFixed(1) : '—';
  logger(`<span><b>BACKTEST COMPLETE</b> · ${ticks.length} collected ticks · ${results.length} eligible signals</span><span><b class="${Number(rate) >= 50 ? 'positive' : 'negative'}">${rate}% win rate</b></span>`);
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
$('start').onclick=startLive; $('pricing').onclick=refreshPricing; $('backtest').onclick=backtest; $('stop').onclick=()=>{void revokeExecution();isRunning=false;clearTimeout(distributionTimer);distributionTimer=undefined;if(socket)socket.close();$('connection').textContent='STOPPED';$('connection').className='pill muted';};
['window','minimum','duration','cooldown'].forEach(id=>$(id).addEventListener('change',()=>{ update(); updateReport(); })); updateReport(); update();
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
  const unstable = digitStability(ticks).unstable;
  const manualReady = accountReady && botMode === 'manual' && !manualOrderPending && !manualHttpPending && !executionBlocked() && !unstable;
  $('executeOver').disabled = !manualReady; $('executeUnder').disabled = !manualReady;
  $('demoOrderStatus').textContent = !demoConnected ? 'Connect your Deriv account first.' : (manualOrderPending ? 'Current order is waiting for its one-tick settlement. Manual buttons will return immediately after settlement.' : (realSelected && !realTradingEnabled ? 'Real account is connected for later. Real-money ordering is disabled by the server setting.' : (accountReady ? `Ready for one order of ${money(stake)}.` : 'Select an account and enter a valid stake.')));
  if(executionBlocked())$('demoOrderStatus').textContent=`Execution: ${executionView.state.replaceAll('_',' ')}. ${executionView.last?.error?.message??executionView.errorSummary??'Monitoring the accepted request.'}`;
};
const executeOrder = async (type) => {
  if(tradabilityBlocked()){$('demoOrderStatus').textContent='NEW ENTRY BLOCKED · '+(tradabilityServer?.reason??tradabilityEngine.snapshot?.state??'COLLECTING DATA');auditStage('tradability-block',{mode:'manual',type});return;}
  if(botMode!=='manual')return;
  if(manualOrderPending||manualHttpPending||executionBlocked()||differEngineState.executionLock){trackRecentOrder();return;}
  auditStage('manual-attempt',{type,risk:diagnosticRisk(),note:'Manual path uses existing guards, not automatic READY gate'});
  const digitGate = digitPercentageGate(type === 'DIGITOVER' ? 'OVER' : 'UNDER');
  if (!digitGate.allowed) { $('demoOrderStatus').textContent = `NO ORDER · ${digitGate.note}`; return; }
  if (digitStability(ticks).unstable) {
    $('autoStatus').textContent = 'UNSTABLE digit movement. New entries are blocked until five ticks pass without a large jump.';
    updateDemoArmState();
    return;
  }
  const stake = Number($('stake').value || 0), account = selectedAccount();
  if (!demoConnected || !account || !Number.isFinite(stake) || stake <= 0) return updateDemoArmState();
  const title = type === 'DIGITOVER' ? 'OVER 1' : 'UNDER 8';
  if (account.accountType === 'real' && !window.confirm(`Place one ${title} real-money order for ${money(stake)}?`)) return;
  const button = type === 'DIGITOVER' ? $('executeOver') : $('executeUnder'); manualOrderPending = true; $('executeOver').disabled = true; $('executeUnder').disabled = true; $('demoOrderStatus').textContent = 'ORDER REQUEST SENT · Waiting for Deriv to accept it…';
  const trace=beginOrderAudit(type,'manual',stake);
  manualHttpPending=true;
  try {
    const intentResponse=await fetch('/api/execution/manual-intent',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pageId:executionPageId,intent:'manual-click',attemptId:trace.attemptId,accountId:account.accountId,type})});
    const intent=await intentResponse.json();if(!intentResponse.ok)throw Error(intent.error||'Manual authorization failed');
    const submitted = fetch('/api/order', { method:'POST', headers:{'content-type':'application/json'}, signal:globalThis.AbortSignal?.timeout?.(45000), body:JSON.stringify({ ...executionRequest(trace),tradabilityMode,executionSessionId:intent.executionSessionId,armed:true, type, symbol:$('symbol').value.trim(), stake, accountId:account.accountId, accountType:account.accountType, realConfirmed:$('realConfirm').checked,mode:'manual',riskLimits:demoRiskLimits() }) });
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
  if(analyzeBoth().selected?.type!==signal.type)return;
  auditStage('risk-manager',{type:signal.type,connected:demoConnected,mode:botMode,armed:autoEnabled,pending:autoInFlight||autoContractIds.size>0,reset:autoAwaitingReset,cooldown:Math.max(0,selectedAutoCooldown()-(liveTickNumber-lastAutoSignalTick))});
  if (digitStability(ticks).unstable) return;
  if (!qualifiesForLiveSupport(signal, Number($('minimum').value || 65))) return;
  const account = selectedAccount(), stake = Number($('stake').value || 0), currentTick = liveTickNumber;
  if (botMode !== 'auto' || !autoEnabled || autoAwaitingReset || autoInFlight || autoContractIds.size > 0 || executionBlocked() || !demoConnected || account?.accountType !== 'demo') return;
  const maximum = Number($('maxStake').value || 5000);
  if (!Number.isFinite(stake) || stake <= 0 || stake > maximum) {
    autoLastError = `Enter a stake between $0.01 and ${money(maximum)} before Auto Bot can send an order.`;
    updateAutoState();
    return;
  }
  const ticksSinceLast = currentTick - lastAutoSignalTick;
  if (ticksSinceLast < selectedAutoCooldown()) return;
  autoInFlight = true; autoLastError = ''; $('autoStatus').textContent = `LIVE SUPPORT confirmed for ${signal.label}. Sending order…`;
  const trace=beginOrderAudit(signal.type==='OVER'?'DIGITOVER':'DIGITUNDER','auto',stake);
  try {
    const response = await fetch('/api/order', { method:'POST', headers:{'content-type':'application/json'}, signal:globalThis.AbortSignal?.timeout?.(45000), body:JSON.stringify({ ...executionRequest(trace),browserAutoState:autoAuthorizationState,tradabilityMode,executionSessionId:parallelRunId,signalAt:executionNow(),gatePassed:barrierSnapshot?.selected?.ready===true,runId:parallelRunId,mode:'auto', armed:true, type:signal.type === 'OVER' ? 'DIGITOVER' : 'DIGITUNDER', symbol:$('symbol').value.trim(), stake, accountId:account.accountId, accountType:'demo', realConfirmed:false,riskLimits:demoRiskLimits() }) });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error || 'Auto order was not accepted.'),{riskCode:result.riskCode});
    acceptedOrderAudit(trace,result);
    lastAutoSignalTick = liveTickNumber;
    autoMomentumTrades += 1;
    autoContractIds.add(result.contractId);
    autoAwaitingReset = momentumResetEnabled();
    $('autoStatus').textContent = `ORDER ENTERED on digit ${result.lifecycle?.entryDigit??'pending from Deriv'}. Waiting for the next tick to settle. Auto bot will pause for ${selectedAutoCooldown()} ticks after this order.`;
    showOrderEntry(signal.type, result, 'Auto bot'); trackRecentOrder();
    updateCooldownMonitor();
  } catch (error) {
    // A rejected request must not silently turn the bot off. Keep it armed and
    // show the exact reason so the next LIVE SUPPORT signal can retry.
    autoLastError = error.message || 'Deriv did not accept the Auto Bot order.';
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
  else if (autoAwaitingReset) $('autoStatus').textContent = `Momentum run complete. Waiting for confidence to reset to ${autoResetThreshold()}% or lower before Auto Bot rearms.`;
  else if (autoInFlight) $('autoStatus').textContent = 'LIVE SUPPORT confirmed. Sending Auto Bot order…';
  else if (!parallelAutoReady&&autoEnabled) $('autoStatus').textContent = `${autoAuthorizationState.replaceAll('_',' ')} · purchases paused. ${autoLastError||'Waiting for positive server acknowledgment.'}`;
  else if (autoLastError) $('autoStatus').textContent = `${parallelAutoReady?'Server-authorized Auto · last request rejected':'Auto stopped'}. ${autoLastError}. See Execution engine for the verified outcome.`;
  else if (autoEnabled) $('autoStatus').textContent = `Auto Bot trades at or above your ${Number($('minimum').value || 65)}% minimum when LIVE SUPPORT appears, then pauses for the selected cooldown.`;
  else $('autoStatus').textContent = 'Auto bot is not active.';
  updateAutoIndicator();
};
$('realConfirm').addEventListener('change', updateDemoArmState); $('accountSelector').addEventListener('change', () => { showSelectedBalance(); updateDemoArmState(); updateAutoState(); prepareFastExecution(); }); $('stake').addEventListener('change', () => { autoLastError = ''; scheduleFastPreparation(); }); $('symbol').addEventListener('change', () => { const selected = $('symbol').value.trim(); scheduleFastPreparation(); if (isRunning) { $('scannerStatus').textContent = `Changed to ${selected}. Loading its live feed now.`; startLive(); } }); $('autoCooldownTicks').addEventListener('change', updateCooldownMonitor); $('executeOver').onclick = () => executeOrder('DIGITOVER'); $('executeUnder').onclick = () => executeOrder('DIGITUNDER'); $('startAuto').onclick = () => { autoEnabled = true; autoAwaitingReset = false; autoMomentumTrades = 0; autoLastError = ''; lastAutoSignalTick = -Infinity; $('autoSwitchMarket').checked = true; setBotMode('auto'); $('autoStatus').textContent = 'Auto Bot started. Waiting for LIVE SUPPORT at or above your minimum confidence.'; updateCooldownMonitor(); scanMarkets(); }; $('stopAuto').onclick = () => { autoEnabled = false; autoAwaitingReset = false; autoMomentumTrades = 0; autoLastError = ''; lastAutoSignalTick = -Infinity; $('autoStatus').textContent = 'Auto Bot stopped. No new Auto orders will be sent.'; updateCooldownMonitor(); updateAutoState(); }; $('scanMarkets').onclick = scanMarkets; $('useScannerMarket').onclick = () => { if (!scannerRecommendedSymbol) return; const before = $('symbol').value.trim(); useScannerMarket(scannerRecommendedSymbol); $('scannerStatus').textContent = before === scannerRecommendedSymbol ? `${scannerRecommendedSymbol} is already the active market.` : `Changed the live market from ${before} to ${scannerRecommendedSymbol}.`; }; $('autoSwitchMarket').addEventListener('change', () => { $('scannerStatus').textContent = $('autoSwitchMarket').checked ? 'Automatic switching is armed for Auto bot mode only. It will switch to the scanner’s strongest selection, including the strongest consolidation fallback when no trend exists.' : 'Automatic switching is off. The scanner will only show its recommendation.'; });
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
$('momentumResetEnabled').addEventListener('change', () => {
  if (!momentumResetEnabled()) autoAwaitingReset = false;
  else if (autoMomentumTrades > 0) autoAwaitingReset = true;
  updateCooldownMonitor(); updateAutoState();
});
['stake','maxStake','dailyLoss','dailyProfitTarget','maxTrades','maxConsecutiveLosses','maxTradesPerSetup'].forEach(id=>$(id).addEventListener('input', updateRiskSummary)); updateRiskSummary();
updateActualPerformance();
renderLastSettledOrder(lastSettledOrder);
$('barrierPersistence').onchange=()=>{barrierEngine.reset();update();};
$('exportBarrierAudit').onclick=()=>{auditStage('export-state',{risk:diagnosticRisk()});const blob=new Blob([JSON.stringify({schema:'part-one-barrier-audit-v3',exportedAt:Date.now(),capacity:2000,droppedEvents:auditDropped,defaults:barrierEngine.config,experimentalConfidenceUsedForTrading:false,execution:executionView,records:barrierAudit},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='part-one-barrier-audit.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};

// Read-only presentation adapter. Rendering never advances analysis or submits orders.
if (typeof window !== 'undefined') import('./premium-dashboard.js').then(({mountDashboard}) => {
  mountDashboard(() => ({ticks, sequence:liveTickNumber, analysis:barrierSnapshot,
    market:$('symbol').value, account:selectedAccount(), connected:demoConnected,
    feedLive:socket?.readyState===1 && isRunning, botMode, autoEnabled:autoEnabled&&parallelAutoReady,
    active:autoInFlight||manualOrderPending||autoContractIds.size>0,
    cooldown:Number.isFinite(lastAutoSignalTick)?Math.max(0,selectedAutoCooldown()-(liveTickNumber-lastAutoSignalTick)):0,
    awaitingReset:autoAwaitingReset, quotes, orders:accountOrderHistory,
    lastOrder:lastSettledOrder, flash:digitFlash, audit:barrierAudit,execution:executionView,executionTransportError,recheckExecution:()=>loadRecentOrder(true),
    minimum:Number($('minimum').value), persistence:Number($('barrierPersistence').value),
    stake:Number($('stake').value),tradability:tradabilityState()}));
}).catch(error => console.error('Dashboard presentation could not load',error));
// The main Start/Stop remains the only AutoBot switch. Arm switches do not start it.
for(const id of ['startAuto','stopAuto','manualMode']){
  const previous=$(id).onclick;
  $(id).onclick=(event)=>{if(id!=='startAuto')void revokeExecution();parallelAutoReady=false;previous?.(event);differEngineState.candidate=null;differEngineState.signal=null;if(id==='startAuto'&&!isRunning)startLive();void syncParallelControl();};
}
$('ouArm').onclick=()=>{overUnderEngineState.armed=!overUnderEngineState.armed;$('ouArm').setAttribute('aria-pressed',String(overUnderEngineState.armed));void syncParallelControl();renderParallel();};
$('differArm').onclick=()=>{differEngineState.arm(!differEngineState.armed);$('differArm').setAttribute('aria-pressed',String(differEngineState.armed));void syncParallelControl();renderParallel();};
$('accountSelector').addEventListener('change',()=>{void revokeExecution();autoEnabled=false;const armed=differEngineState.armed;differEngineState=new DifferEngine();differEngineState.arm(armed);void syncParallelControl();});
renderParallel();
setInterval(verifyAutoAuthorization,1500);
setInterval(async()=>{if(tradabilityMode!=='auto-block'||!isRunning||!demoConnected)return;try{const key=tradabilitySyncKey;if(!key){void syncTradability();return;}const response=await fetch('/api/tradability/status',{cache:'no-store'});if(!response.ok)throw Error('Server guard unavailable');const result=await response.json();if(key===tradabilitySyncKey)tradabilityServer=result;}catch{tradabilityServer={allowed:false,reason:'Server guard unavailable'};}},2000);
globalThis.addEventListener?.('pagehide',()=>{void revokeExecution();});
loadAuthStatus();
tradabilityMarkets.start();
