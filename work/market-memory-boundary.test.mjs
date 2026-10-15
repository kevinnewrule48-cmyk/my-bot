import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {memoryRoute} from '../market-memory-service.mjs';
test('Memory endpoint refuses unauthenticated access without starting storage',async()=>{let result;await memoryRoute({method:'GET'},{},new URL('http://localhost/api/market-memory/export'),{getSession:()=>null,json:(res,status,body)=>result={status,body}});assert.equal(result.status,401);});
test('Memory routes are account scoped and have no execution or reset calls',()=>{const text=readFileSync(new URL('../market-memory-service.mjs',import.meta.url),'utf8');assert.match(text,/account_id===accountId&&a.status==='active'/);assert.match(text,/execution.key\(accountId\)/);assert.doesNotMatch(text,/execution\.(submit|send|buy|reset|resume|channel|stop)\(/);assert.doesNotMatch(text,/\/reset/);});
test('Memory UI is shadow only and isolated from trading controls',()=>{const text=readFileSync(new URL('../public/market-memory-panel.js',import.meta.url),'utf8');assert.match(text,/Execution unchanged/);assert.doesNotMatch(text,/autoControl|authorizePurchase|\/api\/orders|\.click\(.*auto/);});
