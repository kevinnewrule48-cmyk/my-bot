import {TickEngine,wins} from './engine.js';
import {SignalEngine} from './strategy.js';
import {holdoutReport} from './validation.js';
export function validateRecording(recording) {
  if(recording?.schema!=='consent-atm-part-two-ticks-v1'||!Array.isArray(recording.ticks)||recording.ticks.length>10000||recording.ticks.length<2||typeof recording.symbol!=='string')throw Error('Use a Part Two tick export containing 2–10,000 ticks.');
  let previous=-Infinity,previousSequence=null;
  for(const tick of recording.ticks) {
    if(tick.symbol!==recording.symbol||!Number.isFinite(tick.timestamp)||tick.timestamp<=previous)throw Error('Recording must contain one market and strictly increasing timestamps.');
    if(previous!==-Infinity&&tick.timestamp-previous>(recording.symbol.startsWith('1HZ')?3:6))throw Error('Recording contains a tick gap. Validate uninterrupted sessions separately.');
    if(tick.sequence!==undefined&&(!Number.isInteger(tick.sequence)||(previousSequence!==null&&tick.sequence!==previousSequence+1)))throw Error('Recording contains a sequence gap.');
    previousSequence=tick.sequence??null;
    previous=tick.timestamp;
  }
  return recording;
}
function interval(wins,n) {
  if(!n)return null;const p=wins/n,z=1.96,den=1+z*z/n,center=(p+z*z/(2*n))/den,half=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/den;
  return [Math.max(0,center-half),Math.min(1,center+half)];
}
export function replay(recording,type,barrier,config={}) {
  validateRecording(recording);
  const engine=new TickEngine(recording.symbol,recording.precision),signals=new SignalEngine(config),forecasts=[];
  let pending=null;
  for(const tick of recording.ticks) {
    // Score the old forecast only after its next tick arrives; never put that tick into its input.
    const next=engine.add({symbol:tick.symbol,epoch:tick.timestamp,quote:tick.quote});
    if(tick.digit!==next.digit)throw Error('Recorded digit does not match its quote and precision.');
    if(pending)forecasts.push({...pending,won:wins(type,barrier,next.digit),settlementSequence:next.sequence});
    const result=signals.update(engine,type,barrier);
    pending=engine.history.length>=50?{sequence:next.sequence,probability:result.modelProbability,score:result.score,decision:result.decision}:null;
  }
  const buckets=new Map();
  for(const f of forecasts) {
    const bucket=Math.round(f.probability*20)*5;
    const b=buckets.get(bucket)??{predictionBucket:bucket,count:0,wins:0,predictionSum:0};
    b.count++;b.wins+=Number(f.won);b.predictionSum+=f.probability;buckets.set(bucket,b);
  }
  const calibration=[...buckets.values()].sort((a,b)=>a.predictionBucket-b.predictionBucket).map(b=>({...b,meanPrediction:b.predictionSum/b.count,observed:b.wins/b.count,interval:interval(b.wins,b.count)}));
  const winsCount=forecasts.filter(f=>f.won).length;
  const baseline=type==='OVER'?(9-barrier)/10:barrier/10;
  return {symbol:recording.symbol,type,barrier,forecasts,calibration,validation:holdoutReport(forecasts,baseline),count:forecasts.length,wins:winsCount,losses:forecasts.length-winsCount,
    brier:forecasts.length?forecasts.reduce((s,f)=>s+(f.probability-Number(f.won))**2,0)/forecasts.length:null,
    trades:0,pnl:null,note:'Chronological shadow forecasts, not executed trades. Historical payouts are not used by this report: P/L and profitable edge cannot be determined. Diagnostic calibration is fitted only on the earlier segment and is never installed for live trading.'};
}
