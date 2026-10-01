import test from 'node:test';
import assert from 'node:assert/strict';
import {rankMarkets,MarketScanner} from '../public/rise-fall/scanner.js';
import {defaultDuration,availableContracts,supports} from '../public/rise-fall/contracts.js';
import {readFileSync} from 'node:fs';
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
test('available markets can be selected without an entry signal',()=>{const r=rankMarkets([row('A',20,false)],{},5,'t',1000)[0];assert.equal(r.available,true);assert.equal(r.eligible,false);});
test('live one-second volatility and Jump metadata supports Rise/Fall ticks; Boom/Crash do not',()=>{
 const audit=JSON.parse(readFileSync(new URL('../outputs/rise-fall-market-audit.json',import.meta.url),'utf8'));
 for(const symbol of ['1HZ100V','1HZ10V','JD10']){const row=audit.rows.find(r=>r.symbol===symbol),contracts=availableContracts({available:row.rawCallPut},symbol);for(const type of ['CALL','PUT'])assert.equal(supports(contracts,type,5,'t'),true);}
 for(const row of audit.rows.filter(r=>/^(Boom|Crash) /.test(r.name)))assert.equal(row.contracts.length,0);
});
test('time-only markets choose a supported duration instead of leaving invalid ticks',()=>{
 const contracts=['CALL','PUT'].flatMap(contract_type=>[{contract_type,min:{value:1,unit:'d'},max:{value:365,unit:'d'}},{contract_type,min:{value:15,unit:'m'},max:{value:1,unit:'h'}}]);assert.deepEqual(defaultDuration(contracts),{value:15,unit:'m'});
});
test('scanner preserves history/subscription between cycles and caches contract checks',async()=>{
 const calls=[],scanner=new MarketScanner({markets:[{symbol:'1HZ100V',name:'Volatility 100 (1s) Index'}],config:{},onUpdate:()=>scanner.token++,WebSocketClass:class{}});
 scanner.request=async q=>{calls.push(q);if(q.contracts_for)return {contracts_for:{available:[{contract_type:'CALL',barriers:0,min_contract_duration:'1t',max_contract_duration:'10t'}]}};if(q.ticks_history)return {history:{prices:[100,101],times:[1000,1001]}};return {};};
 await scanner.cycle(scanner.token);const engine=scanner.rows.get('1HZ100V').engine;engine.add({symbol:'1HZ100V',epoch:1002,quote:102});await scanner.cycle(scanner.token);
 assert.equal(scanner.rows.get('1HZ100V').engine,engine);assert.equal(engine.history.length,3);assert.equal(calls.filter(q=>q.contracts_for).length,1);assert.equal(calls.filter(q=>q.ticks_history).length,1);assert.equal(calls.filter(q=>q.ticks).length,1);
});
