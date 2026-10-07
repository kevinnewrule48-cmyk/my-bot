import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const EntryStabilityRecovery=vm.runInNewContext(source.slice(source.indexOf('const EntryStabilityRecovery'),source.indexOf('const tradabilityEvents'))+';EntryStabilityRecovery');
const ticks = digits => digits.map((digit, i) => ({digit,time:i}));

test('extreme bouncing enters UNSTABLE and remains blocked beyond five ticks',()=>{
 const e=new EntryStabilityRecovery();const a=e.observe(ticks([0,1,9,0,1,8,0,9]),8);assert.equal(a.state,'UNSTABLE');assert.equal(a.blocked,true);
 const b=e.observe(ticks([0,1,9,0,1,8,0,9,0,1,9,0]),12);assert.equal(b.state,'UNSTABLE');assert.equal(b.blocked,true);
});
test('middle-digit migration recovers with current rolling evidence',()=>{
 const e=new EntryStabilityRecovery();e.observe(ticks([0,1,9,0,1,8,0,9]),8);
 let a;for(let i=0;i<5;i++)a=e.observe(ticks([0,1,9,0,1,8,0,9,5,4,5,4,6,5,4].slice(0,9+i)),9+i);
 assert.ok(['RECOVERING','STABLE','EXCELLENT'].includes(a.state));assert.equal(a.blocked,['STABLE','EXCELLENT'].includes(a.state)?false:true);assert.ok(a.middleConcentration>=40);
});
test('temporary improvement does not release the instability veto',()=>{
 const e=new EntryStabilityRecovery();e.observe(ticks([0,1,9,0,1,8,0,9]),8);
 const a=e.observe(ticks([0,1,9,0,5,4,0,1,9]),9);assert.equal(a.blocked,true);assert.equal(a.state,'UNSTABLE');
});
test('recovery state never changes strategy gate or creates a trade',()=>{
 const e=new EntryStabilityRecovery();e.observe(ticks([0,1,9,0,1,8,0,9]),8);const a=e.observe(ticks([5,4,5,4,6,5,4,5,4,6,5,4]),12);assert.ok(['RECOVERING','STABLE','EXCELLENT'].includes(a.state));assert.equal(typeof a.blocked,'boolean');
});

test('sustained recovery clears veto and reaches EXCELLENT without an order',()=>{const e=new EntryStabilityRecovery();const h=ticks([0,9,0,9,0,9,0,9]);e.observe(h,8);let a;for(let i=0;i<25;i++){h.push({digit:4+i%3});a=e.observe(h,h.length);}assert.equal(a.blocked,false);assert.equal(a.state,'EXCELLENT');assert.equal(a.dangerousTransitions,0);});
