import {writeFileSync} from 'node:fs';
const ws=new WebSocket('wss://api.derivws.com/trading/v1/options/ws/public'),messages=[];
const timer=setTimeout(()=>{writeFileSync('../../outputs/balance-public-feed.json',JSON.stringify(messages,null,2));ws.close();console.log(JSON.stringify(messages.map(x=>({type:x.msg_type,error:x.error,prices:x.history?.prices?.length,pip:x.pip_size}))));},12000);
ws.onopen=()=>{for(const symbol of ['R_10','R_25','R_50','R_75','R_100'])ws.send(JSON.stringify({ticks_history:symbol,count:1000,end:'latest',style:'ticks',subscribe:1}));};
ws.onmessage=e=>messages.push(JSON.parse(e.data));ws.onerror=e=>console.log('public feed connection error');
