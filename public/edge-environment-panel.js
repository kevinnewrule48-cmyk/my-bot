export function mountEnvironmentPanel(host,read){
 host.className='panel edge-environment-panel';host.innerHTML='<div class="card-heading"><h2>Edge & price environment</h2><span>EDGE → ENTRY</span></div><p class="hint">Low/high edge pressure and avoidance feed the entry scale. Overall edge score and price volatility add context; neither has an entry cutoff.</p><div class="environment-rows"></div><details><summary>Selected market measurements</summary><pre class="environment-detail"></pre></details><p class="hint">Demo entries follow current scale direction and consecutive avoidance of the chosen losing digits. No minimum score or support percentage. No score predicts the next digit.</p>';
 let selected='R_100';const rows=host.querySelector('.environment-rows'),detail=host.querySelector('.environment-detail');const buttons=new Map();
 for(const m of ['R_10','R_25','R_50','R_75','R_100']){const b=document.createElement('button');b.type='button';b.className='environment-row';b.innerHTML='<span></span><meter min="0" max="100"></meter><small></small>';b.onclick=()=>{selected=m;host.querySelector('details').open=true;render();};b.setAttribute('aria-label','Inspect environment '+m);buttons.set(m,b);rows.append(b);}
 const fmt=n=>Number.isFinite(n)?n.toFixed(2):n===Infinity?'infinite':'—';
 function render(){const data=read();for(const [m,b]of buttons){const s=data?.get(m),e=s?.environment;
  // Arrival freshness is supplied by the trusted clock when available.
  const now=host.dataset.brokerNow?Number(host.dataset.brokerNow):null;const stale=s&&(performance.now()-s.receivedAt>5000||(now!==null&&e&&now/1000-e.lastEpoch>5));
  b.querySelector('span').textContent=m+' · '+(e?fmt(e.score)+'/100 '+e.category:'COLLECTING');b.querySelector('meter').value=e?.score??0;b.querySelector('small').textContent=e?(stale?'FEED STALE · ':'')+'PRICE '+e.price.level+' / '+e.price.stability+' · LOW '+fmt(e.low.pressure)+' '+e.low.trend+' · HIGH '+fmt(e.high.pressure)+' '+e.high.trend:'Waiting for independent ticks';b.setAttribute('aria-pressed',String(selected===m));}
 const s=data?.get(selected),e=s?.environment;if(!e){detail.textContent=selected+' · waiting for data';return;}
 detail.textContent=[selected+' · '+e.sample+' ticks · '+new Date(e.lastEpoch*1000).toLocaleTimeString(),
 'EDGE '+fmt(e.score)+' / 100 · '+e.category,'LOW 0/1 '+fmt(e.low.pressure)+' '+e.low.trend+' · slope '+fmt(e.low.slope)+' · acceleration '+fmt(e.low.acceleration),
 'HIGH 8/9 '+fmt(e.high.pressure)+' '+e.high.trend+' · slope '+fmt(e.high.slope)+' · acceleration '+fmt(e.high.acceleration),
 'Cross-edge '+fmt(e.crossRate)+'% · same-edge '+fmt(e.sameRate)+'%',
 'Ticks since low/high: '+(e.low.ticksSince??'not seen')+' / '+(e.high.ticksSince??'not seen'),
 'Seconds since low/high: '+(e.low.secondsSince??'not seen')+' / '+(e.high.secondsSince??'not seen'),
 'Average visit gaps low/high: '+fmt(e.low.averageGap)+' / '+fmt(e.high.averageGap)+' · gap change '+fmt(e.low.gapChange)+' / '+fmt(e.high.gapChange),
 'PRICE mean absolute tick range '+fmt(e.price.short?.tickRange)+' · variance '+fmt(e.price.short?.variance)+' · standard deviation '+fmt(e.price.short?.stddev),
 'Baseline deviation '+fmt(e.price.deviation)+' · ratio '+fmt(e.price.ratio)+' · '+e.price.expansion,
 'PRICE '+e.price.level+' / '+e.price.stability,
 'Entry evidence: low edge avoided '+e.low.separation+' ticks; high edge avoided '+e.high.separation+' ticks. See the scale for the authoritative candidate and execution state.'].join('\n');}
 return render;
}
