import {TradabilityEngine,tradabilityBlocks,TRADABILITY_DEFAULTS} from './public/tradability-engine.js';
import {extractLastDigit} from './public/digit-barrier-engine.js';
export class TradabilityAuthority{
 constructor({now=Date.now,log=()=>{}}={}){this.now=now;this.log=log;this.accounts=new Map();}
 watch(accountId,symbol){let markets=this.accounts.get(accountId);if(!markets){markets=new Map();this.accounts.set(accountId,markets);}let value=markets.get(symbol);if(!value){value={symbol,engine:new TradabilityEngine({},event=>this.log({component:'tradability',...event})),receivedAt:0};value.engine.reset(symbol);markets.set(symbol,value);}return value;}
 tick(accountId,tick){const value=this.accounts.get(accountId)?.get(tick.symbol);if(!value)return;try{const {digit}=extractLastDigit(tick.quote,tick.pip_size);if(value.engine.push({digit,epoch:tick.epoch,id:tick.id,symbol:tick.symbol}).accepted)value.receivedAt=this.now();}catch{value.engine.reset(value.symbol,'invalid quote');value.receivedAt=0;}}
 disconnect(accountId){this.accounts.delete(accountId);}
 configure(session,{mode,windowSize,accountId,symbol,revision}){
  if(!['monitor','auto-block'].includes(mode)||!TRADABILITY_DEFAULTS.windows.includes(windowSize)||!Number.isSafeInteger(revision))throw Error('Invalid tradability settings');
  if(revision<=(session.tradabilityControl?.revision??-1))throw Error('Superseded tradability settings');
  session.tradabilityControl={mode,windowSize,accountId,symbol,revision};if(mode==='auto-block')this.watch(accountId,symbol);
 }
 status(session,accountId,symbol,requestedMode='monitor'){
  if(session.tradabilityPending)return {allowed:false,mode:'auto-block',state:'COLLECTING DATA',reason:'Tradability configuration pending or failed; retry settings'};
  const c=session.tradabilityControl;
  if(c?.mode!=='auto-block'&&requestedMode!=='auto-block')return {allowed:true,mode:'monitor',reason:'MONITOR ONLY'};
  const value=this.accounts.get(accountId)?.get(symbol),snapshot=value?.engine.snapshot?.windows.find(w=>w.windowSize===c?.windowSize);
  if(!c||c.mode!=='auto-block'||c.accountId!==accountId||c.symbol!==symbol||value?.symbol!==symbol||!snapshot||this.now()-value.receivedAt>5000)return {allowed:false,mode:'auto-block',state:'COLLECTING DATA',sample:snapshot?.sample??0,windowSize:c?.windowSize??500,reason:'Server guard waiting for current, verified ticks and matching settings'};
  const blocked=tradabilityBlocks(snapshot,'auto-block');return {allowed:!blocked,mode:'auto-block',state:snapshot.state,sample:snapshot.sample,windowSize:c.windowSize,chaos:snapshot.chaos,reason:blocked?snapshot.reasons.join(' '):'Server tradability rules satisfied'};
 }
}
