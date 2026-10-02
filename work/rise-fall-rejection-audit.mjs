import {readFileSync,writeFileSync} from 'node:fs';
import {RiseFallEngine} from '../public/rise-fall/engine.js';
const results=[];
for(const symbol of ['R_100','R_10','R_25']){
 const recording=JSON.parse(readFileSync(`outputs/rise-fall/${symbol}.json`,'utf8')),engine=new RiseFallEngine(symbol),sides={};
 for(const tick of recording.ticks){if(!engine.add(tick))continue;const a=engine.snapshot(tick.epoch*1000);for(const candidate of a.candidates){const r=sides[candidate.name]??={evaluations:0,ready:0,maxPassing:0,rejected:{},ranges:{}};r.evaluations++;r.ready+=candidate.ready?1:0;r.maxPassing=Math.max(r.maxPassing,Object.values(candidate.checks).filter(Boolean).length);for(const key of candidate.blocked)r.rejected[key]=(r.rejected[key]??0)+1;for(const [key,value]of Object.entries({pressure:a.windows[a.config.short][candidate.sign===1?'up':'down'],strength:a.trendStrength,persistence:candidate.persistence,chop:a.chop,confidence:candidate.confidence,efficiency:a.efficiency})){const range=r.ranges[key]??={min:Infinity,max:-Infinity};range.min=Math.min(range.min,value);range.max=Math.max(range.max,value);}}}
 for(const row of Object.values(sides))row.rejectionPercent=Object.fromEntries(Object.entries(row.rejected).map(([k,v])=>[k,Math.round(10000*v/row.evaluations)/100]));
 results.push({symbol,capturedAt:recording.capturedAt,firstEpoch:recording.ticks[0].epoch,lastEpoch:recording.ticks.at(-1).epoch,ticks:recording.ticks.length,sides});console.log(symbol,JSON.stringify(sides));
}
writeFileSync('outputs/rise-fall-rejection-audit.json',JSON.stringify({generatedAt:new Date().toISOString(),scope:'Previously recorded public histories, not the user three-hour session. Baseline unchanged.',results},null,2));
