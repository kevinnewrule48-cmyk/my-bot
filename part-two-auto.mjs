import {readFile,stat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {TickEngine} from './public/part-two/engine.js';
import {SignalEngine} from './public/part-two/strategy.js';
import {replay} from './public/part-two/replay.js';
import {independentSessionReport} from './public/part-two/validation.js';

const key=o=>`${o.symbol}:${o.type}:${o.barrier}`;
export function lowerBound(wins,n){if(!n)return 0;const z=1.96,p=wins/n;return (p+z*z/(2*n)-z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n)))/(1+z*z/n);}
export function assessBundle(bundle,now=Date.now()){
  if(bundle?.schema!=='part-two-reviewed-calibration-v1'||typeof bundle.reviewId!=='string'||!bundle.reviewId.trim())throw Error('A reviewed server calibration bundle is required.');
  if(!Number.isFinite(bundle.expiresAt)||bundle.expiresAt<=now||bundle.expiresAt>now+7*86400000)throw Error('Calibration bundle is expired or its expiry exceeds seven days.');
  if(!Array.isArray(bundle.recordings)||bundle.recordings.length<2||bundle.recordings.length>10)throw Error('Calibration requires 2–10 independent sessions.');
  const reports=bundle.recordings.map(r=>replay(r,bundle.type,bundle.barrier));
  const sessions=reports.map((r,i)=>({symbol:r.symbol,start:bundle.recordings[i].ticks[0].timestamp,end:bundle.recordings[i].ticks.at(-1).timestamp,forecasts:r.forecasts}));
  if(sessions.some(s=>s.end*1000>=now))throw Error('Calibration cannot contain future prices.');
  const baseline=bundle.type==='OVER'?(9-bundle.barrier)/10:bundle.barrier/10;
  const report=independentSessionReport(sessions,baseline,{minBin:100,minEvaluation:500});
  if(!report.sufficient||!report.beatsBaseline||report.covered/report.evaluation<.95)throw Error('Independent-session calibration did not pass sample, coverage and baseline checks.');
  const heldout=[...sessions].sort((a,b)=>a.start-b.start).at(-1);
  const bins=report.bins.map(b=>{
    const rows=heldout.forecasts.filter(f=>Math.round(f.probability*20)*5===b.bucket);
    return {...b,evaluationCount:rows.length,lower:rows.length>=100?lowerBound(rows.filter(f=>f.won).length,rows.length):null};
  });
  return {symbol:sessions[0].symbol,type:bundle.type,barrier:bundle.barrier,expiresAt:bundle.expiresAt,reviewId:bundle.reviewId,bins,report};
}
export function analyzeServerHistory(history,order,now=Date.now()){
  if(!Array.isArray(history?.prices)||!Array.isArray(history?.times)||history.prices.length!==history.times.length||history.times.length<500||history.times.length>1000)throw Error('Server live history is incomplete.');
  const engine=new TickEngine(order.symbol,order.precision),signals=new SignalEngine();let signal,previous=null;
  for(let i=0;i<history.times.length;i++){
    const epoch=history.times[i];
    if(!Number.isFinite(epoch)||(previous!==null&&(epoch<=previous||epoch-previous>(order.symbol.startsWith('1HZ')?3:6))))throw Error('Server history has a gap or invalid ordering.');
    engine.add({symbol:order.symbol,epoch,quote:history.prices[i]});signal=signals.update(engine,order.type,order.barrier);previous=epoch;
  }
  if(now-previous*1000>5000||previous*1000>now+1000)throw Error('Server market history is stale.');
  return {signal,epoch:previous,times:history.times};
}
export function checkAutoEdge(model,signal,ask,payout){
  const failed=signal.checks.filter(c=>!['Calibrated confidence','Payout / EV'].includes(c.name)&&!c.pass);
  if(failed.length)throw Error(`Waiting for ${failed.map(c=>c.name).join(', ')}.`);
  const bin=model.bins.find(b=>b.bucket===Math.round(signal.modelProbability*20)*5);
  if(!bin||!Number.isFinite(bin.estimate)||!Number.isFinite(bin.lower)||bin.estimate<.65||bin.lower<.65)throw Error('Validated confidence unavailable or below 65%.');
  if(!Number.isFinite(ask)||!Number.isFinite(payout)||ask<=0||payout<=ask||bin.lower<=ask/payout+.02)throw Error('Actual payout fails the conservative 2 percentage-point edge margin.');
  return {probability:bin.estimate,conservativeProbability:bin.lower,expectedValue:bin.lower*payout-ask,reviewId:model.reviewId};
}
export function createAutoAuthority({modelFile,now=Date.now}={}){
  const armed=new Map();let modelPromise;
  async function model(){
    if(!modelFile)throw Error('No reviewed calibration bundle is installed on the server.');
    modelPromise??=(async()=>{if((await stat(modelFile)).size>40000000)throw Error('Calibration bundle too large');return assessBundle(JSON.parse(await readFile(modelFile,'utf8')),now());})();
    const m=await modelPromise;if(m.expiresAt<=now())throw Error('Server calibration expired');return m;
  }
  function active(owner,order,generation){const state=armed.get(`${owner}:${order.accountId}`);if(!state||state.until<=now()||key(state)!==key(order)||state.stake!==order.stake||(generation&&state.generation!==generation))throw Error('Auto stopped, changed or its heartbeat expired.');return state;}
  return {
    async status(){try{const m=await model();return {available:true,symbol:m.symbol,type:m.type,barrier:m.barrier,reviewId:m.reviewId,expiresAt:m.expiresAt};}catch(e){return {available:false,reason:e.message};}},
    async start(owner,order,cooldown){const m=await model();if(key(m)!==key(order))throw Error('No validated model for this selected contract.');if(!Number.isInteger(cooldown)||cooldown<1||cooldown>30)throw Error('Cooldown must be 1–30 ticks');const state={...order,cooldown,generation:randomUUID(),until:now()+15000};armed.set(`${owner}:${order.accountId}`,state);return state.generation;},
    stop(owner,accountId){armed.delete(`${owner}:${accountId}`);},
    heartbeat(owner,order){active(owner,order).until=now()+15000;},
    capture(owner,order){return active(owner,order).generation;},
    async check(owner,order,snapshot,ask,payout,ledger,generation){
      const m=await model(),state=active(owner,order,generation);
      if(key(m)!==key(order))throw Error('Calibration contract mismatch');
      if(now()-snapshot.epoch*1000>5000)throw Error('Signal expired before buy');
      const previous=ledger.filter(o=>o.accountId===order.accountId&&o.mode==='auto'&&o.state==='settled').at(-1);
      if(previous&&snapshot.times.filter(t=>t*1000>previous.completedAt).length<state.cooldown)throw Error('Server tick cooldown is active.');
      if(ledger.some(o=>o!==order&&o.accountId===order.accountId&&o.mode==='auto'&&o.signalEpoch===snapshot.epoch&&o.state!=='rejected'))throw Error('This signal tick was already used.');
      return {...checkAutoEdge(m,snapshot.signal,ask,payout),signalEpoch:snapshot.epoch};
    }
  };
}
