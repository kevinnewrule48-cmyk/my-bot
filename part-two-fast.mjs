// One-use prepared demo connections. Preparation never sends a buy.
export function createFastPool({deriv,now=Date.now}){
 const slots=new Map();
 const key=o=>JSON.stringify([o.accountId,o.symbol,o.type,o.barrier,o.stake,o.currency]);
 function discard(owner){const s=slots.get(owner);if(s){slots.delete(owner);clearTimeout(s.timer);s.socket?.close();}}
 async function prepare(owner,order,session){
  const old=slots.get(owner);if(old&&old.key===key(order)&&now()-old.created<8000)return old.promise;
  discard(owner);const s={key:key(order),created:now()};slots.set(owner,s);
  s.promise=(async()=>{
   const response=await deriv(`/trading/v1/options/accounts/${encodeURIComponent(order.accountId)}/otp`,session.accessToken,{method:'POST'});
   if(!response.ok)throw Error('Preparation connection unavailable');
   const url=(await response.json())?.data?.url,p=new URL(url);
   if(p.protocol!=='wss:'||!(p.hostname==='derivws.com'||p.hostname.endsWith('.derivws.com'))||!p.pathname.endsWith('/ws/demo'))throw Error('Unexpected trading connection');
   if(slots.get(owner)!==s)throw Error('Preparation changed');
   s.socket=new WebSocket(url);
   await new Promise((resolve,reject)=>{
    s.timer=setTimeout(()=>{discard(owner);reject(Error('Preparation expired'));},10000);s.timer.unref?.();
    s.socket.onopen=()=>{s.socket.send(JSON.stringify({active_symbols:'brief',req_id:4}));s.socket.send(JSON.stringify({proposal:1,amount:order.stake,basis:'stake',contract_type:order.type==='OVER'?'DIGITOVER':'DIGITUNDER',currency:order.currency,duration:1,duration_unit:'t',barrier:String(order.barrier),underlying_symbol:order.symbol,req_id:1}));};
    s.socket.onmessage=e=>{try{const d=JSON.parse(e.data);if(d.error)throw Error(d.error.message);if(d.active_symbols)s.market=d;if(d.proposal){s.proposal=d;s.quoteAt=now();}if(s.market&&s.proposal){s.ready=true;resolve();}}catch(e){reject(e);discard(owner);}};
    s.socket.onerror=()=>{reject(Error('Preparation failed'));discard(owner);};
    s.socket.onclose=()=>{reject(Error('Preparation closed'));if(slots.get(owner)===s)slots.delete(owner);};
   });return {ready:true};
  })().catch(e=>{if(slots.get(owner)===s)discard(owner);throw e;});return s.promise;
 }
 return {prepare,discard,claim(owner,order){const s=slots.get(owner);if(!s||!s.ready||s.key!==key(order)||now()-s.created>8000||s.socket.readyState!==1)return null;slots.delete(owner);clearTimeout(s.timer);s.socket.onclose=null;s.socket.onerror=null;s.socket.onmessage=null;return s;}};
}
