import path from 'node:path';
import {Worker} from 'node:worker_threads';
let runtime;
export function startMemory(root,execution){
 if(runtime)return runtime;
 const configured=process.env.MARKET_MEMORY_PATH;
 const warning=process.env.RENDER&&!configured?'Persistent disk path is required on Render; shadow memory unavailable':null;
 runtime={warning};if(warning)return runtime;
 const worker=new Worker(new URL('./market-memory-worker.mjs',import.meta.url),{workerData:{file:configured||path.join(root,'work','market-memory.sqlite')}});
 worker.unref();let serial=0;const pending=new Map(),seen=new Map();
 runtime.call=message=>new Promise((resolve,reject)=>{if(runtime.warning)return reject(Error(runtime.warning));if(pending.size>=4)return reject(Error('Memory observer busy; trading unaffected'));const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('Memory observer timeout; trading unaffected'));},15000);pending.set(id,{resolve,reject,timer});worker.postMessage({...message,id});});
 worker.on('message',({id,result,error})=>{const p=pending.get(id);if(!p)return;clearTimeout(p.timer);pending.delete(id);error?p.reject(Error(error)):p.resolve(result);});
 const fail=e=>{runtime.warning=e.message;for(const p of pending.values()){clearTimeout(p.timer);p.reject(e);}pending.clear();};
 worker.on('error',fail);worker.on('exit',code=>fail(Error('Memory worker stopped ('+code+'); trading unchanged')));
 let busy=false;
 const scan=async()=>{if(busy||runtime.warning)return;busy=true;try{const attempts=[];for(const [owner,account] of Object.entries(execution.data.accounts))for(const a of account.attempts??[]){const key=owner+':'+a.attemptId;if(!a.request?.balanceState||seen.get(key)===a.state)continue;const r=a.result;attempts.push({owner,attempt:{attemptId:a.attemptId,request:a.request,state:a.state,startedAt:a.startedAt,stageAt:a.stageAt,contractId:a.contractId,result:r?{status:r.status,profit:r.profit,exitTickTime:r.exitTickTime,entryTick:r.entryTick,exitTick:r.exitTick,lifecycle:{brokerEntryDigit:r.lifecycle?.brokerEntryDigit,settlementDigit:r.lifecycle?.settlementDigit}}:null}});}
 if(attempts.length){await runtime.call({kind:'scan',attempts});for(const {owner,attempt:a} of attempts)seen.set(owner+':'+a.attemptId,a.state);}
 // Retain deduplication keys only for records still in the existing execution ledger.
 const active=new Set(Object.entries(execution.data.accounts).flatMap(([owner,a])=>(a.attempts??[]).map(x=>owner+':'+x.attemptId)));for(const key of seen.keys())if(!active.has(key))seen.delete(key);
 }catch(e){console.warn('Memory observation unavailable:',e.message);}finally{busy=false;}};
 void scan();runtime.timer=setInterval(scan,1000);runtime.timer.unref();return runtime;
}
export async function memoryRoute(req,res,url,{root,execution,getSession,readJson,json,deriv}){
 const session=getSession(req);if(!session)return json(res,401,{error:'Connect your account to view market memory.'});
 try{
  const rt=startMemory(root,execution);
  if(!['GET','POST'].includes(req.method))return json(res,405,{error:'Method not allowed'});
  if(req.method==='POST'&&url.pathname!=='/api/market-memory/observe')return json(res,404,{error:'Unknown memory route'});
  const body=req.method==='POST'?await readJson(req,256000):{};
  const accountId=body.accountId??url.searchParams.get('accountId');
  if(!session.executionAccounts||session.executionAccountsAt<Date.now()-30000){const r=await deriv('/trading/v1/options/accounts',session.accessToken,{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Account verification failed');session.executionAccounts=(await r.json()).data??[];session.executionAccountsAt=Date.now();}
  const account=session.executionAccounts.find(a=>a.account_id===accountId&&a.status==='active');if(!account)return json(res,403,{error:'Account unavailable'});
  if(rt.warning)return json(res,503,{mode:'SHADOW',execution:'UNCHANGED',error:rt.warning});
  const owner=execution.key(accountId);
  if(!['/api/market-memory/export','/api/market-memory/observe','/api/market-memory/status'].includes(url.pathname))return json(res,404,{error:'Unknown memory route'});
  const result=await rt.call({kind:url.pathname.endsWith('/export')?'export':req.method==='POST'?'observe':'status',owner,account:{account_type:account.account_type,currency:account.currency},ticks:body.ticks,symbol:body.symbol??url.searchParams.get('symbol')});
  return json(res,200,result);
 }catch(e){return json(res,400,{mode:'SHADOW',execution:'UNCHANGED',error:e.message});}
}
