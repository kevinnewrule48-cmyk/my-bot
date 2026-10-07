import {RegimeResearch,evaluateResearch} from './digit-regime-research.js';
const root=document.getElementById('digitRegimePanel');
const set=(id,value)=>{const el=document.getElementById(id);if(el&&el.textContent!==String(value))el.textContent=String(value);};
const detail=(id,value)=>{if(document.getElementById(id)?.closest('details')?.open)set(id,JSON.stringify(value,null,2));};
const fmt=(n,suffix='')=>Number.isFinite(n)?n.toFixed(2)+suffix:'not enough data';
const fail=e=>{research.warning='Research storage unavailable: '+e.message;research.dirty++;};
let store;
try{
  store=new Promise((resolve,reject)=>{
    const request=indexedDB.open('part-one-digit-regime-v1',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('trades',{keyPath:'attemptId'});
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('Close older research tabs to allow storage to open'));
  });
}catch(e){store=Promise.reject(e);}
// Observer storage uses a separate database and never touches order/cooldown storage.
function write(method,data){store.then(db=>{
  const tx=db.transaction('trades','readwrite'),table=tx.objectStore('trades');
  if(method==='delete')table.delete(data);
  else {
    const read=table.getAll();read.onsuccess=()=>{
      const rows=read.result;
      if(!rows.some(r=>r.attemptId===data.attemptId)&&rows.length>=200){
        const retired=rows.filter(r=>['settled','rejected'].includes(r.state)).sort((a,b)=>a.preEntry.capturedAt-b.preEntry.capturedAt)[0];
        if(retired)table.delete(retired.attemptId);
        else {fail(Error('Persistent research store has 200 unresolved attempts; newest snapshot is memory-only'));return;}
      }
      table.put(data);
    };
  }
  tx.onerror=()=>fail(tx.error);tx.onabort=()=>fail(tx.error??Error('Storage transaction aborted'));
}).catch(fail);}
const research=new RegimeResearch({onRecord:r=>write('put',r),onDelete:id=>write('delete',id)});
if(globalThis.partOneRegimeQueueDropped)research.warning=`${globalThis.partOneRegimeQueueDropped} early observer events were dropped before the research module loaded.`;
store.then(db=>{const request=db.transaction('trades','readonly').objectStore('trades').getAll();request.onsuccess=()=>research.restore(request.result);request.onerror=()=>fail(request.error);}).catch(fail);
const receive=(event,data)=>{try{research.observe(event,data);}catch(e){research.warning='Shadow analysis error: '+e.message;research.dirty++;}};
globalThis.partOneRegimeObserver=receive;
for(const event of globalThis.partOneRegimeQueue??[])receive(...event);
globalThis.partOneRegimeQueue=[];
if(root){
  root.innerHTML=`<div class="regime-heading"><h2>Digit Regime Intelligence</h2><strong>SHADOW — DOES NOT CONTROL TRADES</strong></div>
    <p class="hint">Last-digit statistics only. Provisional research rules; metric agreement is not a win probability. No proven favorable regime yet.</p>
    <p id="regimeHealth" role="status">Waiting for the existing Part One tick feed</p><p id="regimeWarning" role="status"></p>
    <div class="regime-summary"><div>Regime <strong id="regimeState">WARMING UP</strong></div><div>Metric agreement <strong id="regimeConfidence">—</strong></div><div>Market / tick <strong id="regimeTick">—</strong></div><div>Last analysis <strong id="regimeTime">—</strong></div></div>
    <p id="regimeReasons"></p><div class="regime-scroll"><table><caption>Rolling digit windows</caption><thead><tr><th>Window</th><th>Sample</th><th>Regime</th><th>Extreme occupancy</th><th>Middle occupancy</th><th>Extreme transitions</th><th>Entropy</th><th>Distribution</th></tr></thead><tbody id="regimeWindows"></tbody></table></div>
    <p id="regimeActivity"></p><p id="regimeRevisits"></p><p id="regimePressure"></p>
    <div class="regime-summary"><div>OVER 1 support <strong id="regimeOver">—</strong></div><div>UNDER 8 support <strong id="regimeUnder">—</strong></div></div>
    <p id="regimeLatestDecision">No existing strategy signal recorded yet.</p>
    <details><summary>Live occupancy, revisits, transition matrix, runs and gaps</summary><label>Inspect window <select id="regimeInspect"></select></label><pre id="regimeMetrics"></pre></details>
    <details><summary>Short versus long changes and independent DIFFER support</summary><pre id="regimeDivergence"></pre><pre id="regimeDiffer"></pre></details>
    <details><summary>Recent regime changes</summary><pre id="regimeMemory"></pre></details>
    <details><summary>Recorded trades and hypothetical filter comparison</summary><p>Only captured, settled broker contracts are counted. Pending, missing and unknown decisions stay visible. P/L is separated by account, currency and rule configuration.</p><pre id="regimeResults"></pre></details>
    <details><summary>Shadow research settings</summary><label>Rolling windows (comma separated) <input id="regimeWindowSettings" value="25,50,100,200"></label><button id="regimeApply" type="button">Apply to shadow analysis</button><p>Changing windows starts a new research segment and resets only shadow measurements. Execution settings are unaffected.</p></details>
    <button id="regimeExport" type="button">Export research evidence</button><p id="regimeRetention" class="hint"></p>`;
  document.getElementById('regimeApply').onclick=()=>{
    try{const windows=document.getElementById('regimeWindowSettings').value.split(',').map(x=>Number(x.trim()));research.configure({windows});inspectionKey='';set('regimeWarning','Shadow windows changed; collecting a new sample.');}
    catch(e){set('regimeWarning',e.message);}
  };
  root.querySelectorAll('details').forEach(el=>el.addEventListener('toggle',()=>{lastRendered=-1;}));
  document.getElementById('regimeInspect').onchange=()=>{lastRendered=-1;};
  document.getElementById('regimeExport').onclick=()=>{
    const blob=new Blob([JSON.stringify(research.export(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='part-one-digit-regime-research.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
}
let lastRendered=-1,inspectionKey='';
function render(){
  if(!root)return;
  const age=research.lastSeen?Math.max(0,(Date.now()-research.lastSeen.receivedAt)/1000):null;
  set('regimeHealth',age===null?'Waiting for the existing Part One tick feed':age>15?`NO RECENT TICKS — feed paused, stopped or stale (${age.toFixed(0)}s). Shadow analysis cannot assess new conditions.`:`ANALYZER ACTIVE · last received tick ${age.toFixed(0)}s ago`);
  if(lastRendered===research.dirty)return;lastRendered=research.dirty;
  set('regimeWarning',research.warning??'');const s=research.latest;
  if(s){
    set('regimeState',s.state+(s.statePending?` → ${s.proposedState} (confirming ${s.evidenceStreak}/${s.config.persistence})`:''));
    set('regimeConfidence',`${fmt(s.confidence,'%')} (${s.agreement.matching}/4 agree; ${s.agreement.measured}/4 measured)`);set('regimeTick',`${s.market} / ${s.sequence}`);set('regimeTime',new Date(s.time*1000).toLocaleTimeString());
    set('regimeReasons',s.reasons.join('; ')+(s.baselineReady?'':' · Broader baseline is still warming up.'));
    const rows=document.getElementById('regimeWindows');rows.replaceChildren();
    for(const w of s.windows){const tr=document.createElement('tr');for(const text of [w.size+'T',`${w.sample}/${w.size}`,w.windowRegime,fmt(w.zones.extreme.percent,'%'),fmt(w.zones.middle.percent,'%'),fmt(w.pressure.percent,'%'),fmt(w.entropy),w.distribution]){const td=document.createElement('td');td.textContent=text;tr.append(td);}rows.append(tr);}
    const cmp=s.comparisons.find(c=>c.short===s.windows[0].size&&c.long===s.windows.at(-1).size);
    set('regimeActivity',`Recent extreme activity: ${cmp?.extremeChange.direction??'INSUFFICIENT DATA'} (${fmt(cmp?.extremeChange.delta,' pp')} versus disjoint older sample).`);
    set('regimeRevisits',`0/1 revisit frequency: ${cmp?.revisitChanges.low.direction??'INSUFFICIENT DATA'} · 8/9 revisit frequency: ${cmp?.revisitChanges.high.direction??'INSUFFICIENT DATA'}. Runs without leaving a zone are counted separately.`);
    set('regimePressure',`Extreme transition pressure: ${fmt(s.windows[0].pressure.percent,'%')} · ${cmp?.transitionChange.direction??'INSUFFICIENT DATA'} · distribution divergence ${fmt(cmp?.jsBits,' bits')}.`);
    set('regimeOver',`${s.supports.over.level} · ${s.supports.over.decision} — ${s.supports.over.reason}`);set('regimeUnder',`${s.supports.under.level} · ${s.supports.under.decision} — ${s.supports.under.reason}`);
    const key=s.windows.map(w=>w.size).join(',');if(inspectionKey!==key){inspectionKey=key;const select=document.getElementById('regimeInspect');select.replaceChildren();for(const w of s.windows){const option=document.createElement('option');option.value=w.size;option.textContent=w.size+' ticks';select.append(option);}}
    const inspected=s.windows.find(w=>w.size===Number(document.getElementById('regimeInspect').value))??s.windows[0];
    detail('regimeMetrics',inspected);detail('regimeDivergence',s.comparisons);detail('regimeDiffer',s.supports.differ.map((v,digit)=>({digit,...v})));
  }else {set('regimeState','WARMING UP');set('regimeReasons','Collecting shadow data; existing strategy is unaffected.');document.getElementById('regimeWindows').replaceChildren();for(const id of ['regimeConfidence','regimeTick','regimeTime','regimeOver','regimeUnder','regimeActivity','regimeRevisits','regimePressure','regimeMetrics','regimeDivergence','regimeDiffer'])set(id,'Waiting for current shadow measurements');}
  detail('regimeMemory',research.engine.transitionHistory.slice(-12));
  const last=research.candidates.at(-1);if(last)set('regimeLatestDecision',`Last candidate evaluation: ${last.market} tick ${last.sequence} · `+last.decisions.map(d=>`${d.type}${d.barrier===undefined?'':' '+d.barrier}: actual ${d.actualStrategy}; shadow ${d.shadow.decision} (${d.shadow.reason})`).join(' | '));
  // Evaluate only retained actual records; empty evidence is never presented as a benefit.
  if(document.getElementById('regimeResults').closest('details').open)detail('regimeResults',evaluateResearch([...research.trades.values()]));
  set('regimeRetention',`Retained: ${research.trades.size}/200 attempts, ${research.candidates.length}/500 candidate evaluations, ${research.ticks.length}/2000 ticks. Dropped: ${JSON.stringify(research.dropped)}. Trade snapshots persist in this browser; export before retention rolls over.`);
}
const timer=setInterval(()=>{try{render();}catch(e){research.warning='Research display error: '+e.message;}},500);
globalThis.addEventListener?.('pagehide',()=>clearInterval(timer),{once:true});render();
