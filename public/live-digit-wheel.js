// Presentation observer only: no sockets, orders, signals, or execution decisions.
import {extractLastDigit} from './digit-barrier-engine.js';
export const contractDigit = (price, precision) => {
  if (price === null || price === undefined || price === '') return null;
  if (Number.isInteger(precision)) {
    try { return extractLastDigit(price,precision).digit; } catch { return null; }
  }
  // JSON numbers lose trailing zeroes. Do not guess without verified symbol precision.
  if (typeof price === 'number') return null;
  const match = String(price).match(/(\d)\D*$/);
  return match ? Number(match[1]) : null;
};
export class DigitWheelState {
  constructor({now = Date.now} = {}) {
    this.now = now; this.listeners = new Set(); this.attempts = new Map();
    this.liveDigit = null; this.price = null; this.stats = [];
    this.entryDigit = null; this.resultDigit = null; this.contractStatus = 'IDLE';
    this.activeContractId = null; this.highWater = -Infinity; this.expiresAt = null;
    this.timer = null; this.tick = null;
    this.sequence = 0; this.displayAttemptId = null;
    this.precisions = new Map();
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit() { for (const listener of this.listeners) { try { listener(this); } catch(error) { console.error('Digit wheel presentation error',error); } } }
  setAccount(accountId) {
    if (this.accountId === accountId) return;
    this.accountId = accountId; clearTimeout(this.timer); this.timer = null;
    this.attempts.clear(); this.highWater = -Infinity; this.displayAttemptId = null;
    this.activeContractId = null; this.entryDigit = null; this.resultDigit = null;
    this.contractStatus = 'IDLE'; this.expiresAt = null; this.emit();
  }
  setLive(tick, stats, symbol) {
    this.tick = tick; this.liveDigit = Number.isInteger(tick?.digit) ? tick.digit : null;
    if (symbol && typeof tick?.price === 'string') this.precisions.set(symbol,tick.price.includes('.')?tick.price.split('.')[1].length:0);
    this.price = tick?.price ?? null; this.stats = stats; this.emit();
  }
  register(attemptId) {
    if (!attemptId) return;
    if (!this.attempts.has(attemptId)) this.attempts.set(attemptId, {rank: ++this.sequence});
    // The server retains a bounded journal too. Unknown old events fail closed.
    if (this.attempts.size > 250) this.attempts.delete(this.attempts.keys().next().value);
  }
  confirm(receipt) {
    const attempt = this.attempts.get(receipt?.attemptId);
    if (!attempt || !receipt.contractId) return false;
    const id = String(receipt.contractId);
    if (attempt.contractId && attempt.contractId !== id) return false;
    if (attempt.finished || attempt.rank < this.highWater) return false;
    if (id !== this.activeContractId) {
      if (attempt.rank <= this.highWater) return false;
      clearTimeout(this.timer); this.timer = null; this.expiresAt = null;
      this.activeContractId = id; this.highWater = attempt.rank;
      this.displayAttemptId = receipt.attemptId;
      this.entryDigit = null; this.resultDigit = null; this.contractStatus = 'OPEN';
    }
    attempt.contractId = id;
    const digit = contractDigit(receipt.entryTick,this.precisions.get(receipt.symbol));
    if (digit !== null) this.entryDigit = digit;
    this.emit(); return true;
  }
  settle(receipt) {
    if (!this.confirm(receipt)) return false;
    const attempt = this.attempts.get(receipt.attemptId);
    if (String(receipt.contractId) !== this.activeContractId) return false;
    if (!['won','lost','sold'].includes(receipt.status)) return false;
    // Same outcome convention as existing showContractResult; never use a live tick.
    this.resultDigit = contractDigit(receipt.exitTick,this.precisions.get(receipt.symbol));
    this.contractStatus = receipt.status === 'won' || Number(receipt.profit) > 0 ? 'WON' : 'LOST';
    attempt.finished = true; this.expiresAt = this.now() + 2200;
    const id = this.activeContractId;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.expire(id), 2200);
    this.timer.unref?.(); this.emit(); return true;
  }
  expire(id = this.activeContractId) {
    if (id !== this.activeContractId || this.expiresAt === null || this.now() < this.expiresAt) return;
    clearTimeout(this.timer); this.timer = null; this.expiresAt = null;
    this.entryDigit = null; this.resultDigit = null; this.activeContractId = null;
    this.contractStatus = 'IDLE'; this.emit();
  }
  observeExecution(execution) {
    // Server sequence, not arrival time or local/server clock comparison.
    const attempts=execution?.attempts??[];
    const a=attempts.filter(a=>a.contractId).sort((a,b)=>b.number-a.number)[0];
    if (!a) return; // SIGNAL_READY / gate / BUY_SENT are not purchases.
    if (!this.attempts.has(a.attemptId) && this.displayAttemptId) {
      const current=attempts.find(a=>a.attemptId===this.displayAttemptId);
      if (!current || a.number<=current.number) return;
    }
    this.register(a.attemptId);
    const receipt = {...a.entry, attemptId:a.attemptId, contractId:a.contractId};
    if (a.result) this.settle({...receipt,...a.result}); else this.confirm(receipt);
  }
  dispose() { clearTimeout(this.timer); this.listeners.clear(); }
}
export const liveDigitWheel = new DigitWheelState();

export function mountDigitWheel(host, model = liveDigitWheel) {
  host.innerHTML = `<div class="card-heading"><h2>LIVE DIGIT WHEEL</h2><span>LIVE / ENTRY / RESULT</span></div>
    <div class="digit-wheel" aria-label="Live last-digit wheel">
      <div class="wheel-center"><small>LIVE PRICE</small><div class="wheel-price"><span></span><strong></strong></div><p>LAST DIGIT: <b>—</b></p></div>
      ${Array.from({length:10},(_,d)=>{const a=d*Math.PI/5;return `<div class="wheel-digit" data-digit="${d}" style="--x:${50+40*Math.sin(a)}%;--y:${50-40*Math.cos(a)}%"><b>${d}</b><small>0.0%</small><em class="wheel-entry"></em><em class="wheel-result"></em></div>`;}).join('')}
    </div><p class="wheel-status" role="status">Live tracking · no active contract</p>`;
  const cells=[...host.querySelectorAll('.wheel-digit')], price=host.querySelector('.wheel-price');
  let priorTick=null, priorResult=null; const animations=new Map();
  const animate=(node,frames,duration)=>{
    animations.get(node)?.cancel();
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) animations.set(node,node.animate(frames,{duration}));
  };
  const render=s=>{
    const text=s.price===null?'—':String(s.price);
    // Price is already normalized by the strategy extractor; emphasize, do not re-extract.
    price.children[0].textContent=s.price===null?'':text.slice(0,-1);
    price.children[1].textContent=s.price===null?'—':text.slice(-1);
    host.querySelector('.wheel-center b').textContent=s.liveDigit??'—';
    const resultKey=s.resultDigit===null?null:`${s.activeContractId}:${s.contractStatus}`;
    for (const [d,cell] of cells.entries()) {
      cell.classList.toggle('is-live',d===s.liveDigit);
      cell.classList.toggle('is-entry',d===s.entryDigit);
      cell.classList.toggle('is-won',d===s.resultDigit&&s.contractStatus==='WON');
      cell.classList.toggle('is-lost',d===s.resultDigit&&s.contractStatus==='LOST');
      cell.querySelector('small').textContent=(s.stats[d]?.percent??0).toFixed(1)+'%';
      cell.querySelector('.wheel-entry').textContent=d===s.entryDigit?'ENTRY':'';
      cell.querySelector('.wheel-result').textContent=d===s.resultDigit?(s.contractStatus==='WON'?'💰 WIN':'😞 LOSS'):'';
      if (s.tick!==priorTick) {
        animations.get(cell)?.cancel();
        if(d===s.liveDigit)animate(cell,[{filter:'brightness(1.7)'},{filter:'brightness(1)'}],160);
      }
      if(resultKey&&resultKey!==priorResult&&d===s.resultDigit)animate(cell.querySelector('.wheel-result'),[{opacity:.3,scale:'.8'},{opacity:1,scale:'1.1'},{opacity:1,scale:'1'}],420);
    }
    host.querySelector('.wheel-status').textContent=s.contractStatus==='IDLE'?'Live tracking · no active contract':`Contract ${s.activeContractId} · ${s.contractStatus} · Entry ${s.entryDigit??'pending from Deriv'}${s.contractStatus==='OPEN'?'':` → Result ${s.resultDigit??'unavailable from Deriv'}`}`;
    priorTick=s.tick; priorResult=resultKey;
  };
  const unsubscribe=model.subscribe(render); render(model);
  return ()=>{unsubscribe();for(const animation of animations.values())animation.cancel();};
}
