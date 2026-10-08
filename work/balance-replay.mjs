import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {analyzeBalance,BalanceBook} from '../public/balance-engine.js';
import {extractLastDigit} from '../public/digit-barrier-engine.js';
import {scaleRegion} from '../public/balance-scale.js';
const labels=['OVER 1','OVER 2','UNDER 8','UNDER 7'];
function replay(rows,market='R_100'){
 const book=new BalanceBook(),qualified=Object.fromEntries(labels.map(k=>[k,0])),selected={...qualified},hypothetical=Object.fromEntries(labels.map(k=>[k,{entries:0,wins:0,losses:0}])),regions={};let noTrade=0,pending=null;
 for(const tick of rows){const s=book.push(market,tick);if(!s)continue;
  if(pending){const c=pending,won=c.direction==='OVER'?tick.digit>c.barrier:tick.digit<c.barrier,r=hypothetical[c.label];r.entries++;r[won?'wins':'losses']++;const g=regions[scaleRegion(c)]??={entries:0,wins:0,losses:0};g.entries++;g[won?'wins':'losses']++;book.settled(market,tick.epoch*1000);pending=null;}
  for(const c of s.candidates)if(c.ready)qualified[c.label]++;
  if(!s.selected)noTrade++;else selected[s.selected.label]++;
  if(s.selected&&book.available(s.selected,tick.epoch*1000)){pending=s.selected;book.consume(pending,tick.epoch*1000);}
 }
 return {ticks:rows.length,qualified,selected,noTrade,hypotheticalOneTickEntries:hypothetical,regions,note:'Replay digit outcomes only. No proposal, purchase, broker settlement or payout modeled; NOT executed trades.'};
}
const recorded=JSON.parse(readFileSync(new URL('./fixtures/balance-public-digits.json',import.meta.url),'utf8')).markets;
function seeded(seed){let x=seed>>>0;const rand=()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)/4294967296;};const patterns=[[0,1,2,3,4,5,6,7,8,9],[2,3,7,8,9],[3,5,7,8,9],[0,1,2,3,4,5,6,7,8,9],[7,6,2,1,0],[6,4,2,1,0],[0,9,1,8],[0,1,2,3,4,5,6,7,8,9]];return patterns.flatMap((p,segment)=>Array.from({length:600},(_,i)=>({digit:p[Math.floor(rand()*p.length)],epoch:segment*600+i+1})));}
const result={version:'part-one-balance-v1',rulesFrozenBeforeReplay:true,training:false,tuning:false,recorded:Object.fromEntries(Object.entries(recorded).map(([m,r])=>[m,replay(r,m)])),synthetic:{architectureStress:replay(seeded(12345)),unseenSeed:replay(seeded(987654321))},mockBrokerLifecycleTests:Object.fromEntries(labels.map(k=>[k,{executions:4,wins:2,losses:2,note:'Injected deterministic mock broker results; plumbing validation only'}])),authenticatedBrokerTrades:0};
writeFileSync('../../outputs/part-one-balance-replay.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
