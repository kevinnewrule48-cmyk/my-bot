import test from 'node:test';
import assert from 'node:assert/strict';
import {AutoControl} from '../public/rise-fall/auto-control.js';
import {RiseFallEngine,analyze} from '../public/rise-fall/engine.js';
import {presetConfig} from '../public/rise-fall/presets.js';
import {riseFallRoutes} from '../rise-fall-service.mjs';
test('Status responds while broker reconciliation is still pending',async()=>{
 let refreshed=false;const replies=[];
 const service={refresh:()=>{refreshed=true;return new Promise(()=>{});},status:()=>({running:true})};
 await riseFallRoutes(service,{getSession:()=>({}),cookieValue:()=> 'owner',json:(_res,code,value)=>replies.push({code,value})})({method:'GET'},{},new URL('http://local/api/rise-fall/status'));
 assert.equal(refreshed,true);assert.deepEqual(replies,[{code:200,value:{running:true}}]);
});
test('Lost start reply reconciles running server without repeating Start',async()=>{
 const calls=[],states=[],c=new AutoControl(async route=>{calls.push(route);if(route.endsWith('/start'))throw Error('signal timed out');return {sessionId:'s',running:true};},s=>states.push(s));
 await c.start({sessionId:'s'});assert.equal(c.intent,true);assert.equal(states[0].running,true);assert.deepEqual(calls,['rise-fall/start','rise-fall/status']);
});
test('Start and slow status cannot prevent independent heartbeats or cause duplicate starts',async()=>{
 let finish;const calls=[],c=new AutoControl(async route=>{calls.push(route);if(route.endsWith('/start'))return new Promise(r=>finish=r);return {running:true};},()=>{});
 const start=c.start({sessionId:'s'});await c.start({sessionId:'s'});await c.heartbeat();assert.deepEqual(calls,['rise-fall/start','rise-fall/heartbeat']);finish({sessionId:'s',running:true});await start;
});
test('Lost status remains unknown; later authoritative OFF ends heartbeat intent',async()=>{
 const c=new AutoControl(async()=>{throw Error('network unavailable');},()=>{});await assert.rejects(c.start({sessionId:'s'}),/unknown/);assert.equal(c.intent,true);c.observe({sessionId:'s',running:false});assert.equal(c.intent,false);
});
test('Explicit rejection never retries; Stop invalidates a late successful start reply',async()=>{
 const denied=new AutoControl(async()=>{throw Object.assign(Error('expired'),{status:401});},()=>{});await assert.rejects(denied.start({sessionId:'s'}),/expired/);assert.equal(denied.intent,false);
 let finish;const states=[],c=new AutoControl(()=>new Promise(r=>finish=r),s=>states.push(s));const p=c.start({sessionId:'s'});c.stop();finish({sessionId:'s',running:true});await p;assert.equal(c.intent,false);assert.deepEqual(states,[]);
});
test('Historical V2 batch defers calculation and preserves exact final analysis',()=>{
 const config=presetConfig('balancedV2'),e=new RiseFallEngine('R_100',config);for(let i=0;i<1500;i++)e.add({epoch:1800000000+i,quote:1000+i*.1},{live:false});assert.equal(e.trendBase,null);
 const a=e.snapshot(1800001499000),expected=analyze(e.history,config,1800001499000);assert.deepEqual(a.candidates,expected.candidates);assert.equal(a.confirmation.liveObservations,0);const base=e.trendBase;e.snapshot(1800001499000);assert.equal(e.trendBase,base);
});
