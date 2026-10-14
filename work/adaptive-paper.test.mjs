import test from 'node:test';import assert from 'node:assert/strict';
import {scoreAdaptiveEvidence,AdaptivePaperSession} from '../public/adaptive-decision.js';
import {analyzeBalance} from '../public/balance-engine.js';import {evaluateBrain} from '../public/decision-brain.js';
const evidence={scale_metric:.045,pressure_score:.5,edge_proximity:.03,historical_support:.8};
test('provided example caps 112 raw score to 100; no probability claim',()=>{const r=scoreAdaptiveEvidence(evidence);assert.equal(r.rawScore,112);assert.equal(r.score,100);assert.equal(r.action,'TAKE');});
test('corrected edge multiplier preserves previously approved candidate',()=>{const e={scale_metric:.09,pressure_score:.75,edge_proximity:.023,historical_support:.1};assert.equal(scoreAdaptiveEvidence(e).action,'TAKE');assert.equal(scoreAdaptiveEvidence(e,{rejections:16}).action,'TAKE');});
test('missing evidence fails closed and volatility multiplier is bounded',()=>{assert.equal(scoreAdaptiveEvidence({}).action,'WAIT');assert.equal(scoreAdaptiveEvidence(evidence,{volatility:100}).volatilityScale,3);});
test('paper counter counts observations not renders and resets on approval',()=>{let take=false;const session=new AdaptivePaperSession((s,m,o)=>({selected:take?{}:null,evaluations:[{enabled:true,valid:true}],rejections:o.rejections}));const state=i=>({market:'R_10',sequence:i,id:String(i),ticks:Array(50)});for(let i=1;i<=16;i++){session.evaluateState(state(i));session.evaluateState(state(i));}assert.equal(session.evaluateState(state(17)).rejections,16);take=true;session.evaluateState(state(18));assert.equal(session.evaluateState(state(19)).rejections,0);});
test('paper scoring preserves canonical candidate and eligibility; default stays legacy',()=>{const s=analyzeBalance('R_10',Array.from({length:200},(_,i)=>({digit:i%10,epoch:1000+i,price:100+i/100}))),before=JSON.stringify(s);const legacy=evaluateBrain(s);const mask={'OVER:1':false,'OVER:2':false,'UNDER:8':false,'UNDER:7':false};assert.equal(evaluateBrain(s,mask,{profile:'adaptive-paper'}).selected,null);assert.deepEqual(evaluateBrain(s),legacy);assert.equal(JSON.stringify(s),before);});

test('zero edge distance and zero historical support stay zero',()=>{const r=scoreAdaptiveEvidence({...evidence,edge_proximity:0,historical_support:0});assert.equal(r.penalties.edge,25);assert.equal(r.supportBonus,0);});
test('bonus starts after 15 and effective multiplier is reported',()=>{assert.equal(scoreAdaptiveEvidence(evidence,{rejections:15}).relaxationBonus,0);const r=scoreAdaptiveEvidence(evidence,{rejections:16,volatility:1});assert.equal(r.relaxationBonus,10);assert.equal(r.effectiveMultiplier,3.75);});

test('relaxation never lowers score across evidence and volatility grid',()=>{
 for(const scale_metric of [0,.049,.051,.06,.09,.2])for(const pressure_score of [0,.65,.75,1])for(const edge_proximity of [0,.015,.016,.019,.02,.023,.1,1])for(const historical_support of [0,.1,.5,1])for(const volatility of [0,.02,.04,.1]){
 const e={scale_metric,pressure_score,edge_proximity,historical_support},before=scoreAdaptiveEvidence(e,{volatility,rejections:15}),after=scoreAdaptiveEvidence(e,{volatility,rejections:16});
 assert.ok(after.score>=before.score);assert.equal(before.edgeBuffer,.02);assert.equal(after.edgeBuffer,.016);if(before.approved)assert.equal(after.approved,true);
 }
});
