import {randomUUID} from 'node:crypto';
const attached=new WeakMap();
const sensitive=/token|authorize|authorization|otp|password|secret|cookie|app.?id|account|loginid|email|url/i;
function redact(value,depth=0){
 if(depth>12)return '[DEPTH LIMIT]';
 if(typeof value==='string')return value.replace(/(?:wss?|https?):\/\/\S+/gi,'[URL REDACTED]').replace(/Bearer\s+\S+/gi,'Bearer [REDACTED]').slice(0,2048);
 if(Array.isArray(value))return value.slice(0,50).map(v=>redact(v,depth+1));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).slice(0,100).map(([k,v])=>[k,sensitive.test(k)?'[REDACTED]':redact(v,depth+1)]));
 return value;
}
// Diagnostic observer only: never modifies payloads or retries requests.
export function attachFrameDebugger(ws,{onError=()=>{},now=Date.now}={}){
 if(attached.has(ws))return attached.get(ws);
 const frames=[],connectionId=randomUUID();let sequence=0;
 const record=(direction,data)=>{try{
  let parsed;try{parsed=JSON.parse(typeof data==='string'?data:data.toString());}catch{parsed={unparsed:true};}
  let payload=redact(parsed);if(JSON.stringify(payload).length>12000)payload={omitted:'Frame exceeds diagnostic size limit',msg_type:parsed.msg_type,req_id:parsed.req_id};
  const frame={direction,timestamp:now(),sequence:++sequence,msg_type:parsed.msg_type??(parsed.proposal?'proposal':parsed.buy?'buy':Object.keys(parsed)[0]??'unknown'),payload};
  frames.push(frame);if(frames.length>30)frames.shift();
  if(direction==='INCOMING'&&parsed.error)try{onError({connectionId,frames:structuredClone(frames)});}catch{/* Logging must not interrupt execution. */}
 }catch{/* Malformed diagnostic input must not affect transport. */}};
 const originalSend=ws.send;
 ws.send=function(...args){record('OUTGOING',args[0]);return originalSend.apply(this,args);};
 const listener=event=>record('INCOMING',event?.data??event);
 if(typeof ws.addEventListener==='function')ws.addEventListener('message',listener);
 else if(typeof ws.on==='function')ws.on('message',listener);
 const handle={snapshot:()=>({connectionId,frames:structuredClone(frames)})};attached.set(ws,handle);return handle;
}
