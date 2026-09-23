import {precisionFromPip} from './engine.js';
export class DerivFeed {
  constructor(onTick,onStatus) {this.onTick=onTick;this.onStatus=onStatus;this.generation=0;}
  stop() {this.generation++;clearTimeout(this.timer);this.socket?.close();this.socket=null;this.onStatus('STOPPED');}
  start(symbol,onReady) {
    this.stop();const generation=this.generation;
    const socket=new WebSocket('wss://api.derivws.com/trading/v1/options/ws/public');this.socket=socket;
    const current=()=>generation===this.generation;
    const fail=message=>{if(!current())return;this.stop();this.onStatus(message);};
    const watchdog=()=>{clearTimeout(this.timer);this.timer=setTimeout(()=>fail('STALE FEED — reconnect to continue'),20000);};
    this.onStatus('CONNECTING');watchdog();
    socket.onopen=()=>{if(current())socket.send(JSON.stringify({active_symbols:'brief',req_id:1}));};
    socket.onmessage=async event=>{
      if(!current())return;
      try {
        const data=JSON.parse(event.data);
        if(data.error)return fail(`FEED ERROR: ${data.error.message}`);
        if(data.active_symbols) {
          const market=data.active_symbols.find(m=>(m.underlying_symbol??m.symbol)===symbol);
          if(!market || market.is_trading_suspended || !market.exchange_is_open)return fail('MARKET UNAVAILABLE');
          const precision=precisionFromPip(market.pip_size??market.pip);
          await onReady(precision);if(current())socket.send(JSON.stringify({ticks:symbol,subscribe:1,req_id:2}));
        }
        if(data.tick) {watchdog();this.onStatus('LIVE');this.onTick(data.tick);}
      }catch(error){fail(`DATA ERROR: ${error.message}`);}
    };
    socket.onerror=()=>fail('CONNECTION ERROR — reconnect to continue');
    socket.onclose=()=>{if(current()){clearTimeout(this.timer);this.onStatus('DISCONNECTED');}};
  }
}
