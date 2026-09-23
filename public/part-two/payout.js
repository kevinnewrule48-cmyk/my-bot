import {wins} from './engine.js';
export const QUOTE_MAX_AGE_MS=10000;
export function proposalRequest({symbol,type,barrier,stake}) {
  wins(type,barrier,0);
  if(typeof symbol!=='string'||!symbol||!Number.isFinite(stake)||stake<=0)throw Error('Choose a market and a positive stake.');
  return {proposal:1,amount:stake,basis:'stake',contract_type:type==='OVER'?'DIGITOVER':'DIGITUNDER',currency:'USD',duration:1,duration_unit:'t',barrier:String(barrier),underlying_symbol:symbol,req_id:1};
}
export function parseProposal(data,parameters,receivedAt=Date.now()) {
  const p=data?.proposal;
  if(data?.error)throw Error(data.error.message||'Proposal rejected');
  if(!p?.id||p.ask_price==null||p.payout==null||p.ask_price===''||p.payout==='')throw Error('Deriv returned incomplete pricing.');
  const ask=Number(p.ask_price),payout=Number(p.payout);
  if(!Number.isFinite(ask)||!Number.isFinite(payout)||ask<=0||payout<=ask)throw Error('Invalid payout quote');
  return {...parameters,id:p.id,ask,payout,profit:payout-ask,breakEven:ask/payout,receivedAt,currency:'USD',duration:1};
}
export function evaluatePayout(quote,parameters,probability,margin=.02,now=Date.now()) {
  const matches=quote&&['symbol','type','barrier','stake'].every(k=>quote[k]===parameters[k]);
  const fresh=Boolean(matches&&now>=quote.receivedAt&&now-quote.receivedAt<=QUOTE_MAX_AGE_MS);
  const validProbability=Number.isFinite(probability)&&probability>=0&&probability<=1;
  if(!Number.isFinite(margin)||margin<0||margin>1)throw Error('Invalid safety margin');
  return {fresh,estimatedEV:fresh&&validProbability?probability*quote.payout-quote.ask:null,
    passesEstimate:Boolean(fresh&&validProbability&&probability>quote.breakEven+margin),
    executable:false,reason:!fresh?'Quote missing, stale or for different parameters.':'Research estimate only: independent probability validation is still required.'};
}
export function requestProposal(parameters) {
  const request=proposalRequest(parameters);
  return new Promise((resolve,reject)=>{
    const socket=new WebSocket('wss://api.derivws.com/trading/v1/options/ws/public');
    let finished=false;
    const finish=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);socket.close();error?reject(error):resolve(value);};
    const timer=setTimeout(()=>finish(Error('Pricing request timed out.')),10000);
    socket.onopen=()=>socket.send(JSON.stringify(request));
    socket.onmessage=e=>{try{const data=JSON.parse(e.data);if(data.req_id!==1)return;finish(null,parseProposal(data,parameters));}catch(error){finish(error);}};
    socket.onerror=()=>finish(Error('Pricing connection failed.'));
    socket.onclose=()=>finish(Error('Pricing connection closed.'));
  });
}
