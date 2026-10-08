import {DigitRegimeEngine,REGIME_VERSION} from './digit-regime-engine.js';
const clone=x=>JSON.parse(JSON.stringify(x));
const finite=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x))?Number(x):null;
export function shadowDecision(snapshot,type,barrier){
  const s=type==='DIGITOVER'||type==='OVER'?snapshot?.supports.over:type==='DIGITUNDER'||type==='UNDER'?snapshot?.supports.under:type==='DIGITDIFF'&&Number.isInteger(Number(barrier))?snapshot?.supports.differ[Number(barrier)]:null;
  return s?clone(s):{decision:'OBSERVE',level:'UNKNOWN',reason:'No matching pre-entry regime measurements'};
}
export class RegimeResearch {
  constructor({config,onRecord=()=>{},onDelete=()=>{}}={}){
    this.engine=new DigitRegimeEngine(config);this.onRecord=onRecord;this.onDelete=onDelete;this.trades=new Map();this.candidates=[];this.ticks=[];this.events=[];
    this.capacity={trades:200,candidates:500,ticks:2000,events:200};this.dropped={trades:0,candidates:0,ticks:0,events:0};this.warning=null;this.latest=null;this.dirty=0;this.lastSeen=null;this.inspectedMarket='R_100';this.lastSeenByMarket=new Map();this.uncaptured=new Set();
  }
  bounded(name,event){this[name].push(event);if(this[name].length>this.capacity[name]){this[name].shift();this.dropped[name]++;}}
  persist(r){try{this.onRecord(clone(r));}catch(e){this.warning='Research storage failed: '+e.message;}}
  configure(config){this.engine=new DigitRegimeEngine(config);this.latest=null;this.bounded('events',{event:'CONFIG_CHANGED',time:Date.now(),config:clone(this.engine.config),note:'New measurement history; existing snapshots keep their original rule version/config'});this.dirty++;}
  observe(event,d){
    this.dirty++;
    if(event==='inspect'){this.inspectedMarket=d.market;this.latest=this.engine.snapshot(d.market);this.lastSeen=this.lastSeenByMarket.get(d.market)??null;return;}
    if(event==='feed-start'){this.engine.markets.delete(d.market);this.latest=null;this.lastSeen=null;this.bounded('events',{event:'FEED_SEGMENT_STARTED',...d});return;}
    if(event==='tick'){
      const s=this.engine.observe(d);if(s){const seen={market:d.market,time:d.time,sequence:d.sequence,receivedAt:Date.now()};this.lastSeenByMarket.set(d.market,seen);if(d.market===this.inspectedMarket){this.latest=s;this.lastSeen=seen;}this.bounded('ticks',clone(d));}return;
    }
    if(event==='candidate'){
      const snapshot=this.engine.snapshot(d.market);
      this.bounded('candidates',{...clone(d),regimeSequence:snapshot?.sequence??null,regime:snapshot?.state??'UNKNOWN',ruleVersion:REGIME_VERSION,
        decisions:(d.candidates??[]).map(c=>({type:c.type,barrier:c.barrier,actualStrategy:c.ready?'READY':'NO TRADE',shadow:shadowDecision(snapshot,c.type,c.barrier)}))});return;
    }
    if(event==='attempt'){
      if(!d.attemptId||this.trades.has(d.attemptId))return;
      if(this.trades.size>=this.capacity.trades){const old=[...this.trades.values()].find(x=>['settled','rejected'].includes(x.state));if(!old){this.warning='Research record capacity reached with unresolved attempts; newest snapshot not captured. Execution is unaffected.';this.dropped.trades++;return;}this.trades.delete(old.attemptId);this.onDelete(old.attemptId);this.dropped.trades++;}
      const current=this.engine.snapshot(d.market),s=current?.sequence===d.sequence?current:null;
      const r={schema:1,ruleVersion:REGIME_VERSION,attemptId:d.attemptId,state:'pending',contractId:null,preEntry:clone({...d,regime:s,shadow:shadowDecision(s,d.type,d.barrier)}),receipt:null,settlement:null};
      this.trades.set(d.attemptId,r);this.persist(r);return;
    }
    if(event==='receipt'){
      const receipt=d.receipt??{},attemptId=d.attemptId??receipt.attemptId??receipt.lifecycle?.attemptId;
      const record=this.trades.get(attemptId)??[...this.trades.values()].find(r=>r.contractId&&String(r.contractId)===String(receipt.contractId));
      if(!record){if(receipt.contractId&&!this.uncaptured.has(String(receipt.contractId))){this.uncaptured.add(String(receipt.contractId));if(this.uncaptured.size>200)this.uncaptured.delete(this.uncaptured.values().next().value);this.bounded('events',{event:'MISSING_PRE_ENTRY',contractId:String(receipt.contractId),time:Date.now()});}return;}
      if(record.contractId&&receipt.contractId&&record.contractId!==String(receipt.contractId)){this.warning='Research receipt contract mismatch; receipt ignored';return;}
      if(receipt.accountId&&record.preEntry.accountId&&receipt.accountId!==record.preEntry.accountId){this.warning='Research receipt account mismatch; receipt ignored';return;}
      if(receipt.contractId)record.contractId=String(receipt.contractId);
      record.receipt=clone(receipt);
      if(record.state==='settled')return; // idempotent broker polling
      if(receipt.state==='rejected'){record.state='rejected';this.persist(record);return;}
      const settled=receipt.state==='settled'||receipt.lifecycle?.state==='settled';
      const profit=finite(receipt.profit??receipt.lifecycle?.profit),status=String(receipt.status??receipt.lifecycle?.result??'').toLowerCase();
      if(settled&&record.contractId&&profit!==null&&['won','lost'].includes(status)){
        const lifecycle=receipt.lifecycle??{};
        record.state='settled';record.settlement={contractId:record.contractId,status,profit,payout:finite(receipt.payout),buyPrice:finite(receipt.buyPrice),currency:receipt.currency??record.preEntry.currency??null,
          entryDigit:lifecycle.entryDigit??null,settlementDigit:lifecycle.settlementDigit??null,brokerEntryDigit:lifecycle.brokerEntryDigit??null,
          entryTick:receipt.entryTick??null,exitTick:receipt.exitTick??null,settledAt:Date.now(),brokerTime:receipt.exitTickTime??lifecycle.exitTickTime??null,source:receipt.evidenceSource==='mock'?'mock receipt':'broker receipt'};
      }else if(settled){record.state='incomplete-settlement';this.warning='A settled receipt lacks a verified WIN/LOSS or numeric P/L; excluded from comparison.';}
      else record.state='open';
      this.persist(record);
    }
  }
  restore(records){for(const r of records){if(r?.schema!==1||!r.attemptId||!r.preEntry||this.trades.has(r.attemptId))continue;if(this.trades.size>=this.capacity.trades){this.dropped.trades++;continue;}this.trades.set(r.attemptId,r);}this.dirty++;}
  export(){return {schema:'digit-regime-research-v1',exportedAt:Date.now(),mode:'SHADOW',executionAuthority:false,ruleVersion:REGIME_VERSION,
    parameters:this.engine.config,retention:{capacity:this.capacity,dropped:this.dropped},warning:this.warning,
    ticks:clone(this.ticks),candidates:clone(this.candidates),trades:clone([...this.trades.values()]),events:clone(this.events),engine:this.engine.export(),
    evaluation:evaluateResearch([...this.trades.values()])};}
}
function totals(records){
  const out={trades:records.length,wins:0,losses:0,netPL:0,stake:0,actualReturn:0,missingReturn:0,missingStake:0,maxConsecutiveLosses:0,winRate:null,netReturnPercent:null};let streak=0;
  for(const r of records){const s=r.settlement;if(s.status==='won'){out.wins++;streak=0;}else{out.losses++;streak++;out.maxConsecutiveLosses=Math.max(streak,out.maxConsecutiveLosses);}out.netPL+=s.profit;
    if(s.payout===null)out.missingReturn++;else out.actualReturn+=s.payout;
    if(s.buyPrice===null)out.missingStake++;else out.stake+=s.buyPrice;
  }
  out.winRate=out.trades?out.wins/out.trades*100:null;out.netReturnPercent=out.stake>0&&!out.missingStake?out.netPL/out.stake*100:null;return out;
}
function compare(records){
  const allowed=records.filter(r=>r.preEntry.shadow?.decision==='ALLOW'),blocked=records.filter(r=>r.preEntry.shadow?.decision==='BLOCK'),unknown=records.filter(r=>!['ALLOW','BLOCK'].includes(r.preEntry.shadow?.decision));
  const stratified={};for(const r of records){const k=`${r.preEntry.type}${r.preEntry.type==='DIGITDIFF'?':'+r.preEntry.barrier:''} / ${r.preEntry.regime?.state??'UNKNOWN'}`;(stratified[k]??=[]).push(r);}
  return {baseline:totals(records),hypotheticalAllowed:totals(allowed),hypotheticalBlocked:totals(blocked),unevaluable:totals(unknown),
    winningTradesIncorrectlyBlocked:blocked.filter(r=>r.settlement.status==='won').length,losingTradesCorrectlyBlocked:blocked.filter(r=>r.settlement.status==='lost').length,
    blockedContractIds:blocked.map(r=>({contractId:r.contractId,status:r.settlement.status,profit:r.settlement.profit,reason:r.preEntry.shadow.reason})),
    byStrategyAndRegime:Object.fromEntries(Object.entries(stratified).map(([k,v])=>[k,totals(v)]))};
}
export function evaluateResearch(records,{developmentFraction=.6,minValidationTrades=30}={}){
  if(developmentFraction<=0||developmentFraction>=1)throw Error('Invalid chronological split');
  const known=records.filter(r=>r.state==='settled'&&Number.isFinite(r.settlement?.profit)&&r.settlement?.source==='broker receipt').sort((a,b)=>a.preEntry.capturedAt-b.preEntry.capturedAt);
  // Never combine currencies, demo/real accounts, or different parameter sets.
  const groups={};for(const r of known){const p=r.preEntry,k=JSON.stringify([p.accountType,p.accountId,r.settlement.currency,p.regime?.version,p.regime?.config]);(groups[k]??=[]).push(r);}
  return {method:'Frozen pre-entry decisions, actual broker P/L, chronological 60/40 split; overlapping train settlements purged. Descriptive comparison, not causal proof.',
    sufficientEvidence:known.length>0&&Object.values(groups).every(rows=>rows.length-Math.floor(rows.length*developmentFraction)>=minValidationTrades),
    missingOrUnsettled:records.length-known.length,minValidationTrades,warning:'No re-entry, stake path, balance, cooldown or changed future signals simulated. A filter can alter later opportunities. Small/dependent samples are not proof of profitability.',
    groups:Object.entries(groups).map(([key,rows])=>{
      const split=Math.floor(rows.length*developmentFraction),validation=rows.slice(split),cut=validation[0]?.preEntry.capturedAt??Infinity;
      const development=rows.slice(0,split).filter(r=>r.settlement.settledAt<cut);
      const folds=[];const step=Math.max(1,Math.floor(rows.length/4));
      for(let end=step;end<rows.length;end+=step){const later=rows.slice(end,end+step),boundary=later[0].preEntry.capturedAt,earlier=rows.slice(0,end).filter(r=>r.settlement.settledAt<boundary);folds.push({development:compare(earlier),validation:compare(later),frozenParameters:true,sufficient:later.length>=minValidationTrades});}
      return {key,all:compare(rows),development:compare(development),validation:compare(validation),purgedOverlaps:split-development.length,validationSufficient:validation.length>=minValidationTrades,walkForward:folds};
    })};
}
