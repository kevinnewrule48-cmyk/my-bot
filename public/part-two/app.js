import {TickEngine,WINDOWS} from './engine.js';
import {DerivFeed} from './client.js';
import {SignalEngine} from './strategy.js';
import {replay} from './replay.js';
import {requestProposal} from './payout.js';
import {Recorder} from './recorder.js';
import {setupExecution} from './execution.js';
import {independentSessionReport} from './validation.js';
import {financialChecks} from './financial-checks.js';
const $=id=>document.getElementById(id), percent=n=>n===null?'—':`${(n*100).toFixed(1)}%`;
let engine=null;
let execution=null,currentSignal=null;
let calibrationEvidence=null;
let signalEngine=new SignalEngine();
const recorder=new Recorder();let payout=null,quoteGeneration=0,recordingTick=0;
const parameters=()=>({symbol:$('market').value,type:$('side').value,barrier:Number($('barrier').value),stake:Number($('quoteStake').value)});
const invalidateQuote=()=>{payout=null;quoteGeneration++;$('payout').textContent='Request a quote for the selected market, side, barrier and stake.';};
async function loadSessions(){try{const sessions=await recorder.sessions();$('sessions').replaceChildren();for(const s of sessions){const o=document.createElement('option');o.value=s.id;o.textContent=`${s.symbol} · ${new Date(s.startedAt).toLocaleString()}`;$('sessions').append(o);}$('exportSession').disabled=!sessions.length;}catch(error){$('recordStatus').textContent=`Recording unavailable: ${error.message}`;}}
const resetScoring=()=>{signalEngine=new SignalEngine();};
for(const n of [10,25,50,75,100])for(const fast of [false,true]) {
  const option=document.createElement('option');option.value=fast?`1HZ${n}V`:`R_${n}`;option.textContent=`Volatility ${n}${fast?' (1s)':''}`;$('market').append(option);
}
$('market').value='R_100';
const color=deviation=>deviation===null?'#183329':`hsl(${deviation>=0?38:190} 45% ${15+Math.min(20,Math.abs(deviation)*180)}%)`;
function render() {
  const a=engine.analyze();
  const rawSignal=signalEngine.update(engine,$('side').value,Number($('barrier').value));
  const signal=financialChecks({signal:rawSignal,parameters:parameters(),evidence:calibrationEvidence,quote:payout,margin:Number($('margin').value)/100});
  currentSignal={signal,sequence:engine.sequence};
  if(payout){const ev=signal.pricing;$('payout').textContent=`${payout.type} ${payout.barrier} · Stake $${payout.ask.toFixed(2)} · Total payout $${payout.payout.toFixed(2)} · Profit if won $${payout.profit.toFixed(2)} · Break-even ${percent(payout.breakEven)} · Imported-session calibrated estimate ${percent(signal.calibratedProbability)} · Diagnostic EV ${ev.estimatedEV===null?'unavailable':'$'+ev.estimatedEV.toFixed(4)} · ${ev.fresh?'FRESH':'STALE'} · ${signal.reason}`;}
  $('decision').textContent=signal.decision;
  $('reason').textContent=signal.reason;
  $('checks').innerHTML=signal.checks.map(c=>`<div class="check"><b>${c.name}</b><progress max="100" value="${Math.min(100,c.value??0)}"></progress><span>${c.value===null?'Unavailable':c.value.toFixed(1)} · ${c.pass?'PASS':'FAIL'}</span></div>`).join('');
  $('contributions').textContent=signal.contributions.map(c=>`${c.name}: ${c.value.toFixed(1)} × weight ${c.weight} → ${c.contribution.toFixed(1)} points`).join(' | ')+` = ${signal.score.toFixed(1)} / 100`;
  $('patterns').textContent=signal.contexts.map(c=>`${c.context.length}-digit context [${c.context.join(', ')}]: ${c.sample} prior matches`).join(' · ')+` · Winning streak: ${signal.diagnostics.winning.active} · Same-digit streak: ${signal.diagnostics.same.active} · Alternating: ${signal.diagnostics.alternating?'yes':'no'} · Mirror: ${signal.diagnostics.mirror?'yes':'no'} · Triple: ${signal.diagnostics.triple?'yes':'no'}`;
  $('quote').textContent=a.last?.quote??'—';$('last').textContent=a.last?.digit??'—';
  $('timestamp').textContent=a.last?`${a.last.symbol} · ${new Date(a.last.timestamp*1000).toLocaleTimeString()}`:'Waiting for first live tick';
  $('sequence').textContent=`Sequence ${a.last?.sequence??0}`;$('sample').textContent=`${a.sample} / 1000`;
  $('windows').textContent=WINDOWS.map(n=>`${n}: ${a.windows[n].ready?'ready':'collecting'}`).join(' · ');
  $('recent').innerHTML=engine.history.slice(-30).map(t=>`<span>${t.digit}</span>`).join('');
  $('heatmap').innerHTML=a.digits.map(d=>`<article class="digit" style="background:${color(d.deviation)}"><b>${d.digit}</b><span class="rate">${percent(d.frequency)}</span><span>${d.state}</span><small>Δ ${d.momentum===null?'—':d.momentum.toFixed(1)+' pp'}</small><small>200t ${percent(d.longFrequency)}</small></article>`).join('');
  $('matrix').innerHTML='<thead><tr><th>From / to</th>'+Array.from({length:10},(_,d)=>`<th>${d}</th>`).join('')+'</tr></thead><tbody>'+a.matrix.map(r=>`<tr class="${r.sample<30?'muted':''}"><th>${r.previous}<small> n=${r.sample}${r.sample<30?' collecting':''}</small></th>${r.counts.map((count,d)=>`<td style="background:${color(r.probabilities[d]-.1)}">${count}<small>${percent(r.probabilities[d])}</small></td>`).join('')}</tr>`).join('')+'</tbody>';
  $('candidates').innerHTML=a.candidates.map(c=>`<tr><th>${c.type} ${c.barrier}</th><td>${percent(c.baseline)}</td><td>${percent(c.empirical)}</td><td>${percent(c.smoothed)}</td><td>${percent(c.conditional)}</td><td>${c.transitionSample}</td></tr>`).join('');
  $('export').disabled=!a.sample;
  execution?.onSignal();
}
const feed=new DerivFeed(tick=>{const accepted=engine?.add(tick);if(accepted){recordingTick++;recorder.tick(accepted).catch(error=>{feed.stop();$('recordStatus').textContent=`Recording failed: ${error.message}. Feed stopped; export earlier saved data.`;});$('recordStatus').textContent=`Recording ${recordingTick} / 10,000 ticks in this browser. Export before clearing browser data.`;render();if(recordingTick>=10000){feed.stop();$('recordStatus').textContent='Session complete: 10,000 ticks recorded. Export or start another session.';}}},status=>{$('status').textContent=status;});
$('start').onclick=()=>{invalidateQuote();feed.start($('market').value,async precision=>{engine=new TickEngine($('market').value,precision);resetScoring();recordingTick=0;await recorder.start(engine.symbol,precision);await loadSessions();render();});};
$('stop').onclick=()=>feed.stop();
$('market').onchange=()=>{invalidateQuote();feed.stop();engine=new TickEngine($('market').value,2);resetScoring();render();$('status').textContent='MARKET CHANGED — connect for verified precision';};
function barriers(){
  const over=$('side').value==='OVER';$('barrier').replaceChildren();
  for(let n=over?0:1;n<=(over?8:9);n++){const option=document.createElement('option');option.value=n;option.textContent=n;$('barrier').append(option);}
  $('barrier').value=over?'1':'8';invalidateQuote();resetScoring();if(engine)render();
}
$('side').onchange=barriers;$('barrier').onchange=()=>{invalidateQuote();resetScoring();render();};barriers();
$('quoteStake').oninput=()=>{invalidateQuote();if(engine)render();};$('margin').onchange=()=>{if(engine)render();};
$('getQuote').onclick=async()=>{
  const generation=++quoteGeneration,requested=parameters();payout=null;$('payout').textContent='Requesting read-only Deriv proposal…';
  try{const quote=await requestProposal(requested);if(generation!==quoteGeneration)return;payout=quote;
    if(recorder.session?.symbol===requested.symbol)await recorder.quote(quote,engine.sequence);
    render();
  }catch(error){if(generation===quoteGeneration)$('payout').textContent=`Quote unavailable: ${error.message}`;}
};
const freshnessTimer=setInterval(()=>{if(payout&&Date.now()-payout.receivedAt>10000){payout=null;$('payout').textContent='STALE — request a fresh quote. Automatic payout check cannot pass.';render();}},1000);
$('recording').onchange=async()=>{
  calibrationEvidence=null;
  const selected=parameters();
  try {
    const files=[...$('recording').files];if(!files.length)return;if(files.length>10||files.some(f=>f.size>4000000))throw Error('Select at most 10 recordings, each no larger than 4 MB.');
    $('replayResult').textContent='Replaying in chronological order…';
    const recordings=await Promise.all(files.map(async f=>JSON.parse(await f.text())));
    const reports=recordings.map(r=>replay(r,selected.type,selected.barrier));
    if(reports.length>1){
      const v=independentSessionReport(reports.map((r,i)=>({symbol:r.symbol,start:recordings[i].ticks[0].timestamp,end:recordings[i].ticks.at(-1).timestamp,forecasts:r.forecasts})), selected.type==='OVER'?(9-selected.barrier)/10:selected.barrier/10);
      calibrationEvidence={symbol:reports[0].symbol,type:reports[0].type,barrier:reports[0].barrier,report:v};
      $('replayResult').textContent=`Independent-session check · ${v.trainingSessions} earlier training sessions · ${v.training} training forecasts · ${v.evaluation} later evaluation forecasts · ${v.covered} covered.`;
      $('calibration').textContent=`Calibrated Brier: ${v.calibratedBrier?.toFixed(4)??'unavailable'} · Baseline: ${v.baselineBrier?.toFixed(4)??'unavailable'}\n${!v.sufficient?'INSUFFICIENT DATA':v.beatsBaseline?'Lower error than baseline in this evaluation':'Did not improve on baseline'}\n${v.note}`;
      return;
    }
    const report=reports[0];
    $('replayResult').textContent=`${report.symbol} · ${report.type} ${report.barrier} · ${report.count} shadow forecasts · ${report.wins} wins / ${report.losses} losses · Brier score ${report.brier?.toFixed(4)??'unavailable'} (lower is better). ${report.note}`;
    $('calibration').textContent=report.calibration.map(b=>`Bucket ${b.predictionBucket}%: n=${b.count}, mean estimate ${(b.meanPrediction*100).toFixed(1)}%, observed ${(b.observed*100).toFixed(1)}%, descriptive 95% interval ${(b.interval[0]*100).toFixed(1)}–${(b.interval[1]*100).toFixed(1)}%`).join('\n');
    const v=report.validation;$('calibration').textContent+=`\n\nHeld-out validation: ${v.training} training / ${v.evaluation} evaluation forecasts; ${v.covered} covered by trained buckets.\nRaw Brier: ${v.rawBrier?.toFixed(4)??'unavailable'} · Calibrated Brier: ${v.calibratedBrier?.toFixed(4)??'unavailable'} · Baseline Brier: ${v.baselineBrier?.toFixed(4)??'unavailable'}\n${v.sufficient?'Minimum evaluation sample reached—not execution approval.':'INSUFFICIENT evaluation sample.'} ${v.note}`;
  }catch(error){$('replayResult').textContent=`Replay rejected: ${error.message}`;$('calibration').textContent='';}
  finally{render();}
};
$('export').onclick=()=>{
  if(!engine?.history.length)return;
  const blob=new Blob([JSON.stringify({schema:'consent-atm-part-two-ticks-v1',symbol:engine.symbol,precision:engine.precision,ticks:engine.history},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`part-two-${engine.symbol}-${Date.now()}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
window.addEventListener('pagehide',()=>feed.stop());
window.addEventListener('pagehide',()=>clearInterval(freshnessTimer));
$('exportSession').onclick=async()=>{try{const recording=await recorder.export($('sessions').value);const url=URL.createObjectURL(new Blob([JSON.stringify(recording)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`part-two-session-${recording.session.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){$('recordStatus').textContent=`Export failed: ${error.message}`;}};
engine=new TickEngine('R_100',2);render();
loadSessions();
execution=setupExecution({parameters,readSignal:()=>currentSignal});
