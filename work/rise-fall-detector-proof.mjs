import {writeFileSync} from 'node:fs';
import {RiseFallEngine} from '../public/rise-fall/engine.js';
import {directionState,chopBreakdown} from '../public/rise-fall/diagnostics.js';
const results=[];
for(const direction of ['UP','DOWN','CHOPPY']){
 const engine=new RiseFallEngine('R_100').enableTrace(),states=[],samples=[];let firstReady=null;
 for(let i=0;i<650;i++){
  const quote=direction==='CHOPPY'||i<300?1000+i%2:1000+(direction==='UP'?1:-1)*(i-300)*.2;
  const epoch=1800000000+i*2;engine.add({epoch,quote});const a=engine.snapshot(epoch*1000),state=directionState(a);
  if(states.at(-1)?.state!==state)states.push({tick:i+1,state,chop:a.chop});
  if(a.winner&&!firstReady)firstReady={tick:i+1,side:a.winner.name,checks:a.winner.checks,confidence:a.winner.confidence,chop:a.chop};
  if(i%50===49||i===649)samples.push({tick:i+1,state,marketState:a.marketState,up:a.windows[50].up,down:a.windows[50].down,chop:a.chop,strength:a.trendStrength,efficiency:a.efficiency,persistence:a.persistence,inputs:chopBreakdown(a)});
 }
 results.push({direction,firstReady,states,samples});
}
writeFileSync('outputs/rise-fall-detector-proof.json',JSON.stringify({execution:'DISABLED',thresholdsChanged:false,results},null,2));console.log(JSON.stringify(results.map(r=>({direction:r.direction,firstReady:r.firstReady,states:r.states,last:r.samples.at(-1)})),null,2));
