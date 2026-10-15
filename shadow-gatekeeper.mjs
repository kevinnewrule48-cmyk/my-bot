// Research-only observer. Never imported by execution or candidate authorization.
import {opportunityMetrics} from './public/opportunity-metrics.js';
export const SHADOW_GATE_RULES=Object.freeze({version:2,losses:2,cleanTicks:25,minimumSample:50,staleMs:5000,stability:60,quality:60,edgeFrequency:.60,edgeSwing:.20,recoveryStability:70,recoveryQuality:65,recoveryEdge:.50,recoverySwing:.12,lossSideExcess:.15});
const rate=(rows,test)=>rows.filter(t=>test(t.digit)).length/rows.length;
export class ShadowGatekeeper {
 constructor(store,{now=Date.now}={}){this.store=store;this.now=now;}
 load(owner){return this.store.state(owner+':gatekeeper:v1')??{losses:0,locked:false,settledAt:0,markets:{},recoveredAt:0};}
 save(owner,s){this.store.saveState(owner+':gatekeeper:v1',s);}
 settle(owner,a){
  const r=a.result;if(a.state!=='SETTLED'||a.request?.strategy==='DIFFER'||!['DIGITOVER','DIGITUNDER'].includes(a.request?.type)||!a.contractId||!['won','lost','sold'].includes(r?.status)||!Number.isFinite(r?.profit))return false;
  const id=owner+':gatekeeper-settlement:'+a.contractId;if(this.store.state(id))return false;
  const s=this.load(owner),at=Number(r.exitTickTime)*1000||a.stageAt;
  if(!Number.isFinite(at))return false;
  // Older reconciled outcomes remain auditable, but cannot rewrite a newer streak.
  this.store.saveState(id,{at,status:r.status,profit:r.profit});
  if(at<s.settledAt)return false;
  s.settledAt=at;s.losses=r.profit<0?s.losses+1:0;
  if(s.losses>=SHADOW_GATE_RULES.losses){s.locked=true;s.lockedAt=at;for(const m of Object.values(s.markets))m.clean=0;this.store.transition(owner,{at,event:'GATEKEEPER_WOULD_LOCK',reason:'2 consecutive verified losses',mode:'SHADOW'});}
  this.save(owner,s);return true;
 }
 observe(owner,state){
  const s=this.load(owner),rule=SHADOW_GATE_RULES,key=state.market;
  const m=s.markets[key]??={epoch:0,clean:0,unstable:true};
  if(state.sequence<=m.epoch)return this.status(owner,key);
  const gap=(state.sequence-m.epoch)*1000>rule.staleMs;m.epoch=state.sequence;
  const recent=state.ticks.slice(-25),prior=state.ticks.slice(-50,-25),edge=d=>[0,1,8,9].includes(d);
  const edgeFrequency=rate(recent,edge),edgeSwing=prior.length?Math.abs(edgeFrequency-rate(prior,edge)):null;
  // A raw difference between two 25-tick proportions includes sampling noise.
  // Retain raw swing for audit; compare only the excess over one pooled standard error.
  const pooled=prior.length?(edgeFrequency*recent.length+rate(prior,edge)*prior.length)/(recent.length+prior.length):null;
  const swingNoise=pooled===null?null:Math.sqrt(pooled*(1-pooled)*(1/recent.length+1/prior.length));
  const excessSwing=edgeSwing===null?null:Math.max(0,edgeSwing-swingNoise);
  const fresh=Math.abs(this.now()-state.createdAt)<=rule.staleMs,sampled=state.ticks.length>=rule.minimumSample;
  const candidates=state.candidates.map(c=>{
   const metrics=opportunityMetrics(state,c),lossSide=rate(recent,d=>c.direction==='OVER'?d<=c.barrier:d>=c.barrier),reasons=[];
   if(!fresh)reasons.push('Feed stale');if(!sampled)reasons.push('Need 50 observed ticks');
   if(!Number.isFinite(metrics.stability)||metrics.stability<rule.stability)reasons.push('Distribution stability below 60');
   if(!Number.isFinite(metrics.quality)||metrics.quality<rule.quality)reasons.push('Observational quality below 60');
   if(edgeFrequency>rule.edgeFrequency)reasons.push('Extreme digits exceed 60% of recent ticks');
   if(excessSwing===null||excessSwing>rule.edgeSwing)reasons.push('Extreme frequency swing exceeds sampling allowance plus 20 points');
   if(lossSide>1-c.baseline+rule.lossSideExcess)reasons.push('Candidate loss-side frequency exceeds neutral share by 15 points');
   return {label:c.label,qualified:c.ready,metrics,lossSide,reasons};
  });
  const stable=sampled&&fresh&&state.fine.stability>=rule.recoveryStability&&edgeFrequency<=rule.recoveryEdge&&excessSwing!==null&&excessSwing<=rule.recoverySwing+1e-9&&candidates.some(c=>c.metrics.quality>=rule.recoveryQuality&&c.reasons.length===0);
  m.clean=s.locked&&state.createdAt<=s.lockedAt?0:stable&&!gap?m.clean+1:stable?1:0;
  if(candidates.every(c=>c.reasons.length))m.unstable=true;
  if(m.clean>=rule.cleanTicks)m.unstable=false;
  if(s.locked&&state.createdAt>s.lockedAt&&m.clean>=rule.cleanTicks){s.locked=false;s.losses=0;s.recoveredAt=state.createdAt;this.store.transition(owner,{at:state.createdAt,event:'GATEKEEPER_WOULD_RECOVER',symbol:key,mode:'SHADOW',reason:'25 consecutive clean ticks and stable condition'});}
  m.view={symbol:key,at:state.createdAt,stability:state.fine.stability,edgeFrequency,edgeSwing,swingNoise,excessSwing,cleanTicks:m.clean,stable,candidates};
  this.save(owner,s);const view=this.status(owner,key);this.store.put('observations',owner+':gatekeeper:'+key+':'+state.sequence,owner,key,state.createdAt,{kind:'SHADOW_GATEKEEPER',...view});return view;
 }
 status(owner,symbol){
  const s=this.load(owner),m=s.markets[symbol],v=m?.view,fresh=v&&this.now()-v.at<=SHADOW_GATE_RULES.staleMs;
  const reason=s.locked?'2 CONSECUTIVE LOSSES':!v?'COLLECTING OBSERVATIONS':!fresh?'FEED STALE':m.unstable?'UNSTABLE REGIME':v.at<=s.recoveredAt?'FRESH POST-RECOVERY SIGNAL REQUIRED':null;
  return {mode:'SHADOW',execution:'UNCHANGED',would:reason?'WOULD BLOCK':'WOULD ALLOW QUALIFIED CANDIDATES',reason,losses:s.losses,locked:s.locked,rules:SHADOW_GATE_RULES,...v,cleanTicks:m?.clean??0,candidates:v?.candidates.map(c=>({...c,wouldTake:!reason&&c.qualified&&!c.reasons.length}))??[]};
 }
}

