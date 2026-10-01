import {RiseFallEngine} from './engine.js';
export function replaySnapshots(recording,config={}){const e=new RiseFallEngine(recording.symbol,config);return recording.ticks.map(t=>{if(!e.add(t))return null;const a=e.snapshot(Number(t.epoch??t.timestamp)*1000);return {signalId:a.signalId,winner:a.winner?{type:a.winner.type,confidence:a.winner.confidence}:null,marketState:a.marketState};});}
export function replay(recording,{config={},duration=5,unit='t',offset=0,entryDelayTicks=1,snapshots=null}={}){
 const e=new RiseFallEngine(recording.symbol,config),trades=[],used=new Set();let lockUntil=-1,signals=0;
 const ticks=recording.ticks,scale={s:1,m:60,h:3600,d:86400};
 for(let i=0;i<ticks.length;i++){
  const t=ticks[i];if(!snapshots&&!e.add(t))continue;const epoch=Number(t.epoch??t.timestamp),a=snapshots?snapshots[i]:e.snapshot(epoch*1000);if(!a)continue;
  if(i<offset||!a.winner||used.has(a.signalId))continue;used.add(a.signalId);signals++;if(i<=lockUntil)continue;
  const entryIndex=i+entryDelayTicks;if(entryIndex>=ticks.length)continue;const entry=ticks[entryIndex];let exitIndex;
  if(unit==='t')exitIndex=entryIndex+duration;else exitIndex=ticks.findIndex((t,k)=>k>entryIndex&&Number(t.epoch??t.timestamp)>=Number(entry.epoch??entry.timestamp)+duration*scale[unit]);
  if(exitIndex<0||exitIndex>=ticks.length)continue;const exit=ticks[exitIndex],delta=Number(exit.quote)-Number(entry.quote),win=a.winner.type==='CALL'?delta>0:delta<0;
  trades.push({symbol:recording.symbol,type:a.winner.type,duration,unit,marketState:a.marketState,confidence:a.winner.confidence,band:Math.floor(a.winner.confidence/10)*10,entryIndex,exitIndex,entry:Number(entry.quote),exit:Number(exit.quote),win,tie:delta===0});lockUntil=exitIndex;
 }
 let streak=0,maxConsecutiveLosses=0;for(const t of trades){streak=t.win?0:streak+1;maxConsecutiveLosses=Math.max(maxConsecutiveLosses,streak);}
 const group=key=>Object.fromEntries([...new Set(trades.map(key))].map(k=>{const ts=trades.filter(t=>key(t)===k);return [k,{trades:ts.length,wins:ts.filter(t=>t.win).length,losses:ts.filter(t=>!t.win).length,winRate:ts.length?ts.filter(t=>t.win).length/ts.length:null}];}));
 return {symbol:recording.symbol,duration,unit,signals,trades:trades.length,wins:trades.filter(t=>t.win).length,losses:trades.filter(t=>!t.win).length,winRate:trades.length?trades.filter(t=>t.win).length/trades.length:null,maxConsecutiveLosses,bySide:group(t=>t.type),byMarketState:group(t=>t.marketState),byConfidenceBand:group(t=>String(t.band)),entryDelayTicks,assumption:'Hypothetical replay, entry delayed one observed tick; equality counts as loss. Not Deriv settlements or profit. No historical payout data.',records:trades};
}
