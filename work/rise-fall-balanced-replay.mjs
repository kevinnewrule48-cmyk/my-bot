import {readFileSync,writeFileSync,readdirSync,mkdirSync} from 'node:fs';
import {RiseFallEngine} from '../public/rise-fall/engine.js';
import {presetConfig} from '../public/rise-fall/presets.js';
import {replay} from '../public/rise-fall/replay.js';
import {supports} from '../public/rise-fall/contracts.js';
import {fingerprint} from '../rise-fall-service.mjs';
const out=process.env.RF_BALANCED_OUTPUT??'../../outputs/balanced';mkdirSync(out,{recursive:true});
const evidence=JSON.parse(readFileSync('outputs/rise-fall-replay-report.json','utf8'));
const profiles=['original','exploration','balanced'].map(name=>({name,config:presetConfig(name)}));
const summary=[],table=[],rejections={};let heldOutTicks=0;
for(const file of readdirSync('outputs/rise-fall').filter(f=>/^(R_|1HZ|JD|stpRNG).*\.json$/.test(f))){
 const r=JSON.parse(readFileSync('outputs/rise-fall/'+file,'utf8'));if(r.source!=='Deriv public ticks_history')throw Error('Not recorded public data');
 const split=Math.floor(r.ticks.length*.6);heldOutTicks+=r.ticks.length-split;
 for(const profile of profiles){const e=new RiseFallEngine(r.symbol,profile.config);
  const snapshots=r.ticks.map((t,i)=>{e.add(t);const a=e.snapshot(t.epoch*1000);if(i>=split)for(const side of a.candidates){for(const reason of side.blocked){const key=profile.name+':'+side.name+':'+reason;rejections[key]=(rejections[key]??0)+1;}}
   return {signalId:a.signalId,winner:a.winner?{type:a.winner.type,confidence:a.winner.confidence}:null,marketState:a.marketState,candidates:a.candidates.map(s=>({type:s.type,metrics:s.balanced?.metrics??{pressure:a.windows[a.config.micro][s.sign===1?'up':'down'],momentum:s.momentum,velocity:a.velocity*s.sign,acceleration:a.acceleration*s.sign,persistence:s.persistence,chop:a.chop,efficiency:a.efficiency,score:s.confidence},blocked:s.blocked}))};});
  for(const [duration,unit] of [[1,'t'],[5,'t'],[10,'t'],[15,'s'],[1,'m'],[5,'m'],[15,'m']]){
   if(!['CALL','PUT'].every(t=>supports(r.contracts,t,duration,unit)))continue;
   for(const partition of ['training','validation']){const recording=partition==='training'?{...r,ticks:r.ticks.slice(0,split)}:r;
    const result=replay(recording,{config:profile.config,duration,unit,snapshots,offset:partition==='validation'?split:0});
    summary.push({...result,records:undefined,profile:profile.name,partition});
    if(duration===5&&unit==='t')for(const trade of result.records){const entry=snapshots[trade.entryIndex].candidates.find(s=>s.type===trade.type),settlement=snapshots[trade.exitIndex].candidates.find(s=>s.type===trade.type);table.push({profile:profile.name,partition,...trade,entryMetrics:entry?.metrics,settlementMetrics:settlement?.metrics,entryDeteriorated:!!entry?.blocked.length,entryRejectionReasons:entry?.blocked,settlementResult:trade.win?'hypothetical WIN':'hypothetical LOSS'});}
   }
  }
  if(profile.name==='balanced')writeFileSync(out+'/'+r.symbol+'-candidates.json',JSON.stringify(snapshots.map((s,i)=>({epoch:r.ticks[i].epoch,quote:r.ticks[i].quote,candidates:s.candidates}))));
 }console.log('Compared',r.symbol);
}
writeFileSync(out+'/comparison.json',JSON.stringify({method:'Fixed v1, chronological 60/40 split, no threshold search. Replay one-tick entry latency; not broker settlement or payout evidence. Existing data has been used previously, so validation is held-out within this run, not genuinely unseen prospective data.',heldOutTicks,profiles,summary,table,rejections},null,2));
// Keep candidate evidence separate until review. No production authorization file is changed here.
writeFileSync(out+'/replay-evidence.json',JSON.stringify({...evidence,generatedAt:new Date().toISOString(),profiles:[...evidence.profiles.filter(p=>p.name!=='balanced'),profiles[2]],results:[...evidence.results.filter(p=>p.profile!=='balanced'),...summary.filter(p=>p.profile==='balanced')],configFingerprints:[...evidence.configFingerprints,fingerprint(profiles[2].config)]}));
