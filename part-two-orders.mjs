// Separate Part Two demo execution. Part One channels and receipts are never used.
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
export function validateOrder(body) {
  const {requestId,accountId,symbol,type,barrier,stake,mode}=body;
  if(!/^[a-zA-Z0-9-]{16,80}$/.test(requestId??'')||typeof accountId!=='string'||!accountId||!/^[A-Za-z0-9_]{2,30}$/.test(symbol??''))throw Error('Invalid order identifiers');
  if(!['OVER','UNDER'].includes(type)||!Number.isInteger(barrier)||barrier<(type==='OVER'?0:1)||barrier>(type==='OVER'?8:9))throw Error('Invalid OVER/UNDER barrier');
  if(!Number.isFinite(stake)||stake<=0||stake>50)throw Error('Part Two stake must be greater than zero and at most 50 account-currency units.');
  if(!['manual','auto'].includes(mode))throw Error('Select Manual or Auto.');
  if(mode==='auto')throw Error('Auto is waiting: independent calibration and payout validation have not passed.');
  return {requestId,accountId,symbol,type,barrier,stake,mode};
}
export function riskReason(orders,accountId,stake,now=Date.now()) {
  const account=orders.filter(o=>o.accountId===accountId);
  if(account.some(o=>['pending','entered','unknown'].includes(o.state)))return 'An order is pending or unresolved. Check its Deriv result before another order.';
  const day=new Date(now).toISOString().slice(0,10),today=account.filter(o=>new Date(o.createdAt).toISOString().startsWith(day)&&o.state!=='rejected');
  if(today.length>=100)return 'Part Two daily maximum of 100 orders reached.';
  const settled=today.filter(o=>o.state==='settled');
  const losses=settled.reduce((sum,o)=>sum+Math.max(0,-o.profit),0),net=settled.reduce((sum,o)=>sum+o.profit,0);
  if(losses+stake>50)return 'Part Two daily loss budget is 50; this stake would exceed the remaining budget.';
  if(net>=100)return 'Part Two daily profit target of 100 reached.';
  let streak=0;for(const o of [...settled].reverse()){if(o.profit<0)streak++;else break;}
  if(streak>=5)return 'Part Two stopped after five consecutive losses.';
  return null;
}
export function createPartTwoOrders({file,deriv,getSession,cookieValue,json,readJson}) {
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
  async function run(order,session) {
    let socket,timer,buySent=false,finished=false;
    const finish=async changes=>{if(finished)return;finished=true;clearTimeout(timer);socket?.close();await update(order,changes);};
    try{
      const response=await deriv(`/trading/v1/options/accounts/${encodeURIComponent(order.accountId)}/otp`,session.accessToken,{method:'POST'});
      if(!response.ok)throw Error('Could not open Deriv demo trading connection.');
      const url=(await response.json())?.data?.url;
      const parsed=new URL(url);
      if(parsed.protocol!=='wss:'||!(parsed.hostname==='derivws.com'||parsed.hostname.endsWith('.derivws.com'))||!parsed.pathname.endsWith('/ws/demo'))throw Error('Unexpected trading connection.');
      socket=new WebSocket(url);
      timer=setTimeout(()=>{finish({state:buySent?'unknown':'rejected',error:'Deriv response timed out. No automatic retry.'}).catch(console.error);},30000);
      socket.onopen=()=>socket.send(JSON.stringify({proposal:1,amount:order.stake,basis:'stake',contract_type:order.type==='OVER'?'DIGITOVER':'DIGITUNDER',currency:order.currency,duration:1,duration_unit:'t',barrier:String(order.barrier),underlying_symbol:order.symbol,req_id:1}));
      socket.onmessage=async event=>{try{
        const data=JSON.parse(event.data);if(finished)return;
        if(data.error)return await finish({state:buySent?'unknown':'rejected',error:data.error.message??'Deriv rejected request.'});
        if(data.proposal&&data.req_id===1&&!buySent){
          const p=data.proposal,ask=Number(p.ask_price),payout=Number(p.payout);
          if(!p.id||!Number.isFinite(ask)||ask<=0||ask>order.stake||!Number.isFinite(payout)||payout<=ask)throw Error('Invalid Deriv proposal.');
          buySent=true;await update(order,{state:'pending',ask,payout});
          if(finished)return;socket.send(JSON.stringify({buy:p.id,price:ask,req_id:2}));
        }else if(data.buy&&data.req_id===2){
          await update(order,{state:'entered',contractId:data.buy.contract_id,buyPrice:Number(data.buy.buy_price)});
          socket.send(JSON.stringify({proposal_open_contract:1,contract_id:data.buy.contract_id,subscribe:1,req_id:3}));
        }else if(data.proposal_open_contract&&data.proposal_open_contract.contract_id===order.contractId){
          const c=data.proposal_open_contract;
          const fields={entryQuote:c.entry_tick??c.entry_spot??null,exitQuote:c.exit_tick??c.exit_spot??null};
          if(c.is_sold){const profit=Number(c.profit);if(!Number.isFinite(profit))throw Error('Settlement profit missing');await finish({...fields,state:'settled',profit,outcome:c.status,completedAt:Date.now()});}
          else if(fields.entryQuote!==null&&order.entryQuote!==fields.entryQuote)await update(order,fields);
        }
      }catch(error){await finish({state:buySent?'unknown':'rejected',error:error.message});}};
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
        json(res,200,{orders:ledger.filter(o=>ids.has(o.accountId)),autoValidated:false,realEnabled:false});return true;
      }
      if(url.pathname!=='/api/part-two/order'||req.method!=='POST'){json(res,404,{error:'Not found'});return true;}
      const origin=req.headers.origin;if(origin&&origin!==new URL(`http://${req.headers.host}`).origin&&origin!==`https://${req.headers.host}`){json(res,403,{error:'Invalid request origin'});return true;}
      const body=validateOrder(await readJson(req));
      const accounts=await authorizedAccounts(session);
      const account=accounts.find(a=>a.account_id===body.accountId);
      if(!account)throw Error('Select a connected demo account. Part Two real trading remains disabled.');
      const result=await serial(async()=>{
        const existing=ledger.find(o=>o.requestId===body.requestId);
        if(existing){if(['accountId','symbol','type','barrier','stake','mode'].some(k=>existing[k]!==body[k]))throw Error('Request identifier has different parameters');return existing;}
        const reason=riskReason(ledger,body.accountId,body.stake);if(reason)throw Error(reason);
        const order={...body,currency:account.currency,state:'pending',createdAt:Date.now()};ledger.push(order);await save();
        run(order,session).catch(error=>console.error('Part Two order tracking error:',error.message));return order;
      });
      json(res,202,{order:result});
    }catch(error){json(res,409,{error:error.message});}
    return true;
  };
}
