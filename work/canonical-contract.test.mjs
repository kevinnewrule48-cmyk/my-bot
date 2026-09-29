import {TradabilityEngine,tradabilityBlocks} from '../public/tradability-engine.js';
import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import crypto from 'node:crypto';import {readFileSync} from 'node:fs';
import {ContractLifecycleStore,reduceContract,contractDigit} from '../public/contract-lifecycle.js';
import {DigitWheelState,mountDigitWheel} from '../public/live-digit-wheel.js';
import {DigitBarrierEngine,extractLastDigit,proposalRequest} from '../public/digit-barrier-engine.js';
import {DifferEngine} from '../public/differ-engine.js';import {heatMap} from '../public/premium-model.js';import {diagnoseSnapshot} from '../public/part-one-diagnostics.js';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
class Node{constructor(){this.textContent='';this.nodes={};this.children=[];this.classList={toggle(){}};}querySelector(k){return this.nodes[k]??=new Node();}animate(){return {cancel(){}};}}
test('purchase on 7 shows ENTRY immediately; broker entry/exit 6 cannot move ENTRY to 6',()=>{
 for(const status of ['won','lost']){
  const wheel=new DigitWheelState();wheel.register('purchase-7');
  const receipt={contractId:77,attemptId:'purchase-7',precision:2,purchaseTick:{price:'100.07',digit:7,pipSize:2,epoch:1000}};
  const first=reduceContract(null,receipt);wheel.confirm({...receipt,lifecycle:first});
  assert.equal(wheel.entryDigit,7);assert.equal(wheel.resultDigit,null);
  wheel.setLive({price:'100.06',digit:6},[],'R_100');
  const result=reduceContract(first,{...receipt,entryTick:'100.06',exitTick:'100.06',status});
  wheel.settle({...receipt,status,lifecycle:result});
  assert.equal(wheel.entryDigit,7);assert.equal(wheel.resultDigit,6);assert.equal(result.brokerEntryDigit,6);
  assert.equal(wheel.contractStatus,status==='won'?'WON':'LOST');wheel.dispose();
 }
});
test('actual wheel, lower result panel and history agree: entry 8 → 3 WIN; entry 8 → 8 WIN',async()=>{
 for(const exit of [3,8]){
  const fields=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],{value:'0',checked:false,textContent:'',classList:{toggle(){},add(){},remove(){}},addEventListener(){},setAttribute(){},setCustomValidity(){},querySelector(){return null;},replaceChildren(){},append(){}}]));
  for(const [k,v] of Object.entries({symbol:'R_100',window:200,minimum:65,barrierPersistence:1,stake:1,maxStake:5000,autoCooldownTicks:5,accountSelector:'demo1',duration:1}))fields[k].value=String(v);
  const wheel=new DigitWheelState(),host=new Node(),cells=Array.from({length:10},()=>new Node());host.querySelectorAll=()=>cells;host.querySelector('.wheel-price').children=[new Node(),new Node()];globalThis.matchMedia=()=>({matches:true});const dispose=mountDigitWheel(host,wheel);
  const context=vm.createContext({TradabilityEngine,tradabilityBlocks,DifferEngine,crypto,liveDigitWheel:wheel,heatMap,DigitBarrierEngine,extractLastDigit,proposalRequest,diagnoseSnapshot,URLSearchParams,console,document:{getElementById:id=>fields[id]},localStorage:{getItem:()=>null,setItem(){}},setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},fetch:async()=>({ok:true,json:async()=>({connected:false,configured:false,accounts:[]})})});
  vm.runInContext(source.replace(/^import[^\n]*\n/gm,''),context);await new Promise(setImmediate);
  const base={attemptId:'a',contractId:123,strategy:'OVER_UNDER',symbol:'R_100',precision:2,entryTick:null,purchaseTick:{digit:8,price:'100.08',pipSize:2,epoch:1000}};
  let lifecycle=reduceContract(null,base);wheel.register('a');context.receipt={...base,lifecycle};
  vm.runInContext("showOrderEntry('DIGITOVER',receipt,'Manual bot')",context);assert.equal(wheel.entryDigit,8);assert.equal(Number(fields.actualEntryTick.textContent),8);
  lifecycle=reduceContract(lifecycle,{...base,entryTick:100.08});context.receipt={...base,lifecycle};
  vm.runInContext("showOrderEntry('DIGITOVER',receipt,'Manual bot')",context);
  assert.equal(wheel.entryDigit,8);assert.equal(Number(fields.actualEntryTick.textContent),8);
  for(const digit of [7,5,9,3]){wheel.setLive({price:`100.0${digit}`,digit},[],'R_100');assert.equal(wheel.entryDigit,8);assert.equal(Number(fields.actualEntryTick.textContent),8);}
  lifecycle=reduceContract(lifecycle,{...base,entryTick:100.07,exitTick:100+exit/100,status:'won'});
  context.receipt={...base,lifecycle,status:'won',exitTick:100+exit/100,profit:.1,buyPrice:1,payout:1.1};
  vm.runInContext("showContractResult('DIGITOVER',receipt,'Manual bot')",context);
  assert.equal(cells[8].querySelector('.wheel-entry').textContent,'ENTRY');assert.equal(cells[exit].querySelector('.wheel-result').textContent,'💰 WIN');
  assert.equal(cells.filter(n=>n.querySelector('.wheel-entry').textContent).length,1);
  assert.equal(Number(fields.actualEntryTick.textContent),8);assert.equal(Number(fields.actualExitTick.textContent),exit);assert.equal(fields.actualOrderOutcome.textContent,'WON');
  const history=vm.runInContext('accountOrderHistory[0]',context);assert.equal(history.entryDigit,8);assert.equal(history.settlementDigit,exit);assert.equal(history.result,'WON');
  assert.equal(history.lifecycle,wheel.contracts.contracts.get('123'));
  assert.match(fields.contractPayoutList.innerHTML,new RegExp(`Entry 8 → settlement ${exit}`));
  dispose();wheel.dispose();delete globalThis.matchMedia;
 }
});
test('contract/strategy routing, frozen snapshots, late events and genuine trailing zero',()=>{
 const store=new ContractLifecycleStore();const a=store.accept({contractId:1,attemptId:'a',strategy:'OVER_UNDER',entryTick:123.48,precision:2});
 store.accept({contractId:2,attemptId:'b',strategy:'DIFFER',entryTick:'123.45'});
 assert.equal(store.accept({contractId:1,attemptId:'b',strategy:'DIFFER',status:'won',exitTick:'1.9'}),null);
 const settled=store.accept({contractId:1,attemptId:'a',strategy:'OVER_UNDER',entryTick:'123.47',exitTick:123.4,status:'won'});
 assert.equal(settled.entryDigit,8);assert.equal(settled.settlementDigit,0);assert.equal(a.settlementDigit,null);assert.ok(Object.isFrozen(settled));
 store.accept({contractId:1,attemptId:'a',strategy:'OVER_UNDER',entryTick:'5.1',exitTick:'5.2',status:'lost'});
 assert.equal(store.contracts.get('1').settlementDigit,0);assert.equal(store.contracts.get('1').result,'WON');assert.equal(store.contracts.get('2').settlementDigit,null);
 assert.equal(contractDigit(123.4),null);assert.equal(contractDigit('123.40'),0);
});
test('result follows broker status, not profit or cursor; missing exit remains unknown',()=>{
 const r=reduceContract(null,{contractId:1,entryTick:'100.08',purchaseTick:{digit:7},status:'lost',profit:10});
 assert.equal(r.entryDigit,null);assert.equal(r.brokerEntryDigit,8);assert.equal(r.settlementDigit,null);assert.equal(r.result,'LOST');
});
