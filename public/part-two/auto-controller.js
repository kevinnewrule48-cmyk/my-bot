// Lifecycle only; this does not approve or calibrate a trading strategy.
export class AutoController {
  constructor(){this.stop();this.remaining=0;this.lastSequence=null;this.inFlight=false;}
  start(){this.armed=true;}
  stop(){this.armed=false;}
  tick(sequence){
    if(!Number.isInteger(sequence)||sequence<0)return;
    if(this.lastSequence!==null&&sequence>this.lastSequence)this.remaining=Math.max(0,this.remaining-(sequence-this.lastSequence));
    this.lastSequence=sequence;
  }
  accepted(){this.inFlight=true;}
  settled(ticks){this.inFlight=false;this.remaining=Math.max(0,Math.floor(Number(ticks)||0));}
  ready({live,connected,checks,validated}){
    return this.armed&&!this.inFlight&&this.remaining===0&&live&&connected&&validated===true&&Array.isArray(checks)&&checks.length>0&&checks.every(c=>c.pass===true);
  }
  get label(){return !this.armed?'AUTO OFF':this.inFlight?'AUTO · ORDER PENDING':this.remaining?`AUTO · COOLDOWN ${this.remaining} TICKS`:'AUTO · WAITING FOR CHECKS';}
}
