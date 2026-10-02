import {readFile,writeFile,readdir} from 'node:fs/promises';
import {presetConfig} from '../public/rise-fall/presets.js';
import {replay,replaySnapshots} from '../public/rise-fall/replay.js';
import {supports} from '../public/rise-fall/contracts.js';
import {fingerprint} from '../rise-fall-service.mjs';
const profiles=[{name:'original-chop-off',config:presetConfig('original',false)},{name:'demo-exploration',config:presetConfig('exploration',true)},{name:'demo-exploration-chop-off',config:presetConfig('exploration',false)}];
const report=JSON.parse(await readFile('outputs/rise-fall-replay-report.json','utf8'));
const names=new Set(profiles.map(p=>p.name));report.profiles=report.profiles.filter(p=>!names.has(p.name));report.results=report.results.filter(r=>!names.has(r.profile));
const outcomes=[];
for(const file of (await readdir('outputs/rise-fall')).filter(x=>/^[A-Za-z0-9_]+\.json$/.test(x))){
 const r=JSON.parse(await readFile('outputs/rise-fall/'+file,'utf8'));if(!r.ticks?.length||!r.contracts?.length||!report.symbols.includes(r.symbol))continue;if(r.source!=='Deriv public ticks_history')throw Error('Expected public recording');
 const split=Math.floor(r.ticks.length*.6);
 for(const profile of profiles){const snapshots=replaySnapshots(r,profile.config);for(const [duration,unit]of [[1,'t'],[5,'t'],[10,'t'],[15,'s'],[1,'m'],[5,'m'],[15,'m']]){
  if(!['CALL','PUT'].every(t=>supports(r.contracts,t,duration,unit)))continue;const seconds=duration*({s:1,m:60}[unit]??0);if(seconds&&r.ticks.at(-1).epoch-r.ticks[split].epoch<seconds*2)continue;
  for(const partition of ['training','validation']){const recording=partition==='training'?{...r,ticks:r.ticks.slice(0,split)}:r;const result=replay(recording,{config:profile.config,duration,unit,snapshots,offset:partition==='validation'?split:0});const row={...result,records:undefined,profile:profile.name,partition};report.results.push(row);if(partition==='validation'&&duration===5&&unit==='t')outcomes.push(row);}
 }}console.log('Replayed',r.symbol);
}
report.profiles.push(...profiles);report.configFingerprints=report.profiles.map(p=>fingerprint(p.config));report.generatedAt=new Date().toISOString();report.profileExtension='Fixed demo exploration thresholds: pressure/momentum 55, confidence 60, strength/efficiency 20, persistence 60. Chop on/off independently replayed. Existing risk controls unchanged; no optimization or profit claim.';
await writeFile('outputs/rise-fall-replay-report.json',JSON.stringify(report,null,2));await writeFile('outputs/rise-fall-preset-audit.json',JSON.stringify({generatedAt:report.generatedAt,profiles,outcomes,limitations:report.limitations},null,2));console.log('Completed',outcomes.length,'held-out 5-tick runs');
