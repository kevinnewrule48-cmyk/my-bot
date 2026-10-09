import {BALANCE_MARKETS,BARRIERS} from './balance-engine.js';
export function scaleRegion(c){const depth=Math.abs(c.scalePosition);return `${c.label} · ${depth<10?'near center':depth<25?'developing':depth<50?'established':'deep'} displacement`;}
export class BalanceEvidence{
 constructor({storage=globalThis.localStorage}={}){this.storage=storage;this.records=new Map();this.pending=new Map();this.warning='';try{for(const r of JSON.parse(storage?.getItem('partOneBalanceEvidence')??'[]'))if(r.contractId)this.records.set(String(r.contractId),r);}catch{this.warning='Previous balance evidence could not be read';}}
 attempt(candidate,balanceState){this.pending.set(candidate.id,{candidate,balanceState});if(this.pending.size>200)this.pending.delete(this.pending.keys().next().value);}
 receipt(r){if(!r?.contractId||!r.candidate||!r.balanceState)return;const key=String(r.contractId),previous=this.records.get(key);if(previous?.state==='settled')return;
  if(r.contractMismatch||r.type!==r.candidate.contractType||r.barrier!==r.candidate.barrier){this.warning='Contract identity mismatch: excluded from balance results';return;}
  const row={contractId:key,decisionId:r.decisionId,decision:r.decision,attemptId:r.attemptId,accountId:r.accountId??r.lifecycle?.accountId,accountType:r.accountType,currency:r.currency,candidate:r.candidate,balanceState:r.balanceState,region:scaleRegion(r.candidate),entry:r.lifecycle?.entryDigit??null,settlement:r.lifecycle?.settlementDigit??null,
   state:r.state,status:r.status??r.lifecycle?.status,profit:Number.isFinite(r.profit)?r.profit:null,payout:r.payout??null,buyPrice:r.buyPrice??null,source:r.evidenceSource==='mock'?'MOCK':'BROKER',completedAt:r.completedAt??Date.now()};
  if(!previous&&this.records.size>=250&&![...this.records.values()].some(x=>x.state==='settled')){this.warning='Evidence capacity reached; export records';return;}this.records.set(key,row);while(this.records.size>250){const old=[...this.records.values()].find(x=>x.state==='settled');if(!old){this.warning='Evidence capacity reached; export records';break;}this.records.delete(old.contractId);}
  try{this.storage?.setItem('partOneBalanceEvidence',JSON.stringify([...this.records.values()]));}catch{this.warning='Balance evidence storage failed; export in-memory results';}
 }
 report(){const records=[...this.records.values()].filter(r=>r.source==='BROKER'&&r.state==='settled'&&['won','lost'].includes(r.status)&&r.profit!==null),groups={};
  for(const r of records){const key=[r.accountId,r.accountType,r.currency,r.candidate.analysisVersion,r.region].join(' / ');const g=groups[key]??={trades:0,wins:0,losses:0,netPL:0};g.trades++;g[r.status==='won'?'wins':'losses']++;g.netPL+=r.profit;g.winRate=100*g.wins/g.trades;}
  return {records:[...this.records.values()],groups,warning:this.warning,note:'Descriptive retained broker outcomes; no proven relationship between greater displacement and accuracy. Mock results excluded. No automatic tuning.'};
 }
}
export function mountBalanceScale({book,evidence,getExecution=()=>({}),execute=()=>{},container}){
 const root=document.createElement('section');root.className='balance-instrument';root.id='balanceInstrument';
 root.innerHTML=`<header><div><span class="balance-eyebrow">PART ONE · DIGIT BALANCE</span><h2>AI Balance Scale</h2></div><strong id="balanceStatus">COLLECTING DATA</strong></header>
 <div class="balance-controls"><label>Inspect market<select id="balanceInspect">${BALANCE_MARKETS.map(s=>`<option ${s===book.inspectedMarket?'selected':''}>${s}</option>`).join('')}</select></label><span id="balanceExecutionMarket"></span></div>
 <div class="balance-scale" role="img" aria-label="Continuous live digit balance; left OVER, center neutral, right UNDER"><div class="balance-graduations"></div><div class="balance-beam"></div><div class="balance-center"></div><div id="balanceWeight" class="balance-weight"><span id="balancePosition">0.0</span></div><div id="balanceMarkers"></div></div>
 <div class="balance-labels"><b>OVER 2</b><b>OVER 1</b><b>CENTER</b><b>UNDER 8</b><b>UNDER 7</b></div>
 <p class="balance-caption" id="balanceHeadline">Waiting for independent live market analysis.</p><div id="balanceMetrics" class="balance-metrics"></div>
 <div class="balance-decision" id="authoritativeAutoDecision" aria-live="polite"></div><div class="balance-controls"><label>Manual exploration<select id="balanceManual"><option value="">Choose candidate</option>${BARRIERS.map(c=>`<option value="${c.direction}:${c.barrier}" >${c.direction} ${c.barrier}</option>`).join('')}</select></label><button type="button" id="balanceManualExecute">Execute inspected candidate · Demo</button></div>
 <p id="balancePermission"></p><details><summary>Four candidates · why no trade?</summary><div id="balanceChecks"></div></details><details><summary>Entry markers, settled results and accuracy by scale region</summary><pre id="balanceEvidence"></pre><button id="balanceExport" type="button">Export balance evidence</button></details>
 <p class="balance-caption">Descriptive condition measurements—not a next-digit prediction. FULLY QUALIFIED does not mean a guaranteed win. Inspecting a market never changes Auto execution.</p>`;
 (container??document.querySelector('.compact-column')??document.getElementById('analysisColumn')??document.querySelector('main')).prepend(root);
 const el=id=>root.querySelector('#'+id),put=(id,v)=>{const e=el(id);if(e.textContent!==String(v))e.textContent=String(v);};
 el('balanceInspect').onchange=()=>{book.inspect(el('balanceInspect').value);globalThis.partOneRegimeObserver?.('inspect',{market:book.inspectedMarket});render();};
 el('balanceManual').onchange=()=>{if(!el('balanceManual').value){book.manualSelection={direction:null,barrier:null};render();return;}const [direction,b]=el('balanceManual').value.split(':');book.manual(direction,Number(b));render();};
 el('balanceManualExecute').onclick=()=>{const c=book.current(book.inspectedMarket)?.candidates.find(c=>c.direction===book.manualSelection.direction&&c.barrier===book.manualSelection.barrier);if(c&&book.available(c))execute(c);};
 el('balanceExport').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(evidence.report(),null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='part-one-balance-evidence.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 function render(){const s=book.current(book.inspectedMarket),x=getExecution(),now=book.now(),age=s?now-s.createdAt:Infinity;
  put('balanceExecutionMarket',`Execution: ${x.market??book.executionMarket} · ${x.mode??'manual'}`);
  put('balanceStatus',x.feedError?'FEED ERROR':!Number.isFinite(now)?'WAITING FOR LIVE CLOCK':!s?(x.feed??'COLLECTING DATA'):age>5000?'FEED STALE':s.status);
  const pos=s?.position??0;el('balanceWeight').style.left=`${50+pos/2}%`;put('balancePosition',pos.toFixed(1));
  const candidate=s?.candidates.find(c=>c.direction===book.manualSelection.direction&&c.barrier===book.manualSelection.barrier);
  put('balanceHeadline',s?`${s.market} · ${s.lean} lean · current analysis candidate ${s.selected?.label??'NONE'} · latest analysis ${new Date(s.createdAt).toLocaleTimeString()}`:(x.feedError??'Waiting for normalized ticks.'));
  const decision=x.decision,dc=decision?.candidate,decisionDisplayState=decision&&(!Number.isFinite(now)||now>decision.expiresAt)&&!['PURCHASED','SETTLED','BLOCKED'].includes(x.decisionState)?'EXPIRED · NO NEW PURCHASE':x.decisionState;
  put('authoritativeAutoDecision',decision?`AUTO DECISION · ${decisionDisplayState}\n${dc.market} · ${dc.label} · support ${(100*dc.observed).toFixed(1)}%\nDecision: ${decision.decisionId}\n${x.decisionError??''}`:'AUTO DECISION · ANALYZING · no locked decision');
  const b=s?.broadBalance,f=s?.fine,c=s?.selected??s?.candidates.filter(c=>c.direction===s.lean).sort((a,b)=>b.excessSupport-a.excessSupport)[0];
  const metrics={'Low boundary':b?.lowPressure,'High boundary':b?.highPressure,'Middle support':b?.middleSupport,'Circulation changes':f?.circulation.changes,'Stability':f?.stability,'Candidate strength':c?.strength};
  el('balanceMetrics').replaceChildren(...Object.entries(metrics).map(([name,value])=>{const e=document.createElement('div');e.textContent=`${name}: ${Number.isFinite(value)?value.toFixed(1)+'%':'—'}`;return e;}));
  const detail=document.createElement('div');detail.textContent=`Barrier: ${c?.barrier??'—'} · clearance: ${c?.clearance.toFixed(2)??'—'} · ${c?.deterioration?'DETERIORATING':'no current deterioration veto'}`;el('balanceMetrics').append(detail);
  const allowed=!!candidate&&book.available(candidate)&&x.mode==='manual'&&x.account?.accountType==='demo'&&!x.busy;
  el('balanceManualExecute').disabled=!allowed;
  put('balancePermission',`Manual ${candidate?.label??(book.manualSelection.direction?book.manualSelection.direction+' '+book.manualSelection.barrier:'not selected')}: ${candidate?.status??'CHOOSE A CANDIDATE'} · clearance ${candidate?.clearance.toFixed(2)??'—'} · ${candidate?.deterioration?'DETERIORATING':'no deterioration veto'} · Authorization: ${allowed?'CURRENT MANUAL CLICK AVAILABLE':x.authorization??'OFF'}`);
  el('balanceChecks').replaceChildren(...(s?.candidates??[]).map(c=>{const p=document.createElement('p');p.textContent=`${c.label} · ${c.status} · ${c.checks.map(k=>`${k.name}: ${Number.isFinite(k.value)?k.value.toFixed(2):'unknown'} / ${k.required} [${k.pass?'PASS':'FAIL'}]`).join(' · ')}`;return p;}));
  if(el('balanceEvidence').closest('details').open)put('balanceEvidence',JSON.stringify(evidence.report(),null,2));
  const markers=[...evidence.records.values()].filter(r=>r.candidate.market===book.inspectedMarket).slice(-6);
  el('balanceMarkers').replaceChildren(...markers.map(r=>{const m=document.createElement('span');m.className='balance-marker '+(r.status??'entry');m.style.left=`${50+r.candidate.scalePosition/2}%`;m.textContent=r.status==='won'?'W':r.status==='lost'?'L':'E';m.title=`${r.contractId} · ${r.candidate.label} · ${r.status??'entry'}`;return m;}));
 }
 render();const timer=setInterval(render,250);globalThis.addEventListener?.('pagehide',()=>clearInterval(timer),{once:true});return {root,render,stop:()=>clearInterval(timer)};
}
