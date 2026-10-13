import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';import {AutoDiagnostics,stopCategory} from '../public/auto-diagnostics.js';
const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('order parser accepts complete evidence above old limit and rejects oversized bodies with exact HTTP-stage evidence',async()=>{
 const ctx=vm.createContext({Buffer,JSON,Error});vm.runInContext(server.slice(server.indexOf('const readJson ='),server.indexOf('const json ='))+'\nglobalThis.parse=readJson;',ctx);
 const body=JSON.stringify({decision:{evidence:'x'.repeat(40000)}}),request=async function*(){yield Buffer.from(body);};
 await assert.rejects(ctx.parse(request(),32768),e=>e.code==='REQUEST_TOO_LARGE'&&e.stage==='HTTP_BODY');
 const routeLimit=Number(server.match(/await readJson\(req,([\d_]+)\)/)[1].replaceAll('_',''));assert.equal(routeLimit,262144);
 assert.equal((await ctx.parse(request(),routeLimit)).decision.evidence.length,40000);
 await assert.rejects(ctx.parse((async function*(){yield Buffer.alloc(routeLimit+1);})(),routeLimit),e=>e.code==='REQUEST_TOO_LARGE'&&e.receivedBytes===routeLimit+1&&e.limitBytes===routeLimit);
});
test('overlapping same-run recovery: stale response cannot overwrite newer acknowledgment or clear pending handshake',async()=>{
 const calls=[];const ctx=vm.createContext({crypto:{randomUUID:()=> 'run'},AbortSignal,Date,Error,Number,JSON,fetch:async()=>new Promise(resolve=>calls.push(resolve)),selectedAccount:()=>({accountId:'demo'}),auditStage:()=>{},renderParallel:()=>{}});
 vm.runInContext(`let parallelRevision=0,parallelAutoReady=false,parallelRunId='run',autoControlPending=false,autoAuthorizationState='AUTO_RECOVERING',autoLastError='',executionReset=Promise.resolve(),executionPageId='page',autoEnabled=true,botMode='auto',isRunning=true,socket={readyState:1},overUnderEngineState={armed:true},differEngineState={armed:false},balanceBook={autoEligibility:{}},eligibilityRevision=1,serverClockOffsetMs=0;`+app.slice(app.indexOf('const syncParallelControl='),app.indexOf('const verifyAutoAuthorization='))+`\nglobalThis.sync=syncParallelControl;globalThis.state=()=>({parallelAutoReady,autoControlPending,autoAuthorizationState});`,ctx);
 const a=ctx.sync(true);await new Promise(setImmediate);const b=ctx.sync(true);await new Promise(setImmediate);
 calls[0]({ok:false,json:async()=>({error:'superseded'})});await a;assert.equal(ctx.state().autoControlPending,true);
 calls[1]({ok:true,json:async()=>({runId:'run',authorization:{state:'AUTO_AUTHORIZED',pageId:'page'}})});await b;assert.equal(ctx.state().parallelAutoReady,true);assert.equal(ctx.state().autoControlPending,false);
 const c=ctx.sync(true);await new Promise(setImmediate);const d=ctx.sync(true);await new Promise(setImmediate);
 calls[3]({ok:true,json:async()=>({runId:'run',authorization:{state:'AUTO_AUTHORIZED',pageId:'page'}})});await d;
 calls[2]({ok:false,json:async()=>({error:'superseded'})});await c;assert.equal(ctx.state().parallelAutoReady,true);
});
test('one terminal reason survives subsequent stale evidence and duplicate rejection observations',()=>{
 const d=new AutoDiagnostics(),c={id:'fresh-a',market:'R_25',ready:true};d.record(c,'UNKNOWN CONTRACT PROPOSAL','system','broker rejection',true);d.record(c,'SIGNAL EXPIRED','system');d.record(c,'UNKNOWN CONTRACT PROPOSAL','system','broker rejection',true);
 assert.equal(d.export().candidates[0].category,'UNKNOWN CONTRACT PROPOSAL');assert.equal(d.snapshot().counts.proposalBuy,1);
 d.record({...c,id:'fresh-b'},'QUALIFIED — AWAITING EXECUTION CHECK');assert.equal(d.export().candidates.length,2);
 assert.equal(stopCategory({message:'Request too large'}),'ORDER REQUEST TOO LARGE');assert.equal(stopCategory({message:'Account session expired; reconnect your account.'}),'SESSION EXPIRED');
});
