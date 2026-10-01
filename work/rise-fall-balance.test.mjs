import test from 'node:test';
import assert from 'node:assert/strict';
import {selectedBalance} from '../public/rise-fall/balance.js';
test('balance belongs to selected demo account, including zero',()=>{
 const accounts=[{accountId:'A',accountType:'demo',balance:0,currency:'USD'},{accountId:'B',accountType:'demo',balance:'5720.36',currency:'USD'},{accountId:'C',accountType:'real',balance:99}];
 assert.equal(selectedBalance(accounts,'A').amount,0);assert.equal(selectedBalance(accounts,'B').amount,5720.36);assert.equal(selectedBalance(accounts,'C'),null);assert.equal(selectedBalance(accounts,'missing'),null);
});
test('missing balances never display a made-up zero',()=>{for(const balance of [null,undefined,'','invalid'])assert.equal(selectedBalance([{accountId:'A',accountType:'demo',balance}],'A'),null);});
