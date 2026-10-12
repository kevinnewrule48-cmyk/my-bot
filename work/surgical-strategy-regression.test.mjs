import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {analyzeBalance} from '../public/balance-engine.js';
import {evaluateBrain,BARRIER_KEYS} from '../public/decision-brain.js';
import {createTradeDecision} from '../public/trade-decision.js';
test('336 baseline replays preserve candidate, barrier, qualification, Brain and authoritative trade decisions',()=>{
 const baseline=JSON.parse(readFileSync(new URL('./fixtures/surgical-strategy-baseline.json',import.meta.url),'utf8'));
 for(const {pattern:p,n,mask,sha256} of baseline.cases){
 const ticks=Array.from({length:n},(_,i)=>({digit:p[i%p.length],epoch:1001-n+i,price:100+p[i%p.length]/100}));
 const state=analyzeBalance('R_100',ticks),eligibility=Object.fromEntries(BARRIER_KEYS.map((k,i)=>[k,!!(mask&(1<<i))])),brain=evaluateBrain(state,eligibility),decision=brain.selected?createTradeDecision(brain.selected,state,{now:1000000,autoEligibility:eligibility}):null;
 assert.equal(createHash('sha256').update(JSON.stringify({state,brain,decision})).digest('hex'),sha256,JSON.stringify({p,n,mask}));
 }
});
