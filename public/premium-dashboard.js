import {dashboardStatus,heatMap,summarizeOrders,barrierView} from './premium-model.js';
import {diagnoseSnapshot} from './part-one-diagnostics.js';
import {DEFAULTS} from './digit-barrier-engine.js';
import {liveDigitWheel,mountDigitWheel} from './live-digit-wheel.js';
import {mountTradabilityPanel} from './tradability-panel.js';
const byId=id=>document.getElementById(id);
const put=(id,value)=>{const n=byId(id);if(n&&n.textContent!==String(value))n.textContent=value;};
const fmt=n=>Number.isFinite(n)?n.toFixed(2):'—';
export function mountDashboard(readState){
  document.body.classList.add('premium');
  const main=document.querySelector('main');
  const layout=document.createElement('div');layout.className='terminal';
  layout.innerHTML=`<div class="workspace-heading"><div><p class="eyebrow">CONSENT ATM / PART ONE</p><h2>Digit workspace<span class="quiet-dot"></span></h2><p>Independent analysis. Clear decisions.</p></div><div class="session-tag">LIVE DATA ONLY <span>•</span> 1 TICK CONTRACTS</div></div>
  <div class="terminal-grid"><div id="marketColumn" class="column">
  <section class="panel digit-hero"><div class="card-heading"><span>LIVE MARKET</span><span id="heroMarket">—</span></div><p class="eyebrow">LAST DIGIT</p><div id="heroDigit">—</div><p id="heroPrice">Waiting for a verified price</p><div id="recentStream" aria-label="Most recent digits, newest first"></div><small>Newest first · actual market ticks</small></section>
  <section class="panel"><div class="card-heading"><h2>Digit heat map</h2><span>ROLLING SAMPLE</span></div><div id="premiumHeat" class="heat-grid"></div><p class="hint">HOT &gt;12% · COLD &lt;8% · descriptive frequency only</p></section></div>
  <div id="analysisColumn" class="column"><section class="panel barrier-card"><div class="card-heading"><h2>Digit Barrier</h2><span class="tag">ENGINE 01</span></div><div class="barrier-controls"><label>Barrier view<select id="barrierViewMode"><option value="auto">Auto · follow selected candidate</option><option value="manual">Manual · explore only</option></select></label><label>Direction<select id="barrierDirection"><option>OVER</option><option>UNDER</option></select></label><label>Barrier<input id="barrierNumber" type="number" min="0" max="9" value="1"></label></div><div id="barrierRail" class="barrier-rail"></div><p id="barrierExplanation"></p><div class="barrier-facts"><span>WINNING <b id="winningSet">—</b></span><span>LOSING <b id="losingSet">—</b></span><span>SAMPLE <b id="barrierSample">0</b></span></div><p class="hint">Manual exploration never changes orders. Execution remains OVER 1 / UNDER 8.</p></section>
  <section class="panel comparison"><div class="card-heading"><h2>Candidate comparison</h2><span>INDEPENDENT</span></div><div id="candidateCards" class="candidate-grid"></div><p class="hint">Confidence is a strategy score, not a win probability.</p></section>
  <section class="panel gate-card"><div><p class="eyebrow">CONDITION GATE</p><h2 id="gateTitle">No selected candidate</h2><p id="gateText">Waiting for analysis</p></div><div id="gateRing" class="gate-ring"><span id="gatePercent">—</span></div></section>
  <details class="panel decision-details"><summary>Why did the bot choose this trade?</summary><div id="decisionReason"></div></details></div>
  <div id="executionColumn" class="column"><section class="panel"><div class="card-heading"><h2>Current trade</h2><span id="tradeStatus" class="tag">NO ORDER</span></div><label>Proposal to inspect<select id="proposalSide"><option value="OVER">OVER 1</option><option value="UNDER">UNDER 8</option></select></label><dl id="tradeFacts" class="trade-facts"></dl><p class="hint">Quote preview, not a purchase. Final price is validated by the server.</p></section><section class="panel"><div class="card-heading"><h2>Recorded performance</h2><span>THIS BROWSER</span></div><div id="sessionStats" class="stats-grid"></div><p class="hint">Completed account contracts only. Includes saved browser history; not an account-wide ledger.</p></section></div></div>
  <section class="panel chart-panel"><div class="card-heading"><div><p class="eyebrow">MARKET TELEMETRY</p><h2>Live analysis</h2></div><label>Chart view<select id="chartView"><option value="distribution">Digit distribution</option><option value="observed">Winning-set frequency</option><option value="momentum">Momentum</option><option value="stability">Stability</option><option value="quality">Quality</option></select></label></div><div id="chartLegend">OVER 1 · mint / UNDER 8 · lavender</div><svg id="analysisChart" viewBox="0 0 900 180" role="img" aria-label="Live descriptive analysis chart"></svg><p id="chartCaption" class="hint">Waiting for real observations</p></section>
  <details class="panel"><summary>Decision log · both candidates</summary><div id="premiumLog"></div></details><div id="lowerPanels" class="lower-panels"></div>`;
  main.prepend(layout);
  const wheelPanel=document.createElement('section');wheelPanel.className='panel live-wheel-panel';
  byId('marketColumn').prepend(wheelPanel);
  const disposeWheel=mountDigitWheel(wheelPanel);
  document.querySelector('.digit-hero').hidden=true;
  const enginePanel=document.createElement('section');enginePanel.className='panel';
  enginePanel.innerHTML='<div class="card-heading"><h2>Execution engine</h2><span id="executionEngineState">NO ACCOUNT</span></div><p id="executionStrategyState"></p><pre id="executionEngineDetails" style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px"></pre><button id="recheckExecution" class="secondary">Recheck execution · no purchase</button><details><summary>Recent trade attempts</summary><div id="executionAttemptHistory"></div></details><details><summary>Execution event log</summary><pre id="executionEventLog" style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto;font-size:11px"></pre></details>';
  byId('executionColumn').prepend(enginePanel);byId('recheckExecution').onclick=()=>readState().recheckExecution();
  const move=(selector,target)=>{const el=document.querySelector(selector);if(el)byId(target).append(el);};
  move('.controls','marketColumn');move('.scannerPanel','marketColumn');
  const tradabilityPanel=document.createElement('section');tradabilityPanel.className='panel';byId('marketColumn').append(tradabilityPanel);
  const renderTradability=mountTradabilityPanel(tradabilityPanel,()=>readState().tradability);
  move('.entryDeck','analysisColumn');
  byId('analysisColumn').prepend(document.querySelector('.suggestedEntryPanel'));
  byId('executionColumn').append(document.querySelector('.cooldownPanel'));
  byId('digits').closest('section').hidden=true;
  move('.modePanel','executionColumn');move('#autoOrderPanel','executionColumn');move('#manualOrderPanel','executionColumn');
  const settings=byId('stake').closest('section');byId('executionColumn').append(settings);
  // Existing controls retain their nodes, IDs and handlers; no duplicate execution paths.
  byId('executionColumn').prepend(document.querySelector('.modePanel'),byId('autoOrderPanel'));
  // Stack related panels without shared grid-row height leaving blank space.
  const stackPanels=(name,selectors)=>{const stack=document.createElement('div');stack.className=`dashboard-stack ${name}`;layout.append(stack);for(const selector of selectors)stack.append(document.querySelector(selector));};
  stackPanels('entry-execution-stack',['.entryAnalyzerPanel','#autoOrderPanel']);
  stackPanels('heat-scanner-stack',['section:has(#premiumHeat)','.scannerPanel']);
  stackPanels('controls-chart-stack',['.controls','.chart-panel']);
  const compactWorkspace=document.createElement('div');compactWorkspace.className='compact-workspace';layout.append(compactWorkspace);
  for(const selectors of [
    ['.suggestedEntryPanel','.entry-execution-stack','.heat-scanner-stack'],
    ['.gate-card','.cooldownPanel','.controls-chart-stack'],
    ['.modePanel','.live-wheel-panel','.barrier-card']
  ]){const column=document.createElement('div');column.className='compact-column';compactWorkspace.append(column);for(const selector of selectors)column.append(layout.querySelector(selector));}
  move('.orderPerformancePanel','lowerPanels');move('.movedMetrics','lowerPanels');
  const diagnostic=byId('barrierDiagnostics').closest('section');byId('lowerPanels').append(diagnostic);
  document.querySelector('.entryDeck').classList.add('compact-entry');
  document.querySelector('header h1').textContent='DERIV DIGIT BOT';
  document.querySelector('header .eyebrow').textContent='CONSENT ATM';
  const headerStrip=document.createElement('div');headerStrip.className='header-strip';
  headerStrip.innerHTML='<span id="premiumConnection">DISCONNECTED</span><span id="premiumAccount">NO ACCOUNT</span><span id="premiumMarket">—</span><span id="premiumStatus">STOPPED</span><button id="headerStop" class="danger">Stop bot</button>';
  document.querySelector('header').append(headerStrip);
  byId('headerStop').onclick=()=>byId('stopAuto').click();
  const consecutive=byId('maxConsecutiveLosses');consecutive.type='number';consecutive.disabled=false;consecutive.min='0';consecutive.step='1';
  const riskLabel=document.createElement('label');riskLabel.textContent='Demo maximum consecutive losses · 0 means off';consecutive.before(riskLabel);riskLabel.append(consecutive);
  settings.querySelector('.automation').textContent='Demo server session limits apply to this bot, across tabs: loss allowance reserves the next stake, trade count and pending-order limit are enforced. Limits only tighten during a server ledger session; refreshing does not reset them. Auto cooldown uses server-observed ticks; manual has no cooldown. These are not account-wide daily limits. Real-money Auto is disabled.';
  const series=[];let previousSequence=-1,previousContext='',lastRenderKey='';
  function render(){
    renderTradability();
    const s=readState(),context=s.analysis?.context||s.market;
    if(previousContext!==context){series.length=0;previousSequence=-1;previousContext=context;}
    if(s.sequence!==previousSequence&&s.analysis){series.push(s.analysis.candidates);if(series.length>120)series.shift();previousSequence=s.sequence;}
    const key=JSON.stringify([s.sequence,s.stake,s.account,s.connected,s.feedLive,s.autoEnabled,s.botMode,s.active,s.cooldown,s.awaitingReset,s.quotes,s.orders.length,s.lastOrder,s.flash,s.minimum,s.persistence,s.execution,s.executionTransportError,...['barrierViewMode','barrierDirection','barrierNumber','proposalSide','chartView'].map(id=>byId(id).value)]);
    if(key===lastRenderKey)return;lastRenderKey=key;
    put('premiumConnection',s.feedLive?'● LIVE':'○ DISCONNECTED');
    put('premiumAccount',s.connected&&s.account?s.account.accountType.toUpperCase()+' ACCOUNT':'NO ACCOUNT');
    byId('premiumAccount').className=s.connected&&s.account?.accountType==='real'?'real-account':'demo-account';
    put('premiumMarket',s.market.replace('R_','Volatility ')+' Index');put('premiumStatus',dashboardStatus(s));
    const execution=s.execution,lastAttempt=execution?.last;
    put('executionEngineState',s.executionTransportError?'STATUS UNAVAILABLE':execution?.state??(s.connected?'CHECKING':'NO ACCOUNT'));
    put('executionStrategyState',`Strategy: ${s.analysis?.selected?'GO AHEAD · '+s.analysis.selected.label:'NOT READY'} · Strategy permission is not a purchase.${execution?.errorSummary?' '+execution.errorSummary:''}`);
    put('executionEngineDetails',lastAttempt?`Last trade: #${String(lastAttempt.number).padStart(3,'0')}\nAttempt: ${lastAttempt.attemptId}\nProposal: ${lastAttempt.proposalId??'WAITING'}\nBuy: ${lastAttempt.contractId?'CONFIRMED':lastAttempt.buySent?'SENT · OUTCOME UNCONFIRMED':'NOT SENT'}\nContract ID: ${lastAttempt.contractId??'—'}\nSettlement: ${lastAttempt.result?lastAttempt.result.status.toUpperCase()+' · P/L '+lastAttempt.result.profit:'WAITING'}\n${lastAttempt.error?'Last error: '+lastAttempt.error.code+' · '+lastAttempt.error.message:''}\n${s.executionTransportError||''}`:s.executionTransportError||'No recorded account order attempt.');
    byId('executionAttemptHistory').replaceChildren(...(execution?.attempts??[]).slice().reverse().map(a=>{const row=document.createElement('p');row.textContent=`#${String(a.number).padStart(3,'0')} · ${a.contractId?'BUY CONFIRMED':a.buySent?'BUY SENT':'NO BUY'} → ${a.result?.status?.toUpperCase()??a.state}${a.error?' · '+a.error.code:''}`;return row;}));
    put('executionEventLog',(execution?.events??[]).slice(-80).map(e=>JSON.stringify(e)).join('\n'));
    put('heroMarket',s.market);const newDigit=String(s.ticks.at(-1)?.digit??'—');if(byId('heroDigit').textContent!==newDigit){put('heroDigit',newDigit);if(!matchMedia('(prefers-reduced-motion: reduce)').matches)byId('heroDigit').animate([{opacity:.6,transform:'translateY(3px)'},{opacity:1,transform:'translateY(0)'}],{duration:180});}put('heroPrice',s.ticks.at(-1)?.price??'Waiting for a verified price');
    byId('recentStream').innerHTML=s.ticks.slice(-10).reverse().map(t=>`<span>${t.digit}</span>`).join('');
    const heat=liveDigitWheel.stats.length?liveDigitWheel.stats:heatMap(s.ticks);byId('premiumHeat').innerHTML=heat.map(h=>`<div class="heat-cell ${h.label.toLowerCase().replace(' ','-')}"><b>${h.digit}</b><span>${h.percent.toFixed(1)}%</span><small>${h.count} ticks</small><em>${h.label}</em></div>`).join('');
    const manual=byId('barrierViewMode').value==='manual',selected=s.analysis?.selected;
    byId('barrierNumber').disabled=byId('barrierDirection').disabled=!manual;
    const direction=manual?byId('barrierDirection').value:selected?.type||'OVER';
    const barrier=manual?Math.max(0,Math.min(9,Math.floor(Number(byId('barrierNumber').value)||0))):selected?.barrier??1;
    if(!manual){byId('barrierNumber').value=barrier;byId('barrierDirection').value=direction;}
    const sets=barrierView(direction,barrier);
    byId('barrierRail').innerHTML=Array.from({length:10},(_,d)=>`<span class="${d===barrier?'barrier-point':sets.winning.includes(d)?'winning-digit':''}">${d}</span>`).join('');
    put('barrierExplanation',manual?`EXPLORATION · ${direction} ${barrier}`:selected?`SELECTED · ${selected.label}`:'NO CANDIDATE SELECTED · preview OVER 1');
    put('winningSet',sets.winning.join(' · ')||'None');put('losingSet',sets.losing.join(' · '));put('barrierSample',s.ticks.length);
    const candidates=s.analysis?diagnoseSnapshot(s.analysis,{config:{...DEFAULTS,minimumConfidence:s.minimum,persistence:s.persistence}}).candidates:[];
    byId('candidateCards').innerHTML=candidates.map(c=>`<article class="candidate ${c.type.toLowerCase()}"><div class="candidate-title"><h3>${c.label}</h3><span class="${c.ready?'positive':'muted'}">${c.ready?'READY':'WAITING'}</span></div>${c.checks.map(check=>{
      const values={Barrier:[`${(c.observed*100).toFixed(1)}%`,'≥90% · ≥50 ticks',c.observed*100],Momentum:[c.momentum===null?'—':c.momentum.toFixed(2)+' pp','≥0 pp',check.pass?100:0],Zone:[c.zone?'PASS':'FAIL','Own losing digits each ≤8%; no opposite minimum',check.pass?100:0],Stability:[c.stability,'5 quiet transitions',c.stability],Score:[c.score,`≥${s.minimum}`,c.score],Persistence:[c.persistence,`≥${s.persistence} unique ticks`,Math.min(100,c.persistence/Math.max(1,s.persistence)*100)],Confidence:[c.confidence,`≥${s.minimum} · derived from Score, not probability`,c.confidence],Quality:[c.quality.toFixed(0), `≥50 sample ticks · actual ${c.sample}`,c.quality]};
      const [v,threshold,progress]=values[check.name];const label=check.name==='Quality'?'Sample adequacy':check.name==='Confidence'?'Confidence (= Score)':check.name;
      const detail=check.name==='Zone'?c.zoneMeasurements.map(z=>`digit ${z.digit}: ${z.value.toFixed(2)}% ≤${z.threshold}% ${z.pass?'PASS':'FAIL'}`).join(' · '):check.name==='Persistence'&&c.persistence===0?'Prerequisites failing: '+c.checks.slice(0,5).filter(x=>!x.pass).map(x=>x.name).join(', '):!check.pass?'Requirement not met'+(check.name==='Momentum'&&c.momentum===null?' · waiting for previous observation':''):'';
      return `<div class="metric-row"><div><span>${label}</span><b>${v}</b><em class="${check.pass?'positive':'muted'}">${check.pass?'PASS':'FAIL'}</em></div><small>${threshold}</small><small>${detail}</small><progress value="${progress}" max="100" aria-label="${c.label} ${check.name}"></progress></div>`;}).join('')}<footer>Conditions Passed <b>${c.checks.filter(x=>x.pass).length} / ${c.checks.length}</b></footer></article>`).join('');
    const inspected=selected||candidates.find(c=>c.type===byId('proposalSide').value);
    const passed=inspected?.checks.filter(c=>c.pass).length||0,total=inspected?.checks.length||8,percent=passed/total*100;
    put('gateTitle',selected?`${selected.label} · READY`:`${inspected?.label||'Candidate'} · NOT READY`);put('gateText',`${passed} / ${total} Conditions Passed${!selected?' · inspected candidate, not selected':''}`);put('gatePercent',percent.toFixed(0)+'%');byId('gateRing').style.setProperty('--gate',percent+'%');
    byId('decisionReason').innerHTML=candidates.map(c=>`<h3>${c.label} · ${selected?.type===c.type?'SELECTED':'NOT SELECTED'}</h3><p>${c.checks.map(x=>`${x.name}: ${x.pass?'PASS':'FAIL'}`).join(' · ')}</p><p>${c.ready?'All conditions passed. Selection uses score, then support; equal ties select neither.':'Failed: '+c.checks.filter(x=>!x.pass).map(x=>x.name).join(', ')}</p>`).join('');
    const side=byId('proposalSide').value,q=s.quotes[side.toLowerCase()],currency=s.account?.currency||'USD';
    put('tradeStatus',s.active?'TRADE ACTIVE':s.lastOrder?.state==='settled'?'LAST ORDER SETTLED':'QUOTE PREVIEW');
    const facts={Direction:side,Barrier:side==='OVER'?1:8,'Contract type':'DIGIT'+side,Stake:`${fmt(s.stake)} ${currency}`,'Ask price':q?fmt(q.ask)+' USD':'—','Potential payout':q?fmt(q.payout)+' USD':'—','Potential profit':q?fmt(q.payout-q.ask)+' USD':'—',Duration:'1 tick'};
    byId('tradeFacts').innerHTML=Object.entries(facts).map(([k,v])=>`<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    if(s.lastOrder){const receipt=document.createElement('div');receipt.className='receipt-note';receipt.textContent=`Latest accepted order: ${s.lastOrder.label||'contract'} · entry ${s.lastOrder.entryDigit??'—'} · settlement ${s.lastOrder.settlementDigit??'pending'} · ${s.lastOrder.state||'accepted'}`;byId('tradeFacts').append(receipt);}
    const stats=summarizeOrders(s.orders);byId('sessionStats').innerHTML=Object.entries({'Total trades':stats.total,Wins:stats.wins,Losses:stats.losses,'Observed win rate':stats.rate===null?'—':stats.rate.toFixed(1)+'%','Recorded P/L':fmt(stats.net),'Win streak':stats.winStreak,'Loss streak':stats.lossStreak,'Max drawdown':fmt(stats.drawdown)}).map(([k,v])=>`<div><small>${k}</small><b>${v}</b></div>`).join('');
    byId('premiumLog').replaceChildren(...s.audit.slice(-20).reverse().map(event=>{const row=document.createElement('p');row.textContent=`${new Date(event.time).toLocaleTimeString()} · ${event.stage} · ${event.candidates?event.candidates.map(c=>`${c.label}: ${c.checks.filter(x=>x.pass).length}/${c.checks.length}, ${c.ready?'READY':'WAIT'}`).join(' / '):event.type||event.reason||'Account / execution check'}`;return row;}));
    const view=byId('chartView').value;let shapes='';
    if(view==='distribution'){const ceiling=Math.max(20,...heat.map(h=>h.percent));shapes=heat.map((h,i)=>`<rect x="${i*89+10}" y="${150-h.percent/ceiling*125}" width="60" height="${h.percent/ceiling*125}" rx="5" fill="#78cdb5"/><text x="${i*89+40}" y="174" text-anchor="middle">${i}</text>`).join('');put('chartCaption',`Digit frequency (%) · current rolling sample · scale 0–${ceiling.toFixed(0)}%`);}
    else {const values=series.flatMap(pair=>pair.map(c=>view==='observed'?c.observed*100:c[view]??0)),low=view==='momentum'?Math.min(-1,...values):0,high=view==='momentum'?Math.max(1,...values):100;
      shapes=[0,1].map((sideIndex)=>`<polyline fill="none" stroke="${sideIndex===0?'#78cdb5':'#b8a7ef'}" stroke-width="2.5" points="${series.map((pair,i)=>`${20+i/Math.max(1,series.length-1)*860},${150-((view==='observed'?pair[sideIndex].observed*100:pair[sideIndex][view]??0)-low)/(high-low)*130}`).join(' ')}"/>`).join('');put('chartCaption',`${series.length} observed snapshots · ${view==='momentum'?'percentage points':'0–100 scale'} · gaps during hidden tabs are not interpolated tick data`);}
    byId('analysisChart').innerHTML=`<path d="M0 20H900M0 85H900M0 150H900" stroke="#ffffff10"/>${shapes}`;
  }
  layout.addEventListener('change',render);
  render();const timer=setInterval(()=>{if(!document.hidden)render();},250);
  window.addEventListener('pagehide',()=>{clearInterval(timer);disposeWheel();liveDigitWheel.dispose();},{once:true});
}
