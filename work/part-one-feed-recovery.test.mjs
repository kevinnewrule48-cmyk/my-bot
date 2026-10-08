import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
function harness(){
 const timers=new Map(),sockets=[],elements=new Map();let id=0;
 class Socket{constructor(){this.readyState=0;sockets.push(this);}send(){}close(){this.readyState=3;this.onclose?.();}open(){this.readyState=1;this.onopen();this.onmessage({data:JSON.stringify({time:Date.now()/1000})});}tick(epoch=Date.now()/1000){this.onmessage({data:JSON.stringify({tick:{symbol:'R_100',quote:123.45,epoch,pip_size:2}})});}}
 const c=vm.createContext({Date,performance,Number,Math,JSON,WebSocket:Socket,setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:id=>timers.delete(id),socket:null,isRunning:false,parallelAutoReady:true,parallelRunId:'old',autoControlPending:false,tradabilitySyncKey:null,tradabilityServer:null,autoEnabled:true,autoAuthorizationState:'AUTO_AUTHORIZED',autoLastError:'',differEngineState:{},balanceBook:{},tradabilityMarkets:{start(){}},strengthSample:null,renderParallel(){},updateAutoState(){},auditStage(){},syncTradability(){},syncParallelControl(){c.authorizations++;},authorizations:0,refreshPricing(){},addTick(){c.ticks++;},ticks:0,quotes:{},updatePricing(){},logger(){},$:name=>{if(!elements.has(name))elements.set(name,{value:'R_100'});return elements.get(name);}});
 vm.runInContext(source.slice(source.indexOf('let liveFeedSymbol = null;'),source.indexOf('const backtest ='))+';globalThis.start=startLive;globalThis.stop=stopLiveFeed;',c);
 return {c,sockets,timers,runTimer(){const [key,fn]=timers.entries().next().value;timers.delete(key);fn();}};
}
test('disconnect retains Auto intent, retries and waits for fresh tick and authorization',()=>{const h=harness();h.c.start();let s=h.sockets[0];s.open();assert.equal(h.c.isRunning,false);s.tick();assert.equal(h.c.authorizations,1);s.close();assert.equal(h.c.autoEnabled,true);assert.equal(h.c.parallelAutoReady,false);assert.equal(h.c.isRunning,false);h.runTimer();s=h.sockets[1];s.open();s.tick(Date.now()/1000-60);assert.equal(h.c.isRunning,false);s.tick();assert.equal(h.c.isRunning,true);assert.equal(h.c.authorizations,2);assert.equal(h.c.parallelAutoReady,false);});
test('explicit Stop cancels reconnect and ignores obsolete socket callbacks',()=>{const h=harness();h.c.start();const s=h.sockets[0];s.open();s.close();h.c.stop();assert.equal(h.timers.size,0);s.tick();assert.equal(h.c.isRunning,false);assert.equal(h.c.ticks,0);});
test('silent stalled connection reconnects with purchases paused',()=>{const h=harness();h.c.start();h.sockets[0].open();h.sockets[0].tick();h.runTimer();assert.equal(h.c.isRunning,false);assert.equal(h.c.autoEnabled,true);assert.equal(h.c.parallelAutoReady,false);h.runTimer();assert.equal(h.sockets.length,2);});
test('repeated Start and old close cannot replace the current subscription',()=>{const h=harness();h.c.start();h.c.start();assert.equal(h.sockets.length,1);const old=h.sockets[0];old.close();h.runTimer();old.onclose();assert.equal(h.sockets.length,2);assert.equal(h.c.socket,h.sockets[1]);});

test('broker clock offset does not reject live ticks; stale broker ticks still fail',()=>{const h=harness();h.c.start();const s=h.sockets[0];s.open();const broker=Date.now()/1000+3600;s.onmessage({data:JSON.stringify({time:broker})});s.tick(broker-60);assert.equal(h.c.isRunning,false);s.tick(broker);assert.equal(h.c.isRunning,true);assert.equal(h.c.ticks,1);});
