// Read-only explanations. Trade eligibility always comes from engine checks.
const number=(v,d=2)=>Number.isFinite(v)?v.toFixed(d):'Unavailable';
const percent=v=>number(v)+'%';
export const GATES=['history','fresh','pressure','alignment','slopes','structure','strength','momentum','persistence','chop','efficiency','volatility','deceleration','pullback','confidence'];
export function chopBreakdown(a){
 const w=a.windows?.[a.config.short],balance=w?100-Math.abs(w.up-w.down):null;
 return [['Tick alternation',.22,a.tickAlternation],['Candle alternation',.10,a.candleAlternation],['100 − efficiency',.20,Number.isFinite(a.efficiency)?100-a.efficiency:null],['EMA compression',.12,a.emaCompression],['Range compression',.08,a.rangeCompression],['Pressure balance',.12,balance],['Failed breakouts',.08,a.failedBreakouts],['100 − persistence',.08,Number.isFinite(a.persistence)?100-a.persistence:null]].map(([name,weight,value])=>({name,weight,value,contribution:Number.isFinite(value)?weight*value:null}));
}
export function directionState(a){
 if(a.sample<a.need)return 'ANALYZING';
 if(a.winner)return a.winner.name+' READY';
 if(a.config.analysisMode&&a.candidates?.length){const b=[...a.candidates].sort((x,y)=>y.confidence-x.confidence)[0];return b.name+' '+b.balanced.state;}
 const developing=(a.candidates??[]).find(c=>a.windows[a.config.micro][c.sign===1?'up':'down']>50&&a.windows[a.config.short][c.sign===1?'up':'down']>50&&c.persistence>50);
 if(!developing)return a.marketState==='CHOPPY'?'CHOPPY':'NO TRADE';
 const count=Object.values(developing.checks).filter(Boolean).length;
 if(count>=12)return developing.name+' CANDIDATE';
 if(developing.checks.alignment&&developing.checks.structure&&developing.checks.strength)return developing.sign===1?'UPTREND':'DOWNTREND';
 return developing.sign===1?'DEVELOPING UP':'DEVELOPING DOWN';
}
export function candidateDetails(a,side,now=Date.now()){
 const c=a.config,dir=side.sign,ps=dir===1?'up':'down',warm=a.sample<a.need;
 if(side.balanced){
  const m=side.balanced.metrics;
  const values={history:[a.sample,`>= ${a.need}`],fresh:[Number.isFinite(a.epoch)?(now-a.epoch*1000)/1000:'Unavailable',`-2 to ${c.staleMs/1000} seconds`],severeChop:[m.chop,'< 65'],opposition:[`${m.pressure.toFixed(2)} / ${m.shortPressure.toFixed(2)}`,'micro > 40 and short > 45'],reversal:[m.reversalRisk,'< 60'],exhaustion:[m.exhaustion,'< 70'],volatility:[a.volatility,'0.05 to 4'],direction:[m.velocity,'> 0'],agreement:[m.agreement,'>= 4 of 6'],evidence:[m.score,'>= 68']};
  const rows=Object.entries(side.checks).map(([gate,pass])=>({gate,label:gate,value:typeof values[gate][0]==='number'?number(values[gate][0]):values[gate][0],required:values[gate][1],pass,reason:pass?'Passed':`${gate}: ${values[gate][0]}; requires ${values[gate][1]}`}));
  return {name:side.name,type:side.type,ready:side.ready,passed:rows.filter(r=>r.pass).length,total:rows.length,rows,components:{...m,...Object.fromEntries(Object.entries(side.balanced.support).map(([k,v])=>['weighted '+k,v]))}};
 }
 const rows=[];
 const add=(gate,label,value,required,pass=side.checks?.[gate])=>rows.push({gate,label,value,required,pass:pass===true,reason:pass===true?'Passed':warm&&gate!=='history'&&gate!=='fresh'?'Not evaluated: history warm-up incomplete':`${label}: ${value}; requires ${required}`});
 add('history','History',`${a.sample} retained ticks`,`${a.need} or more`,a.sample>=a.need);
 const age=Number.isFinite(a.epoch)?now-a.epoch*1000:null;
 add('fresh','Feed age',age===null?'No tick received':number(age/1000)+' seconds',`−2 to ${c.staleMs/1000} seconds`,age!==null&&age>=-2000&&age<=c.staleMs);
 for(const n of [c.micro,c.short,c.mediumWindow,c.structural,...(c.macro?[500]:[])])add('pressure',`${n}-tick ${side.name.toLowerCase()} pressure`,percent(a.windows?.[n]?.[ps]),`≥ ${c.pressure}%`,!warm&&a.windows?.[n]?.ready&&a.windows[n][ps]>=c.pressure);
 add('alignment','EMA alignment',[a.ema?.fast,a.ema?.medium,a.ema?.slow].map(x=>number(x,5)).join(' / '),dir===1?'Fast > medium > slow':'Fast < medium < slow');
 for(const [i,label]of ['Fast EMA slope','Medium EMA slope','Slow EMA slope','Price slope'].entries()){const v=i===3?a.priceSlope:a.ema?.slopes[i];add('slopes',label,number(v,8),dir===1?'> 0':'< 0',!warm&&Number.isFinite(v)&&dir*v>0);}
 add('structure','Price structure',a.structure?Object.entries(a.structure).filter(([,v])=>v).map(([k])=>k.toUpperCase()).join(', ')||'No directional structure':'Unavailable',dir===1?'HH and HL':'LH and LL');
 add('strength','Trend strength',percent(a.trendStrength),`≥ ${c.minStrength}%`);
 add('momentum','Directional velocity',number(a.velocity,8),dir===1?'> 0':'< 0',!warm&&Number.isFinite(a.velocity)&&dir*a.velocity>0);
 add('momentum','Momentum',percent(side.momentum),`≥ ${c.pressure}%`,!warm&&side.momentum>=c.pressure);
 add('persistence','Directional persistence',percent(side.persistence),`≥ ${c.minPersistence}%`);
 add('chop','Chop score',percent(a.chop),c.chopFilter===false?'OFF — observed, not blocking':`≤ ${c.maxChop}%`);
 if(c.chopFilter===false){rows.at(-1).disabled=true;rows.at(-1).reason='Chop filter off; measurement and confidence contribution remain active';}
 add('efficiency','Short-window efficiency',percent(a.efficiency),`≥ ${c.minEfficiency}%`);
 add('volatility','Relative volatility',number(a.volatility,4),`${c.minVolatility} to ${c.maxVolatility}`);
 add('deceleration','Deceleration',`current ${number(dir*a.velocity,8)} / prior ${number(dir*a.oldVelocity,8)}`,`If prior directional velocity > 0, current ≥ ${(1-c.maxDeceleration).toFixed(2)} × prior`);
 add('pullback','Pullback',percent(side.pullback),'≤ 35%');
 add('confidence','Confidence score',percent(side.confidence),`≥ ${c.confidence}%`);
 const eligible=a.candidates?.filter(x=>x.ready).length??0;
 add('selection','Unique qualifying direction',String(eligible),'Exactly one READY candidate',eligible===1&&side.ready);
 return {name:side.name,type:side.type,ready:side.ready===true,passed:GATES.filter(k=>!(k==='chop'&&c.chopFilter===false)&&side.checks?.[k]===true).length,total:GATES.length-(c.chopFilter===false?1:0),rows,
  components:{candleDirection:a.lastCandle?(a.lastCandle.close>a.lastCandle.open?'UP':a.lastCandle.close<a.lastCandle.open?'DOWN':'FLAT'):'Unavailable',bodyStrength:side.bodyStrength,continuation:side.continuation,reversalPressure:side.reversalPressure,tickAlternation:a.tickAlternation,candleAlternation:a.candleAlternation,emaCompression:a.emaCompression,rangeCompression:a.rangeCompression,failedBreakouts:a.failedBreakouts}};
}
export function explain(a,now=Date.now()){
 return (a.candidates?.length?a.candidates:[{name:'RISE',type:'CALL',sign:1},{name:'FALL',type:'PUT',sign:-1}]).map(s=>candidateDetails(a,s,now));
}
export function strategyStatus(a){
 if(a.sample<a.need)return 'ANALYZING';
 if(a.winner)return a.winner.name+' READY';
 if(a.config.analysisMode&&a.candidates?.length){const b=[...a.candidates].sort((x,y)=>y.confidence-x.confidence)[0];return b.name+' '+b.balanced.state;}
 const direction=directionState(a);
 if(direction==='DEVELOPING UP')return 'RISE DEVELOPING';
 if(direction==='DEVELOPING DOWN')return 'FALL DEVELOPING';
 if(a.marketState==='CHOPPY'&&a.config.chopFilter!==false)return 'CHOPPY MARKET';
 const sides=[...(a.candidates??[])].sort((x,y)=>Object.values(y.checks).filter(Boolean).length-Object.values(x.checks).filter(Boolean).length);
 const best=sides[0];
 if(!best)return 'ANALYZING';
 const count=Object.values(best.checks).filter(Boolean).length;
 if(count>=12)return 'WAITING FOR CONFIRMATION';
 if(best.checks.alignment&&best.checks.structure&&count>=8)return best.name+' DEVELOPING';
 return 'ANALYZING';
}
export function monitorStatus(a,execution,orders=[],now=Date.now()){
 const strategy=strategyStatus(a),active=orders.find(o=>['PROPOSAL','BUY_PENDING','OPEN'].includes(o.state));
 const latest=[...orders].filter(o=>o.state==='SETTLED'&&['won','lost'].includes(o.result)).sort((x,y)=>(y.settledAt??0)-(x.settledAt??0))[0];
 const blockers=execution?.blockers??['Demo execution is not connected'];
 const authFailed=(execution?.checks??[]).some(c=>['authentication','demo','connection','heartbeat','auto'].includes(c.key)&&!c.pass)||blockers.some(x=>/authenticat|session|Auto off|connect.*demo/i.test(x));
 const customLimit=(execution?.checks??[]).some(c=>c.key==='budget'&&!c.pass);
 const unresolved=orders.some(o=>o.state==='UNKNOWN');
 const status=active?.state==='OPEN'?'WAITING FOR SETTLEMENT':active?'EXECUTING':unresolved?'EXECUTION ERROR':authFailed?'SESSION/AUTHORIZATION ERROR':customLimit?'CUSTOM LIMIT REACHED':execution?.error?'EXECUTION ERROR':blockers.length?(blockers.every(x=>/signal episode/i.test(x))?'WAITING FOR NEXT SIGNAL':'EXECUTION ERROR'):a.winner?'READY':'NO TRADE — strategy rejected setup';
 return {status,strategy,blockers,lastResult:latest?.result?.toUpperCase()??'None recorded',lastExecutedAt:Math.max(0,...orders.map(o=>o.buyConfirmedAt??0))||null};
}
export class DiagnosticLog{
 constructor({limit=400,source='public'}={}){this.limit=Math.max(2,Math.min(2000,limit));this.source=source;this.records=[];this.total=0;this.rejections={};this.lastKey=null;this.lastQualifiedAt=null;this.lastEvaluationAt=null;this.lastSequence=null;this.lastMetrics=null;this.metricsChangedAt=null;this.lastQuote=null;this.metricsFrozen=false;this.startedAt=Date.now();}
 observe(a,now=Date.now(),execution={blockers:[]},health={}){
  const key=JSON.stringify([a.symbol,a.sequence,a.candidates?.map(s=>s.checks.fresh),execution.blockers,health.state,health.error]);
  if(key===this.lastKey)return;
  const newTick=a.sequence!==this.lastSequence;this.lastKey=key;this.lastEvaluationAt=now;
  if(newTick){const signature=JSON.stringify([a.ema,a.trendStrength,a.chop,a.efficiency,a.velocity,a.candidates?.map(s=>[s.momentum,s.persistence,s.confidence])]);
   if(signature!==this.lastMetrics){this.metricsChangedAt=now;this.metricsFrozen=false;}
   else if(a.quote!==this.lastQuote&&a.sample>=a.need&&now-(this.metricsChangedAt??now)>30000)this.metricsFrozen=true;
   this.lastMetrics=signature;this.lastQuote=a.quote;this.lastSequence=a.sequence;
  }
  if(a.winner&&newTick&&a.signalId!==this.lastQualifiedSignal){this.lastQualifiedAt=now;this.lastQualifiedSignal=a.signalId;}
  for(const side of explain(a,now)){const rejected=side.rows.filter(r=>!r.pass);for(const gate of new Set(rejected.map(r=>r.gate)))this.rejections[side.name+':'+gate]=(this.rejections[side.name+':'+gate]??0)+1;
   this.records.push({source:this.source,evaluatedAt:now,symbol:a.symbol,sequence:a.sequence,epoch:a.epoch,quote:a.quote,tick:a.tickTrace,side:side.name,ready:side.ready,passed:side.passed,total:side.total,rows:side.rows,components:side.components,chop:{score:a.chop,threshold:a.config.analysisMode?65:a.config.maxChop,blocking:!!a.config.analysisMode||a.config.chopFilter!==false,inputs:chopBreakdown(a)},executionBlockers:[...execution.blockers],health:{...health}});this.total++;
  }
  if(this.records.length>this.limit)this.records.splice(0,this.records.length-this.limit);
 }
 summary(){return {source:this.source,startedAt:this.startedAt,totalCandidates:this.total,retainedCandidates:this.records.length,retentionLimit:this.limit,lastQualifiedAt:this.lastQualifiedAt,lastEvaluationAt:this.lastEvaluationAt,lastSequence:this.lastSequence,metricsChangedAt:this.metricsChangedAt,metricsFrozen:this.metricsFrozen,rejections:{...this.rejections}};}
 export(){return {...this.summary(),records:this.records};}
}
export function healthWarnings(a,health,now=Date.now(),summary={}){
 const warnings=[];
 if(health.error)warnings.push(health.error);
 if(health.state==='closed'||health.state==='failed')warnings.push('Market subscription disconnected or failed');
 if(health.startedAt&&now-health.startedAt>15000&&!health.subscribed)warnings.push('No confirmed live tick subscription after 15 seconds');
 if(a.epoch&&now-a.epoch*1000>a.config.staleMs)warnings.push(`Stale market feed: last tick ${number((now-a.epoch*1000)/1000,1)} seconds ago`);
 if(a.epoch&&a.epoch*1000>now+2000)warnings.push('Broker clock mismatch: latest tick is in the future');
 if(health.lastReceivedAt&&now-health.lastReceivedAt<=a.config.staleMs&&health.lastAcceptedAt&&now-health.lastAcceptedAt>a.config.staleMs)warnings.push('Ticks arrive but are rejected as duplicate, out of order, wrong-symbol or invalid');
 if(summary.lastSequence!=null&&a.sequence!==summary.lastSequence)warnings.push('Analysis evaluation has not caught up with accepted ticks');
 if(health.lastAcceptedSequence!=null&&health.lastAcceptedSequence!==a.sequence)warnings.push('ANALYZER STALLED: incoming accepted ticks are ahead of the last analysis');
 if(summary.metricsFrozen)warnings.push('Possible frozen indicators: prices changed but all tracked metrics and EMAs stayed unchanged for over 30 seconds');
 return [...new Set(warnings)];
}
