import {RiseFallEngine} from './engine.js';
import {availableContracts,supports} from './contracts.js';

export function rankMarkets(rows,config,duration,unit,now=Date.now()) {
 return rows.map(row=>{
  const analysis=row.engine?.snapshot(now);
  const candidates=(analysis?.candidates??[]).filter(c=>c.ready&&supports(row.contracts,c.type,duration,unit));
  const candidate=candidates.length===1?candidates[0]:null;
  return {...row,analysis,candidate,available:!!row.contracts?.length,eligible:!!candidate&&!row.error,
   reason:row.error??(!row.contracts?.length?'Rise/Fall unavailable':
    !['CALL','PUT'].some(t=>supports(row.contracts,t,duration,unit))?'Selected duration unavailable':
    analysis?.reason??'Waiting for data')};
 }).sort((a,b)=>Number(b.eligible)-Number(a.eligible)||(b.candidate?.confidence??-1)-(a.candidate?.confidence??-1)||a.name.localeCompare(b.name));
}

// A read-only, paced scan. No account, proposal, purchase or selection operations.
export class MarketScanner {
 constructor({markets,config,onUpdate,WebSocketClass=WebSocket}){Object.assign(this,{markets,config,onUpdate,WebSocketClass});this.rows=new Map();this.pending=new Map();this.id=0;this.token=0;this.offset=0;}
 request(body){return new Promise((resolve,reject)=>{const id=++this.id;const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Market request timed out'));},12000);this.pending.set(id,{resolve,reject,timer});this.ws.send(JSON.stringify({...body,req_id:id}));});}
 stop(){this.token++;clearTimeout(this.timer);this.ws?.close();for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('Scanner stopped'));}this.pending.clear();}
 async start(){this.stop();const token=this.token;this.rows.clear();this.ws=new this.WebSocketClass('wss://api.derivws.com/trading/v1/options/ws/public');
  this.ws.onmessage=e=>{try{const d=JSON.parse(e.data),p=this.pending.get(d.req_id);if(d.tick)this.rows.get(d.tick.symbol)?.engine?.add(d.tick);if(p){clearTimeout(p.timer);this.pending.delete(d.req_id);d.error?p.reject(Error(d.error.message)):p.resolve(d);}}catch{}};
  this.ws.onclose=()=>{if(token===this.token){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('Scanner disconnected'));}this.pending.clear();this.onUpdate('Scanner disconnected; click Refresh scan');}};
  this.ws.onopen=async()=>{try{const t=await this.request({time:1});if(!Number.isFinite(t.time))throw Error('Clock unavailable');this.offset=t.time*1000-Date.now();await this.cycle(token);}catch(e){if(token===this.token)this.onUpdate(e.message);}};
 }
 async cycle(token){for(const m of this.markets){if(token!==this.token)return;const row=this.rows.get(m.symbol)??{symbol:m.symbol,name:m.name,contracts:[]};try{
   if(!row.contractsCheckedAt||Date.now()-row.contractsCheckedAt>600000){const meta=await this.request({contracts_for:m.symbol});row.contracts=availableContracts(meta.contracts_for,m.symbol);row.contractsCheckedAt=Date.now();row.checked=true;}
   if(row.contracts.length&&!row.engine){const h=await this.request({ticks_history:m.symbol,count:1500,end:'latest',style:'ticks'});row.engine=new RiseFallEngine(m.symbol,this.config);(h.history?.prices??[]).forEach((quote,i)=>row.engine.add({quote,epoch:h.history.times[i]}));}
   this.rows.set(m.symbol,row);
   if(row.engine&&!row.subscribed){await this.request({ticks:m.symbol,subscribe:1});row.subscribed=true;}
   row.error=null;
  }catch(e){row.error=e.message;}if(token!==this.token)return;this.rows.set(m.symbol,row);this.onUpdate(`Checked ${this.rows.size}/${this.markets.length} markets · updates continuously`);
  await new Promise(r=>setTimeout(r,750));
 }if(token===this.token)this.timer=setTimeout(()=>this.cycle(token),5000);}
}
