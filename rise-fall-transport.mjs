// Authenticated sockets use the existing OAuth/OTP connection factory.
export class RpcSocket{
 constructor(ws){this.ws=ws;this.next=0;this.pending=new Map();this.listeners=new Set();this.closed=false;
  ws.addEventListener('message',e=>{let d;try{d=JSON.parse(e.data);}catch{return;}const p=this.pending.get(d.req_id);if(p){clearTimeout(p.timer);this.pending.delete(d.req_id);d.error?p.reject(Error(d.error.message)):p.resolve(d);}for(const fn of this.listeners)fn(d);});
  const close=()=>{if(this.closed)return;this.closed=true;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('Deriv connection closed'));}this.pending.clear();for(const fn of this.listeners)fn({disconnected:true});};ws.addEventListener('close',close);ws.addEventListener('error',close);
 }
 request(payload,timeout=10000){if(this.closed||this.ws.readyState!==1)return Promise.reject(Error('Deriv connection unavailable'));return new Promise((resolve,reject)=>{const req_id=++this.next,timer=setTimeout(()=>{this.pending.delete(req_id);reject(Error('Deriv response timeout'));},timeout);this.pending.set(req_id,{resolve,reject,timer});try{this.ws.send(JSON.stringify({...payload,req_id}));}catch(e){clearTimeout(timer);this.pending.delete(req_id);reject(e);}});}
 close(){this.ws.close();}
}
