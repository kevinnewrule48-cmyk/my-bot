// Diagnostics only. This module cannot grant trading permission or submit orders.
export function stopCategory(error={}){
 const text=String(error.executionCode??error.code??'')+' '+String(error.reason??error.message??error.error??'');
 if(/Unknown contract proposal|InvalidContractProposal/i.test(text))return 'UNKNOWN CONTRACT PROPOSAL';
 if(/Brain.*pre.BUY|pre.BUY.*evidence/i.test(text))return 'PRE-BUY EVIDENCE DETERIORATED';
 if(/Balance deteriorated/i.test(text))return 'BALANCE DETERIORATED';
 if(/continuity|server.observ|observation/i.test(text))return 'SERVER OBSERVATION / CONTINUITY FAILURE';
 if(/Request too large|REQUEST_TOO_LARGE/i.test(text))return 'ORDER REQUEST TOO LARGE';
 if(/account session expired/i.test(text))return 'SESSION EXPIRED';
 if(/expired/i.test(text))return 'SIGNAL EXPIRED';
 if(/stale/i.test(text))return 'STALE SIGNAL';
 if(/auth|session|permission|AUTO_STOPPED|PURCHASE_BLOCKED/i.test(text))return 'AUTO NOT AUTHORIZED';
 if(/settlement|contract open/i.test(text))return 'EXISTING CONTRACT / SETTLEMENT BLOCK';
 if(/lock|busy/i.test(text))return 'EXECUTION LOCK ACTIVE';
 if(/proposal/i.test(text))return 'PROPOSAL FAILED';
 return error.stage==='buy'||error.failureKind==='BUY_REJECTED'?'BUY REJECTED':'OTHER EXECUTION FAILURE';
}
export class AutoDiagnostics{
 constructor({now=Date.now,capacity=2000}={}){this.now=now;this.capacity=capacity;this.records=new Map();this.counts={observations:0,qualified:0,brainRejected:0,preBuy:0,execution:0,proposalBuy:0,pairSwitches:0,purchased:0};this.reasons={};this.qualifiedOutcomes={};this.active=false;this.lastPurchase=null;this.observationsAtPurchase=0;this.seen=new Map();this.dropped=0;this.current=null;}
 record(candidate,category,kind='market',reason=category,terminal=false){const key=candidate?.id;if(!key)return;let r=this.records.get(key);if(!r){r={candidateId:key,market:candidate.market,label:candidate.label,qualified:!!candidate.ready,firstAt:this.now()};this.records.set(key,r);if(candidate.ready)this.counts.qualified++;}
  if(r.terminal&&category!=='PURCHASED')return;if(terminal||category==='PURCHASED')r.terminal=true;
  if(r.category===category)return;if(r.qualified){if(r.category)this.qualifiedOutcomes[r.category]--;this.qualifiedOutcomes[category]=(this.qualifiedOutcomes[category]??0)+1;}r.category=category;r.kind=kind;r.reason=reason;r.at=this.now();this.current=r;
  this.reasons[category]=(this.reasons[category]??0)+1;
  if(category==='DECISION BRAIN REJECTED')this.counts.brainRejected++;
  if(/PRE-BUY|BALANCE DETERIORATED/.test(category))this.counts.preBuy++;
  if(kind==='system')this.counts.execution++;
  if(/PROPOSAL FAILED|BUY REJECTED|UNKNOWN CONTRACT/.test(category))this.counts.proposalBuy++;
  if(this.records.size>this.capacity){this.records.delete(this.records.keys().next().value);this.dropped++;}
 }
 observe({states,brain,market,auto,healthy,block=null}){
  const wasActive=this.active;this.active=auto&&healthy;if(this.active&&!wasActive)this.since=this.now();if(!auto)return;
  for(const s of states){if(this.seen.get(s.market)===s.id)continue;this.seen.set(s.market,s.id);this.counts.observations++;const b=brain(s.market);
   for(const c of s.candidates){const e=b?.evaluations.find(x=>x.candidateId===c.id);let category,kind='market';
    if(!e?.enabled){category='AUTO BARRIER DISABLED';kind='system';}
    else if(!c.ready)category=c.deterioration?'DANGEROUS-DIGIT PRESSURE RETURNED':c.checks.find(x=>x.name==='Scale direction'&&!x.pass)?'SCALE DIRECTION FAILED':c.checks.find(x=>x.name==='Edge avoidance'&&!x.pass)?'EDGE AVOIDANCE FAILED':'NO CANDIDATE QUALIFIED';
    else if(e.action!=='TAKE')category=e.action==='WAIT'?'CANDIDATE DEVELOPING':'DECISION BRAIN REJECTED';
    else if(s.market!==market){category='CURRENT PAIR HELD / CHALLENGER NOT CONFIRMED';kind='ownership';}
    else if(c.id!==b.selected?.id)category='ANOTHER CANDIDATE SELECTED';
    else {category=block??'QUALIFIED â€” AWAITING EXECUTION CHECK';kind=block?'system':'pending';}
    this.record(c,category,kind,kind==='system'||kind==='ownership'?category:e?.reason??category);
   }
  }
  const owned=brain(market)?.selected;if(owned&&this.records.has(owned.id))this.current=this.records.get(owned.id);
 }
 purchase(candidate,contractId){if(!contractId)return;this.purchaseIds??=new Set();if(this.purchaseIds.has(String(contractId)))return;this.purchaseIds.add(String(contractId));if(this.purchaseIds.size>10000)this.purchaseIds.delete(this.purchaseIds.values().next().value);this.lastPurchase=this.now();this.observationsAtPurchase=this.counts.observations;this.counts.purchased++;this.record(candidate,'PURCHASED','purchase');}
 snapshot(){const elapsed=this.since==null?0:this.now()-(this.lastPurchase??this.since);return {active:this.active,noPurchaseMs:elapsed,observationsSincePurchase:this.counts.observations-this.observationsAtPurchase,extended:this.active&&this.now()-Math.max(this.lastPurchase??0,this.since??this.now())>=300000,counts:{...this.counts},reasonTransitions:{...this.reasons},qualifiedOutcomes:{...this.qualifiedOutcomes},latest:this.current,dropped:this.dropped,capacity:this.capacity};}
 export(){return {...this.snapshot(),candidates:[...this.records.values()]};}
}
export class CompactTradeLedger{
 constructor({storage=globalThis.localStorage,capacity=10000}={}){this.storage=storage;this.capacity=capacity;this.records=new Map();this.dropped=0;this.warning='';try{const saved=JSON.parse(storage?.getItem('partOneCompactLedger')??'null');if(saved){this.dropped=saved.dropped??0;for(const r of saved.records??[])this.records.set(r.key,r);}}catch{this.warning='Previous compact ledger could not be read';}}
 receipt(r){if(!r?.contractId&&!r?.contract_id)return;const q=r.request??r,contractId=String(r.contractId??r.contract_id),key=String(r.accountId??r.lifecycle?.accountId??'')+':'+contractId,prior=this.records.get(key),c=r.candidate??q.candidate,l=r.lifecycle??r.result??r;
  const settled=['SETTLED','settled'].includes(r.state)||['won','lost'].includes(l.status);if(prior?.settled&&!settled)return;
  const row={...prior,key,contractId,attemptNumber:r.number??prior?.attemptNumber,attemptId:r.attemptId??prior?.attemptId,decisionId:q.decisionId??r.decisionId??prior?.decisionId,market:q.symbol??c?.market??r.market??prior?.market,contractType:q.type??c?.contractType??prior?.contractType,barrier:q.barrier??c?.barrier??prior?.barrier,candidate:c?.label??prior?.candidate,proposalId:r.proposalId??prior?.proposalId,entryDigit:l.entryDigit??prior?.entryDigit??null,settlementDigit:l.settlementDigit??prior?.settlementDigit??null,stake:q.stake??r.buyPrice??prior?.stake,payout:r.result?.payout??l.payout??r.payout??prior?.payout,profit:r.result?.profit??l.profit??r.profit??prior?.profit,status:settled?String(l.status??r.status).toUpperCase():'PURCHASED',settled,settlementTimestamp:settled?(r.completedAt??r.settledAt??(l.exitTickTime?l.exitTickTime*1000:null)??l.settledAt??prior?.settlementTimestamp??Date.now()):null};
  if(JSON.stringify(prior)===JSON.stringify(row))return;this.records.set(key,row);while(this.records.size>this.capacity){const victim=[...this.records.values()].find(x=>x.settled);if(!victim){this.warning='Open-contract ledger exceeds retention target';break;}this.records.delete(victim.key);this.dropped++;}
  try{this.storage?.setItem('partOneCompactLedger',JSON.stringify(this.export()));}catch{this.warning='Ledger storage unavailable; export in-memory records';}
 }
 export(){return {capacity:this.capacity,dropped:this.dropped,warning:this.warning,records:[...this.records.values()]};}
}
