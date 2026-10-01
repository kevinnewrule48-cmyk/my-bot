import {writeFileSync} from 'node:fs';
import {RpcSocket} from '../rise-fall-transport.mjs';
import {availableContracts} from '../public/rise-fall/contracts.js';
const ws=new WebSocket('wss://api.derivws.com/trading/v1/options/ws/public');
await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve);ws.addEventListener('error',reject);});
const rpc=new RpcSocket(ws),rows=[];
try{
 const d=await rpc.request({active_symbols:'brief'});
 for(const m of d.active_symbols){
  const symbol=m.underlying_symbol??m.symbol;
  const data=await rpc.request({contracts_for:symbol});
  const contracts=availableContracts(data.contracts_for,symbol);
  rows.push({symbol,name:m.underlying_symbol_name??m.display_name,contracts:contracts.map(c=>({type:c.contract_type,min:c.min_contract_duration,max:c.max_contract_duration})),rawCallPut:(data.contracts_for?.available??[]).filter(c=>['CALL','PUT'].includes(c.contract_type))});
 }
 writeFileSync('outputs/rise-fall-market-audit.json',JSON.stringify({checkedAt:new Date().toISOString(),rows},null,2));
 console.log(JSON.stringify(rows.map(({rawCallPut,...r})=>r),null,2));
}finally{rpc.close();}
