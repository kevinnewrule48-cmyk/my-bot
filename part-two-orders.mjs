// Separate Part Two demo execution. Part One channels and receipts are never used.
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {createAutoAuthority,analyzeServerHistory} from './part-two-auto.mjs';
import {precisionFromPip,extractDigit} from './public/part-two/engine.js';
export function validateOrder(body) {
  const {requestId,accountId,symbol,type,barrier,stake,mode}=body;
  if(!/^[a-zA-Z0-9-]{16,80}$/.test(requestId??'')||typeof accountId!=='string'||!accountId||!/^[A-Za-z0-9_]{2,30}$/.test(symbol??''))throw Error('Invalid order identifiers');
  if(!['OVER','UNDER'].includes(type)||!Number.isInteger(barrier)||barrier<(type==='OVER'?0:1)||barrier>(type==='OVER'?8:9))throw Error('Invalid OVER/UNDER barrier');
  if(!Number.isFinite(stake)||stake<=0||stake>50)throw Error('Part Two stake must be greater than zero and at most 50 account-currency units.');
  if(!['manual','auto'].includes(mode))throw Error('Select Manual or Auto.');
  return {requestId,accountId,symbol,type,barrier,stake,mode};
}
export function riskReason(orders,accountId,stake,now=Date.now()) {
  const account=orders.filter(o=>o.accountId===accountId);
  if(account.some(o=>['pending','entered','unknown'].includes(o.state)))return 'An order is pending or unresolved. Check its Deriv result before another order.';
  const day=new Date(now).toISOString().slice(0,10),today=account.filter(o=>new Date(o.createdAt).toISOString().startsWith(day)&&!['rejected','skipped'].includes(o.state));
  if(today.length>=100)return 'Part Two daily maximum of 100 orders reached.';
  const settled=today.filter(o=>o.state==='settled');
  const losses=settled.reduce((sum,o)=>sum+Math.max(0,-o.profit),0),net=settled.reduce((sum,o)=>sum+o.profit,0);
  if(losses+stake>50)return 'Part Two daily loss budget is 50; this stake would exceed the remaining budget.';
  if(net>=100)return 'Part Two daily profit target of 100 reached.';
  let streak=0;for(const o of [...settled].reverse()){if(o.profit<0)streak++;else break;}
  if(streak>=5)return 'Part Two stopped after five consecutive losses.';
  return null;
}
export function createPartTwoOrders({file,deriv,getSession,cookieValue,json,readJson,modelFile,autoAuthority=createAutoAuthority({modelFile})}) {
  let ledger=null,loading=null,queue=Promise.resolve();
  async function authorizedAccounts(session){
    const response=await deriv('/trading/v1/options/accounts',session.accessToken);
    if(!response.ok)throw Error('Account connection unavailable');
    const data=(await response.json()).data;
    if(!Array.isArray(data))throw Error('Account list unavailable');
    return data.filter(a=>a.account_type==='demo'&&a.status==='active');
  }
  async function load(){if(ledger)return;loading??=(async()=>{try{ledger=JSON.parse(await readFile(file,'utf8'));if(!Array.isArray(ledger))throw Error('Invalid ledger');for(const order of ledger)if(['pending','entered'].includes(order.state))order.state='unknown';}catch(e){if(e.code==='ENOENT')ledger=[];else throw e;}})();await loading;}
  async function save(){await mkdir(path.dirname(file),{recursive:true});await writeFile(file+'.tmp',JSON.stringify(ledger));await rename(file+'.tmp',file);}
  const serial=fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result;};
  async function update(order,changes){return serial(async()=>{Object.assign(order,changes);await save();});}
  async function run(order,session,owner,generation) {
    let socket,timer,buySent=false,finished=false,snapshot,proposalPending=false;
    const proposal=()=>socket.send(JSON.stringify({proposal:1,amount:order.stake,basis:'stake',contract_type:order.type==='OVER'?'DIGITOVER':'DIGITUNDER',currency:order.currency,duration:1,duration_unit:'t',barrier:String(order.barrier),underlying_symbol:order.symbol,req_id:1}));
    const finish=async changes=>{if(finished)return;finished=true;clearTimeout(timer);socket?.close();await update(order,changes);};
    try{
      const response=await deriv(`/trading/v1/options/accounts/${encodeURIComponent(order.accountId)}/otp`,session.accessToken,{method:'POST'});
      if(!response.ok)throw Error('Could not open Deriv demo trading connection.');
      const url=(await response.json())?.data?.url;
      const parsed=new URL(url);
      if(parsed.protocol!=='wss:'||!(parsed.hostname==='derivws.com'||parsed.hostname.endsWith('.derivws.com'))||!parsed.pathname.endsWith('/ws/demo'))throw Error('Unexpected trading connection.');
      socket=new WebSocket(url);
      timer=setTimeout(()=>{finish({state:buySent?'unknown':'rejected',error:'Deriv response timed out. No automatic retry.'}).catch(console.error);},30000);
      socket.onopen=()=>socket.send(JSON.stringify({active_symbols:'brief',req_id:4}));
      socket.onmessage=async event=>{try{
        const data=JSON.parse(event.data);if(finished)return;
        if(data.error)return await finish({state:buySent?'unknown':'rejected',error:data.error.message??'Deriv rejected request.'});
        if(data.active_symbols&&data.req_id===4){
          const market=data.active_symbols.find(m=>(m.underlying_symbol??m.symbol)===order.symbol);
          if(!market||market.is_trading_suspended||!market.exchange_is_open)throw Error('Market unavailable');
          await update(order,{precision:precisionFromPip(market.pip_size??market.pip)});
          if(finished)return;
          if(order.mode==='auto')socket.send(JSON.stringify({ticks_history:order.symbol,end:'latest',count:1000,style:'ticks',req_id:5}));else proposal();
        }
        if(data.history&&data.req_id===5&&order.mode==='auto'){snapshot=analyzeServerHistory(data.history,order);proposal();}
        if(data.proposal&&data.req_id===1&&!buySent&&!proposalPending){
          proposalPending=true;
          const p=data.proposal,ask=Number(p.ask_price),payout=Number(p.payout);
          if(!p.id||!Number.isFinite(ask)||ask<=0||ask>order.stake||!Number.isFinite(payout)||payout<=ask)throw Error('Invalid Deriv proposal.');
          const evidence=order.mode==='auto'?await autoAuthority.check(owner,order,snapshot,ask,payout,ledger,generation):{};
          await update(order,{state:'pending',ask,payout,...evidence});
          if(finished)return;
          if(order.mode==='auto')await autoAuthority.check(owner,order,snapshot,ask,payout,ledger,generation);
          if(finished)return;
          buySent=true;socket.send(JSON.stringify({buy:p.id,price:ask,req_id:2}));
        }else if(data.buy&&data.req_id===2){
          await update(order,{state:'entered',contractId:data.buy.contract_id,buyPrice:Number(data.buy.buy_price)});
          socket.send(JSON.stringify({proposal_open_contract:1,contract_id:data.buy.contract_id,subscribe:1,req_id:3}));
        }else if(data.proposal_open_contract&&data.proposal_open_contract.contract_id===order.contractId){
          const c=data.proposal_open_contract;
          const fields={entryQuote:c.entry_tick??c.entry_spot??null,exitQuote:c.exit_tick??c.exit_spot??null};
          fields.entryDigit=fields.entryQuote===null?null:extractDigit(fields.entryQuote,order.precision).digit;
          fields.exitDigit=fields.exitQuote===null?null:extractDigit(fields.exitQuote,order.precision).digit;
          if(c.is_sold){const profit=Number(c.profit);if(c.profit==null||c.profit===''||!Number.isFinite(profit))throw Error('Settlement profit missing');await finish({...fields,state:'settled',profit,returnAmount:order.buyPrice+profit,outcome:c.status,completedAt:Date.now()});}
          else if(fields.entryQuote!==null&&order.entryQuote!==fields.entryQuote)await update(order,fields);
        }
      }catch(error){await finish({state:buySent?'unknown':order.mode==='auto'?'skipped':'rejected',error:error.message});}};
      socket.onerror=()=>{finish({state:buySent?'unknown':'rejected',error:'Trading connection error. No automatic retry.'}).catch(console.error);};
      socket.onclose=()=>{finish({state:buySent?'unknown':'rejected',error:'Trading connection closed before a result. No automatic retry.'}).catch(console.error);};
    }catch(error){await finish({state:buySent?'unknown':'rejected',error:error.message});}
  }
  return async(req,res,url)=>{
    if(!url.pathname.startsWith('/api/part-two/'))return false;
    const session=getSession(req);
    if(!session){json(res,401,{error:'Connect your Deriv account first.'});return true;}
    try{
      await load();
      if(url.pathname==='/api/part-two/orders'&&req.method==='GET'){
        const accounts=await authorizedAccounts(session),ids=new Set(accounts.map(a=>a.account_id));
        const autoValidation=await autoAuthority.status();
        json(res,200,{orders:ledger.filter(o=>ids.has(o.accountId)),autoValidated:autoValidation.available,autoValidation,realEnabled:false});return true;
      }
      if(!['/api/part-two/order','/api/part-two/auto/start','/api/part-two/auto/stop','/api/part-two/auto/heartbeat'].includes(url.pathname)||req.method!=='POST'){json(res,404,{error:'Not found'});return true;}
      const origin=req.headers.origin;if(origin&&origin!==new URL(`http://${req.headers.host}`).origin&&origin!==`https://${req.headers.host}`){json(res,403,{error:'Invalid request origin'});return true;}
      const raw=await readJson(req),owner=cookieValue?.(req,'deriv_session');
      if(url.pathname==='/api/part-two/auto/stop'){autoAuthority.stop(owner,raw.accountId);json(res,200,{stopped:true});return true;}
      const body=validateOrder(raw);
      const accounts=await authorizedAccounts(session);
      const account=accounts.find(a=>a.account_id===body.accountId);
      if(!account)throw Error('Select a connected demo account. Part Two real trading remains disabled.');
      if(url.pathname.includes('/auto/')){
        if(!owner||body.mode!=='auto')throw Error('An authenticated Auto session is required');
        if(url.pathname.endsWith('/start')){const reason=riskReason(ledger,body.accountId,body.stake);if(reason)throw Error(reason);await autoAuthority.start(owner,body,raw.cooldown);}
        else autoAuthority.heartbeat(owner,body);
        json(res,200,{armed:true});return true;
      }
      const result=await serial(async()=>{
        const existing=ledger.find(o=>o.requestId===body.requestId);
        if(existing){if(['accountId','symbol','type','barrier','stake','mode'].some(k=>existing[k]!==body[k]))throw Error('Request identifier has different parameters');return existing;}
        const reason=riskReason(ledger,body.accountId,body.stake);if(reason)throw Error(reason);
        const generation=body.mode==='auto'?autoAuthority.capture(owner,body):null;
        const order={...body,currency:account.currency,state:'pending',createdAt:Date.now()};ledger.push(order);await save();
        run(order,session,owner,generation).catch(error=>console.error('Part Two order tracking error:',error.message));return order;
      });
      json(res,202,{order:result});
    }catch(error){json(res,409,{error:error.message});}
    return true;
  };
}
