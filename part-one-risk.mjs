// Part One demo-only, server-owned risk ledger. No account credentials stored.
import {existsSync,readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
export const DEMO_RISK_DEFAULTS=Object.freeze({maxStake:5000,maxSessionLoss:5000,maxTrades:5000,maxConsecutiveLosses:0,cooldownTicks:5});
export class RiskRejection extends Error { constructor(code,message){super(message);this.code=code;} }
const reject=(code,message)=>{throw new RiskRejection(code,message);};
export class DemoRiskLedger {
  constructor({file=null}={}){this.file=file;this.accounts={};if(file&&existsSync(file)){this.accounts=JSON.parse(readFileSync(file,'utf8'));if(!this.accounts||Array.isArray(this.accounts)||typeof this.accounts!=='object')throw Error('Invalid Part One risk ledger');}}
  key(accountId){return createHash('sha256').update(String(accountId)).digest('hex');}
  save(){if(this.file){mkdirSync(dirname(this.file),{recursive:true});writeFileSync(this.file+'.tmp',JSON.stringify(this.accounts));renameSync(this.file+'.tmp',this.file);}}
  state(accountId){const key=this.key(accountId);return this.accounts[key]??={limits:{...DEMO_RISK_DEFAULTS},trades:0,grossLoss:0,consecutiveLosses:0,pending:null,cooldown:null,epochs:{}};}
  configure(accountId,requested={}){
    const s=this.state(accountId);
    for(const key of Object.keys(DEMO_RISK_DEFAULTS))if(requested[key]!==undefined){
      const v=requested[key];if(typeof v!=='number'||!Number.isFinite(v)||v<0||(!['maxStake','maxSessionLoss'].includes(key)&&!Number.isInteger(v))||(['maxStake','maxSessionLoss','maxTrades'].includes(key)&&v<=0)||v>(key==='cooldownTicks'?30:5000))reject('CONFIG','Invalid demo risk setting: '+key);
    }
    // Limits can tighten, not silently reset or loosen when another tab logs in.
    for(const [key,value] of Object.entries(requested))if(key in DEMO_RISK_DEFAULTS){
      if(key==='cooldownTicks')s.limits[key]=value;
      else if(key==='maxConsecutiveLosses')s.limits[key]=s.limits[key]===0?value:value===0?s.limits[key]:Math.min(s.limits[key],value);
      else s.limits[key]=Math.min(s.limits[key],value);
    }
    this.save();return this.status(accountId);
  }
  status(accountId){return structuredClone(this.state(accountId));}
  check(accountId,{stake,mode='manual'}){
    const s=this.state(accountId),c=s.limits;
    if(!['manual','auto'].includes(mode))reject('MODE','Invalid execution mode');
    if(typeof stake!=='number'||!Number.isFinite(stake)||stake<.01||stake>c.maxStake)reject('STAKE','Stake exceeds the server demo limit or is invalid');
    if(s.pending)reject('PENDING','An order is pending or its outcome is unresolved');
    if(s.trades>=c.maxTrades)reject('TRADES','Maximum demo session trades reached');
    if(s.grossLoss+stake>c.maxSessionLoss+1e-9)reject('LOSS','Stake would exceed remaining demo session loss allowance');
    if(c.maxConsecutiveLosses>0&&s.consecutiveLosses>=c.maxConsecutiveLosses)reject('STREAK','Maximum consecutive losses reached');
    if(mode==='auto'&&s.cooldown?.remaining>0)reject('COOLDOWN',`Server Auto cooldown: ${s.cooldown.remaining} ticks remaining on ${s.cooldown.symbol}`);
  }
  reserve(accountId,request){this.check(accountId,request);const s=this.state(accountId),id=randomUUID();s.pending={id,attemptId:request.attemptId??null,stake:request.stake,mode:request.mode??'manual',symbol:request.symbol,accepted:false,uncertain:false};this.save();return id;}
  accepted(accountId,id){const s=this.state(accountId);if(s.pending?.id!==id)return;if(!s.pending.accepted){s.pending.accepted=true;s.trades++;this.save();}}
  uncertain(accountId,id){const s=this.state(accountId);if(s.pending?.id===id){s.pending.uncertain=true;this.save();}}
  rejected(accountId,id,error){const s=this.state(accountId);if(s.pending?.id!==id)return;if(error.orderNotSubmitted===true&&!s.pending.accepted){s.pending=null;this.save();}else this.uncertain(accountId,id);}
  settle(accountId,id,result){
    const s=this.state(accountId);if(s.pending?.id!==id)return;
    const profit=Number(result.profit);if(result.profit==null||!Number.isFinite(profit)||!['won','lost','sold'].includes(result.status)){this.uncertain(accountId,id);return;}
    this.accepted(accountId,id);s.grossLoss+=Math.max(0,-profit);s.consecutiveLosses=profit<0?s.consecutiveLosses+1:0;
    if(s.pending.mode==='auto')s.cooldown={symbol:s.pending.symbol,remaining:s.limits.cooldownTicks};
    s.pending=null;this.save();
  }
  tick(accountId,{symbol,epoch,quote,pip_size}){
    if(!/^[A-Za-z0-9_]{2,30}$/.test(symbol??'')||!Number.isFinite(epoch)||typeof quote!=='number'||!Number.isFinite(quote)||quote<0||!Number.isInteger(pip_size)||pip_size<0||pip_size>10)return;
    const s=this.state(accountId);if(epoch<=(s.epochs[symbol]??-Infinity))return;s.epochs[symbol]=epoch;
    if(s.cooldown?.symbol===symbol&&s.cooldown.remaining>0){s.cooldown.remaining--;this.save();}
  }
}
// Reservation happens synchronously before any proposal/buy operation or network await.
export async function guardedDemoOrder(ledger,accountId,request,place){
  ledger.configure(accountId,request.riskLimits);const reservation=ledger.reserve(accountId,request);
  try {
    const flow=await place();
    const settlement=flow.settlement.then(result=>{ledger.settle(accountId,reservation,result);return result;},error=>{ledger.rejected(accountId,reservation,error);throw error;});settlement.catch(()=>{});
    const entry=flow.entry.then(result=>{ledger.accepted(accountId,reservation);return result;},error=>{ledger.rejected(accountId,reservation,error);throw error;});entry.catch(()=>{});
    return {entry,settlement};
  }catch(error){ledger.rejected(accountId,reservation,error);throw error;}
}
