import test from 'node:test';
import assert from 'node:assert/strict';
import {selectedBalance} from '../public/rise-fall/balance.js';
import {brokerBalance} from '../public/rise-fall/balance.js';
import {RiseFallService} from '../rise-fall-service.mjs';
test('balance belongs to selected demo account, including zero',()=>{
 const accounts=[{accountId:'A',accountType:'demo',balance:0,currency:'USD'},{accountId:'B',accountType:'demo',balance:'5720.36',currency:'USD'},{accountId:'C',accountType:'real',balance:99}];
 assert.equal(selectedBalance(accounts,'A').amount,0);assert.equal(selectedBalance(accounts,'B').amount,5720.36);assert.equal(selectedBalance(accounts,'C'),null);assert.equal(selectedBalance(accounts,'missing'),null);
});
test('missing balances never display a made-up zero',()=>{for(const balance of [null,undefined,'','invalid'])assert.equal(selectedBalance([{accountId:'A',accountType:'demo',balance}],'A'),null);});
test('balance comes from broker response, not the account-list amount',()=>{
 const a={account_id:'demoA',account_type:'demo',currency:'USD',balance:999};
 assert.equal(brokerBalance({balance:{balance:'5720.36',currency:'USD'}},a).amount,5720.36);
 assert.equal(brokerBalance({balance:{balance:0}},a).amount,0);
 assert.throws(()=>brokerBalance({},a));
});
test('selected demo gets its own authenticated balance connection; no trade requests',async()=>{
 const calls=[],connections=[],session={accessToken:'test-only'};
 class Socket extends EventTarget{readyState=1;send(raw){const q=JSON.parse(raw);calls.push(q);queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({req_id:q.req_id,balance:{balance:42,currency:'USD',loginid:'VRTC_TEST'}})})));}close(){this.readyState=3;}}
 const service=new RiseFallService({accounts:async()=>[{account_id:'A',account_type:'demo',status:'active'},{account_id:'B',account_type:'demo',status:'active'},{account_id:'C',account_type:'real',status:'active'}],connect:async details=>{connections.push(details);return new Socket();}});
 const r=await service.balance('owner',session,'B');assert.equal(r.accountId,'B');assert.equal(r.amount,42);assert.equal(connections[0].accountId,'B');assert.equal(connections[0].accountType,'demo');assert.equal(calls.length,1);assert.equal(calls[0].balance,1);assert.equal(calls[0].buy,undefined);
 await assert.rejects(service.balance('owner',session,'C'));await assert.rejects(service.balance('owner',session,'missing'));assert.equal(connections.length,1);
});
