import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {RpcSocket} from '../rise-fall-transport.mjs';
import {availableContracts} from '../public/rise-fall/contracts.js';
import {existsSync} from 'node:fs';
const ws=new WebSocket('wss://api.derivws.com/trading/v1/options/ws/public');
await new Promise((resolve,reject)=>{const t=setTimeout(()=>{ws.close();reject(Error('Public connection timeout'));},15000);ws.onopen=()=>{clearTimeout(t);resolve();};ws.onerror=()=>{clearTimeout(t);reject(Error('Public connection failed'));};});
const rpc=new RpcSocket(ws);await mkdir('outputs/rise-fall',{recursive:true});
const symbols=JSON.parse(await readFile('outputs/rise-fall-market-audit.json','utf8')).rows.filter(r=>r.contracts.length).map(r=>r.symbol);
try{for(const symbol of symbols){if(process.argv.includes('--missing')&&existsSync(`outputs/rise-fall/${symbol}.json`))continue;try{let end='latest',ticks=[];for(let page=0;page<5;page++){await new Promise(r=>setTimeout(r,750));const data=await rpc.request({ticks_history:symbol,count:1000,end,style:'ticks'});const batch=data.history.prices.map((quote,i)=>({quote:Number(quote),epoch:data.history.times[i],symbol}));if(!batch.length)break;ticks=[...batch,...ticks];end=batch[0].epoch-1;}const meta=await rpc.request({contracts_for:symbol});const recording={source:'Deriv public ticks_history',capturedAt:new Date().toISOString(),symbol,rawContracts:meta.contracts_for,contracts:availableContracts(meta.contracts_for,symbol),ticks:[...new Map(ticks.map(t=>[t.epoch,t])).values()].sort((a,b)=>a.epoch-b.epoch)};await writeFile(`outputs/rise-fall/${symbol}.json`,JSON.stringify(recording));console.log(symbol,recording.ticks.length,'ticks');}catch(e){console.log(symbol,'UNAVAILABLE',e.message);}}}finally{rpc.close();}
