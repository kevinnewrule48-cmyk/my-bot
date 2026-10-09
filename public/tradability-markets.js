import {EnvironmentBook} from './edge-environment.js';
import {TradabilityEngine} from './tradability-engine.js';
import {extractLastDigit} from './digit-barrier-engine.js';
export const TRADABILITY_MARKETS=['R_10','R_25','R_50','R_75','R_100'];
// Analysis owns its subscription, independently of execution mode/market.
export class TradabilityMarkets {
 constructor({Socket=globalThis.WebSocket,onChange=()=>{},onEvent=()=>{},onTick=()=>{},setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id)}={}){
  this.environment=new EnvironmentBook();Object.assign(this,{Socket,onChange,onTick,setTimer,clearTimer});this.engines=new Map(TRADABILITY_MARKETS.map(symbol=>{const engine=new TradabilityEngine({},onEvent);engine.reset(symbol);return [symbol,engine];}));this.connection='STOPPED';this.errors=new Map();this.closed=true;
 }
 engine(symbol){return this.engines.get(symbol);}
 selectWindow(size){for(const engine of this.engines.values())engine.selectWindow(size);this.onChange();}
 snapshots(){return [...this.engines].map(([symbol,engine])=>({symbol,...(engine.snapshot??engine.build(false))}));}
 start(){if(!this.closed)return;this.closed=false;this.connect();}
 stop(){this.closed=true;this.clearTimer(this.timer);this.socket?.close();this.connection='STOPPED';}
 connect(){
  if(this.closed)return;this.connection='CONNECTING';
  const socket=this.socket=new this.Socket('wss://api.derivws.com/trading/v1/options/ws/public');
  socket.onopen=()=>{if(this.socket!==socket||this.closed)return;this.connection='LIVE';for(const symbol of TRADABILITY_MARKETS)socket.send(JSON.stringify({ticks_history:symbol,count:1000,end:'latest',style:'ticks',subscribe:1}));this.onChange();};
  socket.onmessage=event=>{
   if(this.socket!==socket||this.closed)return;
   let data;try{data=JSON.parse(event.data);}catch{return;}
   const symbol=data.tick?.symbol??data.echo_req?.ticks_history,engine=this.engine(symbol);if(!engine)return;
   if(data.error){this.connection='FEED ERROR';this.errors.set(symbol,data.error.message??'Subscription failed');this.onChange();return;}
   if(data.history){const precision=data.pip_size??data.history.pip_size;for(let i=0;i<data.history.prices.length;i++)this.push(symbol,data.history.prices[i],data.history.times[i],precision,true);}
   if(data.tick)this.push(symbol,data.tick.quote,data.tick.epoch,data.tick.pip_size);
   this.onChange();
  };
  socket.onerror=()=>socket.close();
  socket.onclose=()=>{if(this.socket!==socket||this.closed)return;this.connection='RECONNECTING';this.onChange();this.timer=this.setTimer(()=>this.connect(),2000);};
 }
 push(symbol,quote,epoch,precision,historical=false){const engine=this.engine(symbol);if(!engine)return;try{const {digit}=extractLastDigit(quote,precision);const result=engine.push({symbol,digit,epoch});if(result.accepted){this.environment.push({market:symbol,digit,epoch,price:Number(quote),historical});this.errors.delete(symbol);this.onTick({market:symbol,symbol,digit,epoch,time:epoch,price:Number(quote).toFixed(precision),historical});}}catch{/* Await a quote with verified decimal precision. */}}
}
