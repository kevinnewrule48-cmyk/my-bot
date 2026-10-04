// Research only: advances on accepted live observations, never on dashboard polls.
export const V2_VERSION='balanced-adaptive-v2';
export const V2_POLICY=Object.freeze({directionBlocks:2,readyObservations:2});
const clone=x=>JSON.parse(JSON.stringify(x));
export class TrendConfirmation {
 constructor(config,policy=V2_POLICY){this.config=config;this.policy={...policy};this.revision=0;this.armed=false;this.reset('Not armed');}
 reset(reason){this.live=0;this.block=[];this.side=null;this.blocks=0;this.readyRun=0;this.confirmed=null;this.candidate=null;this.consumed=null;this.renewal=null;this.resetRun=0;this.state='OBSERVING';this.reason=reason;this.events=[];this.totals={candidates:0,confirmed:0,ready:0,submitted:0,executed:0,states:{},rejections:{}};this.latest=null;this.lastEpoch=null;this.revision++;}
 arm(token){this.reset('OBSERVING — collecting live evidence');this.armed=true;this.token=token;}
 disarm(){this.armed=false;this.invalidate('OBSERVING','Auto stopped; fresh observation required on re-arm');this.revision++;}
 invalidate(state,reason,outcome='CANCELLED'){if(this.candidate){this.events.push({...clone(this.candidate),outcome,reason,endedAt:this.lastEpoch});if(this.events.length>400)this.events.shift();}this.side=null;this.blocks=0;this.readyRun=0;this.confirmed=null;this.candidate=null;this.state=state;this.reason=reason;}
 transition(state,reason){if(this.candidate){const c=this.candidate;c.seconds??={};if(c.lastState)c.seconds[c.lastState]=(c.seconds[c.lastState]??0)+Math.max(0,this.lastEpoch-c.lastObservedAt);c.lastState=state;c.lastObservedAt=this.lastEpoch;}this.state=state;this.reason=reason;this.totals.states[state]=(this.totals.states[state]??0)+1;if(state!=='READY')this.totals.rejections[reason]=(this.totals.rejections[reason]??0)+1;if(this.candidate)this.candidate.observations[state]=(this.candidate.observations[state]??0)+1;}
 metrics(side){return {...side.balanced.metrics,pullback:side.pullback,rawVelocity:(this.latest?.velocity??0)*side.sign};}
 deteriorating(m){const r=this.confirmed??this.candidate?.reference;if(!r)return null;const unit=100/this.config.micro,phase=this.confirmed?'since confirmation':'while forming';
  if(m.pressure<r.pressure-2*unit)return 'pressure deteriorating '+phase;
  if(m.consistency<r.consistency-2*unit)return 'tick consistency deteriorating '+phase;
  if(m.persistence<r.persistence-100/5)return 'persistence deteriorating '+phase;
  if(m.rawVelocity<r.rawVelocity*.65)return 'velocity deteriorating '+phase;
  if(m.acceleration<-.15)return 'momentum weakening';
  return null;
 }
 observe(a,tick,delta){
  if(!this.armed)return;
  if(this.lastEpoch!==null&&(tick.epoch-this.lastEpoch)*1000>this.config.staleMs){const consumed=this.consumed;this.invalidate('OBSERVING','Feed gap; collecting fresh live evidence');this.live=0;this.block=[];this.renewal=null;this.resetRun=0;this.consumed=consumed;}
  if(a.candidates.length&&a.candidates.some(s=>!s.checks.fresh)){this.invalidate('OBSERVING','NO TRADE — stale live observation');this.live=0;this.block=[];this.revision++;return;}
  this.lastEpoch=tick.epoch;this.latest=a;this.live++;this.revision++;
  const blockSize=Math.max(2,Math.floor(this.config.micro/4));this.block.push(delta??0);const blockDone=this.block.length>=blockSize,block=this.block.slice();if(blockDone)this.block=[];
  if(this.live<this.config.micro||!a.candidates.length){this.transition('OBSERVING',`OBSERVING — collecting live evidence ${this.live}/${this.config.micro}`);return;}
  const sides=a.candidates.filter(s=>{const m=s.balanced.metrics;return m.pressure>50&&m.shortPressure>50&&m.velocity>0;});
  const best=sides.length===1?sides[0]:null,m=best?this.metrics(best):null;
  if(this.consumed){const old=a.candidates.find(s=>s.type===this.consumed.type),om=this.metrics(old),last=a.windows[this.config.micro].changes.slice(-blockSize),net=last.reduce((x,y)=>x+old.sign*y,0);
   const reset=net<=0||(om.pressure<=this.consumed.metrics.pressure-10&&om.rawVelocity<=this.consumed.metrics.rawVelocity*.75);
   this.resetRun=reset?this.resetRun+1:0;
   if(this.resetRun>=this.policy.readyObservations){this.renewal={type:old.type,pressure:om.pressure,velocity:om.rawVelocity};this.consumed=null;this.invalidate('OBSERVING','Prior entry ended; waiting for renewed directional evidence');this.block=[];}
   this.transition('OBSERVING',this.consumed?'Waiting for a NEW entry event; persistent READY is already consumed':'Prior entry ended; waiting for renewed directional evidence');return;
  }
  if(!best){const state=this.side?'WEAKENING':a.chop>=65?'CHOPPY':'NO DIRECTION';const immediate=a.candidates.find(s=>s.balanced.metrics.pressure>50&&s.balanced.metrics.velocity>0);this.invalidate(state,'NO TRADE — '+(immediate&&immediate.balanced.metrics.shortPressure<=50?'conflicting short-window pressure':'direction not established'));this.transition(state,this.reason);return;}
  const unsafe=!best.checks.severeChop?'CHOPPY':!best.checks.reversal?'REVERSAL RISK':!best.checks.exhaustion?'WEAKENING':null;
  if(unsafe){this.invalidate(unsafe,`NO TRADE — ${unsafe==='WEAKENING'?'exhausted movement':unsafe.toLowerCase()}`);this.transition(unsafe,this.reason);return;}
  const deteriorating=this.deteriorating(m);
  if(this.side&&this.side!==best.type||deteriorating){this.invalidate('WEAKENING','NO TRADE — '+(deteriorating??'direction reversed during confirmation'));this.block=[];this.transition('WEAKENING',this.reason);return;}
  if(this.renewal&&best.type===this.renewal.type&&!(m.pressure>=this.renewal.pressure+5&&m.rawVelocity>this.renewal.velocity)) {this.transition('OBSERVING','NO TRADE — renewed pressure and velocity not established');return;}
  if(!this.side){this.side=best.type;this.blocks=0;this.block=[];this.candidate={id:++this.totals.candidates,type:best.type,startedAt:tick.epoch,reference:clone(m),observations:{},confirmedAt:null,readyAt:null};this.renewal=null;this.transition(best.name+' FORMING',`NO TRADE — ${best.name.toLowerCase()} forming, confirmation 0/${this.policy.directionBlocks} independent blocks`);return;}
  if(!this.confirmed){
   if(blockDone){const support=block.reduce((x,y)=>x+best.sign*y,0)>0&&block.filter(d=>d*best.sign>0).length>block.length/2;this.blocks=support?this.blocks+1:0;if(!support){this.invalidate('WEAKENING','NO TRADE — new observation block did not sustain direction');this.transition('WEAKENING',this.reason);return;}}
   if(this.blocks>=this.policy.directionBlocks){this.confirmed=clone(m);this.candidate.confirmedAt=tick.epoch;this.totals.confirmed++;this.transition(best.name+' CONFIRMED','Direction confirmed; entry quality must now persist');return;}
   this.transition(best.name+' FORMING',`NO TRADE — ${best.name.toLowerCase()} forming, confirmation ${this.blocks}/${this.policy.directionBlocks} independent blocks`);return;
  }
  const recent=a.windows[this.config.micro].changes.slice(-blockSize),healthy=recent.reduce((x,y)=>x+y*best.sign,0)>0&&recent.filter(d=>d*best.sign>0).length>recent.length/2;
  const entry=best.ready&&m.shortPressure>50&&m.pullback<=35&&healthy;
  if(!entry){this.readyRun=0;this.transition('ENTRY BUILDING','NO TRADE — '+(!healthy?'newest tick structure lacks continuation':m.pullback>35?'pullback exceeds 35%':best.blocked.join(', ')||'entry quality insufficient'));return;}
  this.readyRun++;
  if(this.readyRun<this.policy.readyObservations){this.transition('ENTRY BUILDING',`NO TRADE — entry confirmation ${this.readyRun}/${this.policy.readyObservations} new observations`);return;}
  if(this.candidate.readyAt===null){this.candidate.readyAt=tick.epoch;this.totals.ready++;}
  this.transition('READY',best.name+' READY — confirmed direction and persistent healthy entry');
 }
 consume(signalId){if(this.state!=='READY'||!this.latest||signalId!==`${this.token}:${this.candidate?.id}:${this.side}`)return false;const side=this.latest.candidates.find(s=>s.type===this.side);this.consumed={type:this.side,metrics:this.metrics(side),signalId};this.totals.submitted++;Object.assign(this.candidate,{signalId,entryMetrics:this.metrics(side)});this.invalidate('OBSERVING','Waiting for a NEW entry event','SUBMITTED');this.revision++;return true;}
 confirmExecution(signalId){if(this.lastConfirmedSignal===signalId)return;this.lastConfirmedSignal=signalId;this.totals.executed++;const event=this.events.find(e=>e.signalId===signalId);if(event)event.outcome='EXECUTED';this.revision++;}
 project(a,now,lastEpoch){
  const fresh=Number.isFinite(lastEpoch)&&now-lastEpoch*1000<=this.config.staleMs&&now-lastEpoch*1000>=-2000;
  const state=!this.armed?'OBSERVING':!fresh?'OBSERVING':this.state,reason=!this.armed?'OBSERVING — arm V2 to collect new live evidence':!fresh?'NO TRADE — stale market feed; confirmation unavailable':this.reason;
  const progress={version:V2_VERSION,armed:this.armed,state,reason,liveObservations:this.live,requiredObservations:this.config.micro,directionBlocks:this.blocks,requiredBlocks:this.policy.directionBlocks,blockSize:Math.max(2,Math.floor(this.config.micro/4)),readyObservations:this.readyRun,requiredReady:this.policy.readyObservations,direction:this.side=== 'CALL'?'RISE':this.side==='PUT'?'FALL':'NEUTRAL',candidate:this.candidate?clone(this.candidate):null,totals:clone(this.totals),consumed:!!this.consumed};
  const candidates=a.candidates.map(s=>{const selected=s.type===this.side,checks={...s.checks,observation:this.armed&&this.live>=this.config.micro,fresh,shortAgreement:s.balanced.metrics.shortPressure>50,trendConfirmation:selected&&!!this.confirmed,entryPersistence:selected&&state==='READY'&&this.readyRun>=this.policy.readyObservations,newEntry:!this.consumed};const ready=Object.values(checks).every(Boolean);return {...s,checks,blocked:Object.entries(checks).filter(([,pass])=>!pass).map(([k])=>k),ready,confirmation:progress,balanced:{...s.balanced,state:selected?state:'NO DIRECTION',metrics:{...s.balanced.metrics,regime:selected?state:'NO DIRECTION',pullback:s.pullback,rawVelocity:a.velocity*s.sign,finalState:selected?state:'NO DIRECTION',entryTiming:ready?'OPEN':'CLOSED',entryQuality:ready?'QUALIFIED':selected&&this.confirmed?'BUILDING':'NOT CONFIRMED',confirmationProgress:`${this.blocks}/${this.policy.directionBlocks} blocks; ${this.readyRun}/${this.policy.readyObservations} entry observations`}}};});
  const winner=candidates.find(s=>s.ready)??null;
  return {...a,candidates,winner,state:winner?winner.name+' READY':state,marketState:this.confirmed&&this.side?(this.side==='CALL'?'RISE CONFIRMED':'FALL CONFIRMED'):state,reason,confirmation:progress,signalId:winner?`${this.token}:${this.candidate.id}:${winner.type}`:null};
 }
}
