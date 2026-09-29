// Independent tick-driven analysis; never rounds a percentage into qualification.
export class DifferEngine {
  constructor(){this.armed=false;this.context=null;this.sequence=-1;this.candidate=null;this.signal=null;this.status='DISARMED';this.executionLock=false;this.contractId=null;this.settlement=null;this.cooldown=0;this.logs=[];this.attemptId=null;}
  record(status,detail={}){this.status=status;this.logs.push({status,sequence:this.sequence,...detail});if(this.logs.length>250)this.logs.shift();}
  arm(value){this.armed=!!value;this.candidate=null;this.signal=null;this.record(value?'WATCHING':'DISARMED');}
  tick(history,{context,sequence,running,cooldownTicks=0}){
    if(context!==this.context){this.context=context;this.sequence=-1;this.lastEpoch=null;this.candidate=null;this.signal=null;}
    if(sequence<=this.sequence)return null;
    const epoch=history.at(-1)?.time;
    if(Number.isFinite(epoch)&&this.lastEpoch!==null&&epoch<=this.lastEpoch)return null;
    if(Number.isFinite(epoch))this.lastEpoch=epoch;
    this.sequence=sequence;this.signal=null;
    if(this.cooldown>0)this.cooldown--;
    const observedDigit=history.at(-1)?.digit;
    this.observation={digit:observedDigit,count:history.filter(t=>t.digit===observedDigit).length,sample:history.length,sequence};
    if(!this.armed||!running){this.candidate=null;this.record(this.armed?'AUTOBOT OFF':'DISARMED');return null;}
    const digit=history.at(-1)?.digit;
    if(!Number.isInteger(digit)||digit<0||digit>9)return null;
    if(this.executionLock){this.record('CONTRACT OPEN');return null;}
    if(this.cooldown>0){this.record('COOLDOWN',{remaining:this.cooldown});return null;}
    if(this.candidate!==null){
      if(digit===this.candidate.digit){this.record('WAITING FOR JUMP');return null;}
      const candidate=this.candidate;this.candidate=null;
      this.signal={strategy:'DIFFER',type:'DIGITDIFF',barrier:candidate.digit,sequence,context,qualifiedSequence:candidate.sequence,count:candidate.count,sample:candidate.sample,cooldownTicks};
      this.record('DIFFER ENTRY',this.signal);return this.signal;
    }
    const n=history.length,count=history.filter(t=>t.digit===digit).length;
    if(n>0&&count*100===n){this.record('1.0% DETECTED',{digit,count,sample:n});this.candidate={digit,sequence,count,sample:n};this.record('WAITING FOR JUMP',{digit});}
    else this.record('WATCHING',{digit,count,sample:n});
    return null;
  }
  pending(attemptId){this.executionLock=true;this.attemptId=attemptId;this.contractId=null;this.pendingCooldown=this.signal?.cooldownTicks??0;this.record('PURCHASE REQUEST');}
  observe(receipt){
    if(receipt?.strategy!=='DIFFER'||receipt.attemptId!==this.attemptId)return false;
    if(this.contractId&&String(this.contractId)!==String(receipt.contractId))return false;
    if(receipt.contractId)this.contractId=receipt.contractId;
    if(receipt.state==='settled'){
      if(this.settlement?.contractId===receipt.contractId)return false;
      this.settlement=receipt;this.executionLock=false;this.cooldown=this.pendingCooldown;
      this.record(receipt.status==='won'?'WIN':'LOSS');
    }else if(receipt.state==='rejected'){this.executionLock=false;this.record('REJECTED');}
    else this.record(receipt.state==='unresolved'?'RECONCILIATION REQUIRED':'CONTRACT OPEN');
    return true;
  }
}
