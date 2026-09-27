// Presentation-only calculations; no orders, prediction, or candidate selection.
export function dashboardStatus(s) {
  if(s.executionTransportError)return 'STATUS UNAVAILABLE';
  if(s.execution?.blocking)return s.execution.state.replaceAll('_',' ');
  if(s.active)return 'TRADE ACTIVE';
  if(s.cooldown>0)return 'COOLDOWN';
  if(!s.feedLive)return 'STOPPED';
  if(s.awaitingReset)return 'ANALYZING';
  if(s.analysis?.selected)return 'READY';
  return s.analysis?.candidates.some(c=>c.persistence>0)?'QUALIFYING':'ANALYZING';
}
export function heatMap(ticks) {
  const counts=Array(10).fill(0);ticks.forEach(t=>counts[t.digit]++);
  return counts.map((count,digit)=>({digit,count,percent:ticks.length?count/ticks.length*100:0,
    label:!ticks.length?'NO DATA':count/ticks.length>.12?'HOT':count/ticks.length<.08?'COLD':'NEUTRAL'}));
}
export function summarizeOrders(orders) {
  const completed=orders.filter(o=>o.state==='settled'||o.exitTick!=null);
  let net=0,peak=0,drawdown=0,wins=0,losses=0,winStreak=0,lossStreak=0;
  for(const o of completed){const p=Number(o.profit);if(!Number.isFinite(p))continue;
    net+=p;peak=Math.max(peak,net);drawdown=Math.max(drawdown,peak-net);
    if(p>0){wins++;winStreak++;lossStreak=0;}else if(p<0){losses++;lossStreak++;winStreak=0;}else{winStreak=lossStreak=0;}}
  return {total:completed.length,wins,losses,net,drawdown,winStreak,lossStreak,rate:completed.length?wins/completed.length*100:null};
}
export function barrierView(direction,barrier){
  const digits=Array.from({length:10},(_,i)=>i);
  return {winning:digits.filter(d=>direction==='OVER'?d>barrier:d<barrier),losing:digits.filter(d=>direction==='OVER'?d<=barrier:d>=barrier)};
}
