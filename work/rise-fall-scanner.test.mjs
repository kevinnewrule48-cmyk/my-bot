import test from 'node:test';
import assert from 'node:assert/strict';
import {rankMarkets} from '../public/rise-fall/scanner.js';
const contracts=[{contract_type:'CALL',min:{value:1,unit:'t'},max:{value:10,unit:'t'}}];
const row=(symbol,confidence,ready=true)=>({symbol,name:symbol,contracts,engine:{snapshot:now=>({candidates:[{name:'RISE',type:'CALL',confidence,ready:ready&&now<10000}],reason:'Blocked'})}});
test('recommendation ranks qualifying candidates without selecting a market',()=>{
 const input=[row('A',85),row('B',95),row('C',99,false)];const result=rankMarkets(input,{},5,'t',1000);
 assert.equal(result[0].symbol,'B');assert.equal(input[0].symbol,'A');assert.equal(result[2].eligible,false);
});
test('unsupported contracts and durations cannot be recommended',()=>{
 assert.equal(rankMarkets([row('A',90)],{},15,'t',1000)[0].eligible,false);
 const r=row('A',90);r.contracts=[];assert.equal(rankMarkets([r],{},5,'t',1000)[0].eligible,false);
});
test('stale analysis expires and incomplete or failed scans are not recommendations',()=>{
 assert.equal(rankMarkets([row('A',90)],{},5,'t',11000)[0].eligible,false);
 assert.equal(rankMarkets([{symbol:'X',name:'X',contracts:[],error:'Unavailable'}],{},5,'t',1000)[0].eligible,false);
});
