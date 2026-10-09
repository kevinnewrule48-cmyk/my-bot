import {readFileSync,writeFileSync} from 'node:fs';
import {analyzeBalance} from '../public/balance-engine.js';
import {analyzeBalance as strict} from './fixtures/strict-balance-v1.js';
const files=process.argv.slice(2);
if(!files.length)files.push('work/fixtures/balance-public-digits.json');
const output={warning:'Hypothetical next-tick outcomes, not broker trades or profitability. No payout, latency or slippage model. Both policies skip the settlement tick before considering another entry. These previously inspected recordings are not fresh unseen validation.',datasets:[]};
for(const file of files){const {markets,source}=JSON.parse(readFileSync(file,'utf8')),summary={source,policies:{}};
 for(const [policy,analyze] of [['strict',strict],['edge-entry',analyzeBalance]]){
  const total={entries:0,wins:0,losses:0,maxConsecutiveLosses:0,markets:{}};
  for(const [market,ticks] of Object.entries(markets)){
   const stats={entries:0,wins:0,losses:0,maxConsecutiveLosses:0};let streak=0;
   for(let i=1;i<ticks.length-1;i++){
    const s=analyze(market,ticks.slice(Math.max(0,i-199),i+1)),c=s.selected;if(!c)continue;
    const won=c.direction==='OVER'?ticks[i+1].digit>c.barrier:ticks[i+1].digit<c.barrier;
    stats.entries++;stats[won?'wins':'losses']++;streak=won?0:streak+1;stats.maxConsecutiveLosses=Math.max(stats.maxConsecutiveLosses,streak);i++;
   }
   total.markets[market]=stats;for(const k of ['entries','wins','losses'])total[k]+=stats[k];total.maxConsecutiveLosses=Math.max(total.maxConsecutiveLosses,stats.maxConsecutiveLosses);
  }
  summary.policies[policy]=total;
 }
 output.datasets.push(summary);
}
writeFileSync('../../outputs/edge-entry-replay.json',JSON.stringify(output,null,2));
console.log(JSON.stringify(output,null,2));
