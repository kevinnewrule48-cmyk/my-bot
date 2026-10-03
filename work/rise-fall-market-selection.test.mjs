import test from 'node:test';
import assert from 'node:assert/strict';
import {scanMarkets} from '../public/rise-fall/market-selection.js';
import {selectMarket,rankedScan,loadMarketScan} from '../rise-fall-market-selection.mjs';
import {RiseFallService} from '../rise-fall-service.mjs';
import {RiseFallEngine,DEFAULTS} from '../public/rise-fall/engine.js';
const now=1800001200000;
const contracts=['CALL','PUT'].map(contract_type=>({contract_type,min:{value:1,unit:'t'},max:{value:10,unit:'t'}}));
function row(symbol,confidence=90){return {symbol,name:symbol,contracts,contractsAt:now,verifiedDurations:[{duration:5,unit:'t'}],feedHealth:{subscribed:true},engine:{snapshot:t=>({signalId:symbol+':1:CALL',winner:{type:'CALL',confidence},candidates:[{type:'CALL',name:'RISE',ready:t===now,confidence}],reason:'Ready'})}};}
function harness(){
 const service=new RiseFallService({now:()=>now,accounts:async()=>[],connect:()=>{}});service.validation=()=>true;
 const a=row('R_10',85),b=row('JD10',95),c={owner:'o',id:'session',autoSelect:true,symbol:a.symbol,engine:a.engine,config:DEFAULTS,contracts,contractsAt:now,account:{account_id:'demo',account_type:'demo',status:'active',currency:'USD'},session:{expiresAt:now+100000},rpc:{closed:false},running:true,runId:'run',heartbeat:now,used:new Set(),order:{stake:1,duration:5,unit:'t'},marketScan:{rows:new Map([[a.symbol,a],[b.symbol,b]]),loading:false}};
 service.contexts.set('o',c);return {service,c,a,b};
}
test('discovery includes active Volatility, Jump and Step families, excludes unrelated and suspended markets',()=>{
 const rows=scanMarkets([{symbol:'R_10',display_name:'Volatility 10 Index'},{underlying_symbol:'JD10',underlying_symbol_name:'Jump 10 Index'},{symbol:'stpRNG',display_name:'Step Index'},{symbol:'X',display_name:'EUR/USD'},{symbol:'Y',display_name:'Volatility 25 Index',is_trading_suspended:1}]);
 assert.deepEqual(rows.map(r=>r.symbol),['R_10','JD10','stpRNG']);
});
test('highest qualifying score wins without changing duration, stake or config',()=>{
 const {service,c,b}=harness(),config=c.config,order={...c.order};assert.equal(selectMarket(service,c),true);assert.equal(c.symbol,'JD10');assert.equal(c.engine,b.engine);assert.equal(c.config,config);assert.deepEqual(c.order,order);
});
test('unsupported, unverified, failed, unsubscribed, stale and consumed markets cannot win',()=>{
 for(const kind of ['duration','replay','error','subscription','stale','consumed']){
  const {service,c,b}=harness();if(kind==='duration')b.contracts=contracts.slice(0,1);if(kind==='replay')b.verifiedDurations=[];if(kind==='error')b.error='Subscription failed';if(kind==='subscription')b.feedHealth.subscribed=false;if(kind==='stale'){const old=b.engine.snapshot;b.engine.snapshot=()=>old(now+20000);}if(kind==='consumed')c.used.add('JD10:1:CALL');
  assert.equal(selectMarket(service,c),true,kind);assert.equal(c.symbol,'R_10',kind);
 }
});
test('loading, account locks and proposal in flight prevent switching',()=>{
 for(const kind of ['loading','pending','open','other']){const {service,c}=harness();if(kind==='loading')c.marketScan.loading=true;if(kind==='pending')c.pending=true;if(kind==='open')service.journal.push({accountId:'demo',state:'OPEN'});if(kind==='other')service.otherBusy=()=>true;assert.equal(selectMarket(service,c),false);assert.equal(c.symbol,'R_10');}
});
test('no qualifying market waits; manual mode keeps its selected market',()=>{
 const {service,c,a,b}=harness();a.error=b.error='Unavailable';assert.equal(selectMarket(service,c),false);assert.equal(rankedScan(service,c).some(r=>r.eligible),false);c.autoSelect=false;assert.equal(selectMarket(service,c),true);assert.equal(c.symbol,'R_10');
});
test('server scan confirms subscriptions, retains independent histories, and reports unavailable markets',async()=>{
 const {service,c}=harness();service.verifiedDurations=()=>[{duration:5,unit:'t'}];c.symbol='unselected';c.rpc.request=async q=>{
  if(q.active_symbols)return {active_symbols:[{symbol:'R_10',display_name:'Volatility 10 Index'},{symbol:'JD10',display_name:'Jump 10 Index'},{symbol:'stpRNG',display_name:'Step Index'}]};
  if(q.contracts_for)return {contracts_for:{available:q.contracts_for==='stpRNG'?[]:['CALL','PUT'].map(contract_type=>({contract_type,barriers:0,min_contract_duration:'1t',max_contract_duration:'10t'}))}};
  if(q.ticks_history)return {history:{prices:[100,101,102],times:[1800001196,1800001198,1800001200]}};
  return q.ticks==='JD10'?{}:{subscription:{id:'sub'}};
 };
 await loadMarketScan(service,c);assert.equal(c.marketScan.loading,false);assert.equal(c.marketScan.total,3);assert.equal(c.marketScan.rows.get('R_10').engine.history.length,3);assert.match(c.marketScan.rows.get('JD10').error,/subscription/);assert.equal(c.marketScan.rows.get('stpRNG').contracts.length,0);
});
test('actual analyzers switch between up and down markets with mock BUY and broker-shaped settlement; no duplicate episode',async()=>{
 const {service,c,a,b}=harness();for(const [r,sign]of [[a,1],[b,-1]]){r.engine=new RiseFallEngine(r.symbol);for(let i=0;i<600;i++)r.engine.add({symbol:r.symbol,epoch:1800000002+i*2,quote:1000+sign*i*.1});}
 c.engine=a.engine;const calls=[];let contract=0;
 c.rpc.request=async q=>{calls.push(q);if(q.proposal)return {echo_req:q,proposal:{id:'p',ask_price:1,payout:1.9}};if(q.buy)return {buy:{contract_id:++contract,buy_price:1}};return {proposal_open_contract:{contract_id:contract,is_sold:1,status:'won',profit:.9}};};
 await service.maybeExecute(c);await service.maybeExecute(c);await service.maybeExecute(c);
 assert.equal(calls.filter(q=>q.buy).length,2);assert.deepEqual(new Set(service.journal.map(o=>o.symbol)),new Set(['R_10','JD10']));assert.deepEqual(new Set(service.journal.map(o=>o.type)),new Set(['CALL','PUT']));assert.ok(service.journal.every(o=>o.state==='SETTLED'&&o.accountType==='demo'));
});
test('stopping during an automatic-selection proposal prevents BUY',async()=>{
 const {service,c}=harness();const calls=[];c.rpc.request=async q=>{calls.push(q);service.stop('o');return {echo_req:q,proposal:{id:'p',ask_price:1,payout:1.9}};};await service.maybeExecute(c);assert.equal(calls.some(q=>q.buy),false);
});
test('authenticated socket routes each market tick to its own analyzer and keeps a pending order on its market',async()=>{
 const calls=[];
 class Socket extends EventTarget{
  readyState=1;
  emit(d){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(d)}));}
  send(raw){const q=JSON.parse(raw);calls.push(q);let d={};
   if(q.time)d={time:now/1000};
   if(q.active_symbols)d={active_symbols:[{symbol:'R_10',display_name:'Volatility 10 Index'},{symbol:'JD10',display_name:'Jump 10 Index'}]};
   if(q.contracts_for)d={contracts_for:{available:['CALL','PUT'].map(contract_type=>({contract_type,barriers:0,min_contract_duration:'1t',max_contract_duration:'10t'}))}};
   if(q.ticks_history)d={history:{prices:Array.from({length:600},(_,i)=>1000+i*.1),times:Array.from({length:600},(_,i)=>1800000002+i*2)}};
   if(q.ticks)d={subscription:{id:q.ticks}};
   queueMicrotask(()=>this.emit({...d,req_id:q.req_id}));
  }
  close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
 }
 const ws=new Socket(),service=new RiseFallService({now:()=>now,accounts:async()=>[{account_id:'demo',account_type:'demo',status:'active',currency:'USD'}],connect:async()=>ws});
 service.verifiedDurations=()=>[{duration:5,unit:'t'}];service.validation=()=>true;
 await service.prepare('o',{expiresAt:now+100000},{accountId:'demo',symbol:'R_10',config:DEFAULTS,autoSelect:true,duration:5,unit:'t'});
 const c=service.contexts.get('o');await c.scanTask;service.start('o',{sessionId:c.id,stake:1,duration:5,unit:'t'});c.pending=true;
 for(const symbol of ['R_10','JD10'])ws.emit({tick:{symbol,epoch:1800001202,quote:1060},subscription:{id:symbol}});
 assert.equal(c.marketScan.rows.get('R_10').engine.history.at(-1).epoch,1800001202);assert.equal(c.marketScan.rows.get('JD10').engine.history.at(-1).epoch,1800001202);assert.equal(c.symbol,'R_10');assert.equal(calls.some(q=>q.buy||q.proposal),false);ws.close();assert.equal(c.running,false);
});
