export function entryView(signal,live){
  if(!signal||!live)return {title:'WAIT — NO LIVE SIGNAL',tone:'waiting',reason:'Connect the live feed. A stopped or stale feed cannot provide an entry.',strength:'Not available',score:null,confidence:'Unavailable',momentum:'Waiting for live prices',failed:[]};
  const checks=signal.checks.filter(c=>c.name!=='Execution validation');
  const failed=checks.filter(c=>!c.pass);
  const ready=checks.length>0&&failed.length===0;
  const score=Number.isFinite(signal.score)?signal.score:null;
  return {title:`${ready?'SETUP QUALIFIED':'WAIT'} · ${signal.type} ${signal.barrier}`,tone:ready?'qualified':'waiting',
    reason:ready?'Diagnostic checks passed for this selected contract. Review the current payout before your manual order. Auto is still unavailable.':`Not a qualified entry. Waiting for: ${failed.map(c=>c.name).join(', ')}.`,
    strength:ready?'Qualified research setup':score===null?'Unavailable':score>=80?'Strong score · checks incomplete':score>=60?'Developing':'Weak',score,
    confidence:Number.isFinite(signal.calibratedProbability)?`${(signal.calibratedProbability*100).toFixed(1)}% · imported-session estimate`:'Unavailable — import session evidence',
    momentum:Number.isFinite(signal.components?.momentum)?`${signal.components.momentum.toFixed(1)} / 100 · momentum score`:'Unavailable',failed};
}
export function mountEntryPanels(){
  const host=document.createElement('div');host.className='entry-panels';host.setAttribute('aria-label','Entry guidance');
  host.innerHTML=`<article class="entry-card" id="suggestionCard"><h3>Suggested Entry</h3><strong id="suggestedSetup">WAIT — NO LIVE SIGNAL</strong><p id="setupReason"></p><small>Selected side and barrier, not an automatic best-contract ranking. OVER/UNDER is a last-digit contract, not an overbought/oversold indication.</small></article><article class="entry-card"><h3>Entry Strength Analyzer</h3><strong id="setupStrength">Not available</strong><progress id="setupMeter" max="100" value="0" aria-label="Research strength score"></progress><p id="setupScore"></p><p id="setupConfidence"></p><small id="setupMomentum"></small></article><article class="entry-card"><h3>Momentum Cooldown</h3><strong id="cooldownState">AUTO OFF</strong><p id="cooldownDetail">Auto cooldown does not restrict manual orders.</p><small>Counts new live ticks after an Auto settlement. No automatic orders are enabled in this release.</small></article>`;
  document.getElementById('manualTrade').parentElement.before(host);
  const distribution=document.createElement('div');distribution.className='terminal-panel';
  distribution.innerHTML=`<div class="terminal-heading"><h3>Terminal Digit Distribution</h3><div><small id="terminalFeedState">Waiting for live feed</small><strong id="terminalPrice">—</strong></div></div><div class="terminal-digits">${Array.from({length:10},(_,d)=>`<div class="terminal-digit" id="terminalDigit${d}"><b>${d}</b><span id="terminalRate${d}">—</span></div>`).join('')}</div><p id="terminalSample" class="hint">Waiting for price ticks.</p>`;
  host.after(distribution);
  return (signal,market)=>{
    const live=document.getElementById('status').textContent==='LIVE';
    document.getElementById('terminalPrice').textContent=market?.last?.quote??'—';
    document.getElementById('terminalFeedState').textContent=market?.last?`${market.last.symbol} · ${live?'LIVE PRICE':'LAST PRICE · FEED STOPPED'}`:'Waiting for live feed';
    document.getElementById('terminalSample').textContent=`Last ${Math.min(market?.sample??0,50)} price ticks · Percentages are observed frequencies, not win probabilities.`;
    for(let d=0;d<10;d++){
      const cell=document.getElementById(`terminalDigit${d}`),active=live&&market?.last?.digit===d;
      cell.classList.toggle('active',active);
      cell.setAttribute('aria-label',`Digit ${d}${active?', current price last digit':''}`);
      const frequency=market?.digits?.[d]?.frequency;
      document.getElementById(`terminalRate${d}`).textContent=Number.isFinite(frequency)?`${(frequency*100).toFixed(1)}%`:'—';
    }
    const view=entryView(signal,document.getElementById('status').textContent==='LIVE');
    const set=(id,text)=>{document.getElementById(id).textContent=text;};
    document.getElementById('suggestionCard').dataset.tone=view.tone;
    set('suggestedSetup',view.title);set('setupReason',view.reason);set('setupStrength',view.strength);
    document.getElementById('setupMeter').value=view.score??0;
    set('setupScore',view.score===null?'Research score unavailable':`${view.score.toFixed(1)} / 100 · research score, not win probability`);
    set('setupConfidence',`Calibrated confidence: ${view.confidence}`);set('setupMomentum',view.momentum);
  };
}
