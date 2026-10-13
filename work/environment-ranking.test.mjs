import test from 'node:test';
import assert from 'node:assert/strict';
import {environmentEvidence} from '../public/environment-ranking.js';
import {BalanceBook} from '../public/balance-engine.js';
const state=(digits)=>({ticks:digits.map(digit=>({digit})),selected:{direction:'OVER',barrier:1}});
test('persistent edge avoidance outranks an isolated favorable ending',()=>{
 const sustained=state(Array(200).fill(5));
 const brief=state([...Array(198).fill(0),5,5]);
 assert.ok(environmentEvidence(sustained).advantage>environmentEvidence(brief).advantage);
 assert.ok(environmentEvidence(state([5,5])).advantage<environmentEvidence(sustained).advantage);
});
test('mirrored barriers have equal evidence and missing candidates have none',()=>{
 const a=state(Array.from({length:200},(_,i)=>i%10));
 const b={ticks:a.ticks.map(t=>({digit:9-t.digit})),selected:{direction:'UNDER',barrier:8}};
 assert.equal(environmentEvidence(a).advantage,environmentEvidence(b).advantage);
 assert.equal(environmentEvidence({ticks:[]}),null);
});
test('actual book selects sustained evidence and excludes stale or consumed setups',()=>{
 let now=200000;const b=new BalanceBook({now:()=>now});
 for(let i=1;i<=200;i++){
 b.push('R_10',{epoch:i,digit:5});
 b.push('R_100',{epoch:i,digit:i>198?5:(i%2?0:9)});
 }
 assert.equal(b.best(),null);for(let i=201;i<=203;i++){now=i*1000;b.push('R_10',{epoch:i,digit:5});b.push('R_100',{epoch:i,digit:i%2?0:9});b.best();}
 assert.equal(b.best().market,'R_10');
 b.consume(b.best());assert.notEqual(b.best()?.market,'R_10');
 assert.equal(b.best(206000),null);
});

