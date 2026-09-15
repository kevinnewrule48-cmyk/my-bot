const $ = (id) => document.getElementById(id);
let ticks = [], socket, timer, isRunning = false, lastSignalIndex = -Infinity;
const pending = [], settled = [];
const quotes = { over: null, under: null };
const counts = () => Array.from({length:10}, (_, digit) => ticks.filter(x => x.digit === digit).length);
const logger = (html) => { const e = document.createElement('div'); e.className = 'entry'; e.innerHTML = html; const blank = $('.log').querySelector('.empty'); if(blank) blank.remove(); $('.log').prepend(e); };
const updateReport = () => {
  const wins = settled.filter(x => x.won).length;
  $('evaluated').textContent = settled.length;
  $('winRate').textContent = settled.length ? `${(wins / settled.length * 100).toFixed(1)}%` : '—';
  $('outcomes').textContent = settled.length ? `${wins} win · ${settled.length - wins} loss` : 'No settled signals';
  $('pending').textContent = pending.length;
  $('rule').textContent = 'OVER 1 / UNDER 8';
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
  if (!signal || !quotes.over || !quotes.under) { $('pricingGate').textContent = 'WAIT'; $('pricingGate').className = ''; $('pricingNote').textContent = 'Need live quotes and at least 50 ticks'; return; }
  const quote = signal.type === 'OVER' ? quotes.over : quotes.under;
  const expected = signal.observed * quote.payout - quote.ask;
  $('pricingGate').textContent = expected > 0 ? 'PASS' : 'BLOCK'; $('pricingGate').className = expected > 0 ? 'positive' : 'negative';
  $('pricingNote').textContent = `${signal.label}: sample EV ${expected >= 0 ? '+' : ''}$${expected.toFixed(3)} per $${quote.ask.toFixed(2)} stake`;
};
const settleSignals = () => {
  const current = ticks.length - 1;
  for (let index = pending.length - 1; index >= 0; index--) {
    const trade = pending[index];
    if (current < trade.settleAt) continue;
    const exit = ticks[trade.settleAt];
    trade.exitDigit = exit.digit;
    trade.won = trade.type === 'OVER' ? exit.digit > trade.barrier : exit.digit < trade.barrier;
    settled.push(trade); pending.splice(index, 1);
    logger(`<span><b class="${trade.type === 'OVER' ? 'positive' : 'negative'}">${trade.type} ${trade.barrier}</b> · ${trade.confidence}% test score · exit digit ${exit.digit}</span><span><b class="${trade.won ? 'positive' : 'negative'}">${trade.won ? 'WIN' : 'LOSS'}</b></span>`);
  }
  updateReport();
};
const calculateSignal = (history) => {
  const n = history.length;
  if (n < 50) return null;
  const c = Array.from({length:10}, (_, digit) => history.filter(x => x.digit === digit).length);
  const over1 = { type:'OVER', barrier:1, label:'OVER 1', observed:c.slice(2).reduce((a,b)=>a+b,0)/n, risk:(c[0]+c[1])/n };
  const under8 = { type:'UNDER', barrier:8, label:'UNDER 8', observed:c.slice(0,8).reduce((a,b)=>a+b,0)/n, risk:(c[8]+c[9])/n };
  const candidate = over1.risk <= under8.risk ? over1 : under8;
  const strength = Math.min(1, n / 200);
  return {...candidate, confidence: Math.round(Math.max(0, Math.min(95, 50 + Math.abs(over1.risk-under8.risk) * 300 * strength))), options:{over1, under8}};
};
const update = () => {
  const windowSize = Number($('window').value) || 200; ticks = ticks.slice(-windowSize);
  const c = counts(), n = ticks.length, latest = ticks.at(-1);
  $('sample').textContent = n; $('sampleNote').textContent = n < 50 ? `Need ${50-n} more ticks` : `Rolling last ${n} ticks`;
  if(latest){ $('price').textContent = latest.price; $('tickTime').textContent = new Date(latest.time * 1000).toLocaleTimeString(); }
  $('digits').innerHTML = c.map((value,digit) => `<div class="digit"><b>${digit}</b><span>${n ? (value/n*100).toFixed(1) : '0.0'}%</span></div>`).join('');
  if(n < 50) return showSignal(null);
  const candidate = calculateSignal(ticks);
  const confidence = candidate.confidence;
  const threshold = Number($('minimum').value);
  showSignal(confidence >= threshold ? {...candidate, confidence} : null, candidate, confidence);
  updatePricing();
};
const showSignal = (signal, candidate, confidence) => {
  if(!signal){ $('signal').textContent = 'NO SIGNAL'; $('signal').className=''; $('signalNote').textContent = candidate ? `${candidate.type} score ${confidence}% is below your threshold` : 'Collecting data'; return; }
  $('signal').textContent = signal.label; $('signal').className = 'positive'; $('signalNote').textContent = `Analysis score ${signal.confidence}% · OVER 1 sample rate ${(signal.options.over1.observed*100).toFixed(1)}% · UNDER 8 sample rate ${(signal.options.under8.observed*100).toFixed(1)}%`;
  const cooldown = Number($('cooldown').value) || 10;
  if($('paper').checked && ticks.length - lastSignalIndex >= cooldown){
    lastSignalIndex = ticks.length;
    const duration = Number($('duration').value) || 1;
    pending.push({type: signal.type, barrier: signal.barrier, label: signal.label, confidence: signal.confidence, openedAt: ticks.length - 1, settleAt: ticks.length - 1 + duration});
    logger(`<span><b class="${signal.type==='OVER'?'positive':'negative'}">${signal.label}</b> · ${signal.confidence}% analysis score</span><span>Pending · evaluate in ${duration} tick${duration === 1 ? '' : 's'}</span>`);
    updateReport();
  }
};
const addTick = (price, epoch=Math.floor(Date.now()/1000)) => { const raw=String(price); const digit=Number(raw.replace(/\D/g,'').slice(-1)); if(Number.isInteger(digit)){ ticks.push({price:raw,time:epoch,digit}); settleSignals(); update(); } };
const refreshPricing = () => {
  if (!socket || socket.readyState !== WebSocket.OPEN) { logger('<span class="negative">Start the live feed before requesting current Deriv pricing.</span>'); return; }
  const amount = Number($('stake').value) || 1, symbol = $('symbol').value.trim();
  for (const [contract_type, barrier] of [['DIGITOVER', '1'], ['DIGITUNDER', '8']]) socket.send(JSON.stringify({proposal:1, amount, basis:'stake', contract_type, currency:'USD', duration:1, duration_unit:'t', barrier, underlying_symbol:symbol}));
};
const simulated = () => { clearInterval(timer); $('connection').textContent='SIMULATED FEED'; $('connection').className='pill muted'; let quote=1000; timer=setInterval(()=>{quote += (Math.random()-.5)*.8; addTick(quote.toFixed(2));},700); };
const startLive = () => {
  const symbol=$('symbol').value.trim(); clearInterval(timer); if(socket) socket.close();
  try { socket=new WebSocket('wss://api.derivws.com/trading/v1/options/ws/public'); socket.onopen=()=>{isRunning=true; socket.send(JSON.stringify({ticks:symbol,subscribe:1})); refreshPricing(); $('connection').textContent=`LIVE · ${symbol}`; $('connection').className='pill positive';}; socket.onmessage=e=>{const data=JSON.parse(e.data); if(data.error){logger(`<span class="negative">Feed error: ${data.error.message}</span>`); return;} if(data.tick)addTick(data.tick.quote,data.tick.epoch); if(data.proposal){const kind=data.echo_req?.contract_type === 'DIGITOVER' ? 'over' : 'under'; quotes[kind]={ask:Number(data.proposal.ask_price), payout:Number(data.proposal.payout)}; updatePricing();}}; socket.onerror=()=>{logger('<span class="negative">Could not connect to Deriv for live data. The simulated feed will continue.</span>'); simulated();}; socket.onclose=()=>{if(isRunning){$('connection').textContent='DISCONNECTED';$('connection').className='pill negative';}};
  } catch { simulated(); }
};
const backtest = () => {
  const duration = Number($('duration').value) || 1, windowSize = Number($('window').value) || 200, threshold = Number($('minimum').value), cooldown = Number($('cooldown').value) || 10;
  if (ticks.length < 50 + duration) { logger('<span class="negative">Collect at least 51 ticks before running a backtest.</span>'); return; }
  let last = -Infinity; const results = [];
  for (let entry = 50; entry + duration < ticks.length; entry++) {
    const signal = calculateSignal(ticks.slice(Math.max(0, entry-windowSize), entry));
    if (!signal || signal.confidence < threshold || entry-last < cooldown) continue;
    const exit = ticks[entry + duration].digit;
    results.push(signal.type === 'OVER' ? exit > signal.barrier : exit < signal.barrier); last = entry;
  }
  const wins = results.filter(Boolean).length, rate = results.length ? (wins / results.length * 100).toFixed(1) : '—';
  logger(`<span><b>BACKTEST COMPLETE</b> · ${ticks.length} collected ticks · ${results.length} eligible signals</span><span><b class="${Number(rate) >= 50 ? 'positive' : 'negative'}">${rate}% win rate</b></span>`);
};
const loadAuthStatus = async () => {
  try {
    const status = await fetch('/api/auth/status', { cache:'no-store' }).then(r => r.json());
    const button = $('connect');
    if (status.connected) { button.textContent = 'Demo account connected'; button.disabled = true; return; }
    if (!status.configured) { button.textContent = 'Configure demo sign-in'; button.title = 'Set DERIV_CLIENT_ID and an HTTPS DERIV_REDIRECT_URI on the server first.'; return; }
    button.textContent = 'Connect demo account';
  } catch { $('connect').textContent = 'Demo sign-in unavailable'; }
};
$('connect').onclick=()=>{ window.location.assign('/api/auth/start'); };
$('start').onclick=startLive; $('pricing').onclick=refreshPricing; $('backtest').onclick=backtest; $('stop').onclick=()=>{isRunning=false;clearInterval(timer);if(socket)socket.close();$('connection').textContent='STOPPED';$('connection').className='pill muted';};
['window','minimum','duration','cooldown'].forEach(id=>$(id).addEventListener('change',()=>{ update(); updateReport(); })); updateReport(); simulated();
loadAuthStatus();
