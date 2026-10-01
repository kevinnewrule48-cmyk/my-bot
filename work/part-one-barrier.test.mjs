import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DigitBarrierEngine,barrierCandidates,extractLastDigit,conditionGate,selectCandidate,proposalRequest,validateProposal} from '../public/digit-barrier-engine.js';
const history=ds=>ds.map(digit=>({digit}));
const good=history(Array.from({length:200},(_,i)=>[3,5,7,8,9][i%5]));
test('Zone requires only own losing digits <=8%, never opposite endpoints >=10%',()=>{
 for(const side of ['OVER','UNDER']){
  const ds=[...Array(16).fill(0),...Array(16).fill(1),...Array(168).fill(4)].map(d=>side==='OVER'?d:9-d);
  const c=new DigitBarrierEngine().analyze(history(ds),{sequence:0}).candidates[side==='OVER'?0:1];
  assert.equal(c.zone,true);assert.equal(c.ready,false); // Other gates still apply.
  const legacy=new DigitBarrierEngine({requireOppositeZone:true}).analyze(history(ds),{sequence:0});assert.equal(legacy.candidates[side==='OVER'?0:1].zone,false);
  ds[40]=side==='OVER'?0:9;assert.equal(new DigitBarrierEngine().analyze(history(ds),{sequence:0}).candidates[side==='OVER'?0:1].zone,false);
 }
});
test('OVER 1 and UNDER 8 exact inclusive loss boundaries',()=>{
 const [o,u]=barrierCandidates(history([0,1,2,3,4,5,6,7,8,9]));
 assert.deepEqual(o.winningDigits,[2,3,4,5,6,7,8,9]);assert.deepEqual(u.winningDigits,[0,1,2,3,4,5,6,7]);assert.equal(o.observed,.8);assert.equal(u.observed,.8);
 assert.equal(barrierCandidates(history([0,1]))[0].winningCount,0);assert.equal(barrierCandidates(history([8,9]))[1].winningCount,0);
});
test('verified precision preserves trailing zero and rejects unknown precision',()=>{
 assert.deepEqual(extractLastDigit(123.4,2),{quote:'123.40',digit:0});assert.equal(extractLastDigit('123.49',2).digit,9);
 for(const x of [null,'',NaN])assert.throws(()=>extractLastDigit(x,2));assert.throws(()=>extractLastDigit(123.4,undefined));
});
test('candidate generation remains independent including central-digit overlap',()=>{
 const [o,u]=barrierCandidates(history([2,3,4,5,6,7]));assert.equal(o.observed,1);assert.equal(u.observed,1);assert.throws(()=>barrierCandidates(history([10])));
});
test('all metrics, gates and selected sides mirror under digit 9-d',()=>{
 const a=new DigitBarrierEngine(),b=new DigitBarrierEngine();
 for(let i=0;i<5;i++){
 const x=a.analyze(good,{sequence:i}),y=b.analyze(good.map(t=>({digit:9-t.digit})),{sequence:i});
 for(let j=0;j<2;j++)for(const key of ['score','confidence','momentum','zone','stability','persistence','quality','ready'])assert.equal(x.candidates[j][key],y.candidates[1-j][key]);
 assert.equal(x.selected?.type==='OVER',y.selected?.type==='UNDER');
 }
});
test('persistence advances on unique ticks only, resets on failure and market change',()=>{
 const e=new DigitBarrierEngine({persistence:2});e.analyze(good,{sequence:1});let a=e.analyze(good,{sequence:2});assert.equal(a.candidates[0].persistence,1);
 assert.equal(e.analyze(good,{sequence:2}),a);a=e.analyze(good,{sequence:3});assert.equal(a.selected.type,'OVER');
 assert.equal(e.analyze([],{sequence:4}).candidates[0].persistence,0);assert.equal(e.analyze(good,{sequence:5,context:'other'}).selected,null);
});
test('100 percent gate cannot pass empty or failed checks; tie selects nothing',()=>{
 assert.equal(conditionGate([]),false);assert.equal(conditionGate([{pass:true},{pass:false}]),false);assert.equal(conditionGate([{pass:true}]),true);
 assert.equal(selectCandidate([{ready:true,score:80,observed:.9},{ready:true,score:80,observed:.9}]),null);
 assert.equal(selectCandidate([{ready:false,score:99},{ready:true,score:65,type:'UNDER'}]).type,'UNDER');
});
test('proposal construction and validation preserve both contracts and reject overspend',()=>{
 for(const [type,barrier] of [['OVER','1'],['UNDER','8']]){const p=proposalRequest({type,symbol:'R_100',stake:1});assert.equal(p.contract_type,'DIGIT'+type);assert.equal(p.barrier,barrier);assert.equal(p.duration,1);}
 assert.throws(()=>proposalRequest({type:'UNKNOWN',symbol:'R_100',stake:1}));assert.throws(()=>validateProposal({id:'a',ask_price:2,payout:3},1));
 assert.deepEqual(validateProposal({id:'a',ask_price:1,payout:1.1},1),{buy:'a',price:1});
});
