// Ownership only. Never qualifies a candidate or authorizes a purchase.
export const PAIR_RULES=Object.freeze({dwellObservations:3,challengerObservations:3,weakObservations:3,deteriorationObservations:2});
export class PairSelectionController{
 constructor(){this.currentMarket=null;this.currentMarketSince=null;this.currentMarketObservationCount=0;this.currentMarketState='HOLDING';this.currentCandidate=null;this.currentCandidateSince=null;this.currentCandidateAge=0;this.currentCandidateDirection=null;this.weak=0;this.danger=0;this.events=[];this.lastEventKey='';this.resetChallenger();}
 resetChallenger(){this.challengerMarket=null;this.challengerCandidate=null;this.challengerSince=null;this.challengerObservationCount=0;this.challengerAdvantage=null;this.challengerState='NONE';this.challengerSequence=null;}
 adopt(market,now){this.currentMarket=market;this.currentMarketSince=now;this.currentMarketObservationCount=0;this.currentSequence=null;this.currentCandidate=null;this.currentCandidateSince=null;this.weak=0;this.danger=0;this.resetChallenger();}
 evaluate({market,state,current,observed,challenger,superior,evidence,deteriorating,now}){
  if(this.currentMarket!==market)this.adopt(market,now);
  const fresh=state&&state.id!==this.currentSequence;
  if(fresh){this.currentSequence=state.id;this.currentMarketObservationCount++;this.weak=current?0:this.weak+1;this.danger=deteriorating?this.danger+1:0;}
  const key=observed?observed.direction+':'+observed.barrier:null;
  if(key!==this.currentCandidate){this.currentCandidate=key;this.currentCandidateSince=now;}
  this.currentCandidateAge=this.currentCandidateSince==null?0:Math.max(0,now-this.currentCandidateSince);this.currentCandidateDirection=observed?.direction??null;
  this.currentMarketState=this.danger>=PAIR_RULES.deteriorationObservations?'DETERIORATING':current?'READY':this.weak?'DEVELOPING':'HOLDING';
  const stale=!state||now-state.createdAt>5000;
  const viable=challenger&&challenger.market!==market&&(!current||superior);
  if(viable){const identity=challenger.market+':'+challenger.direction+':'+challenger.barrier;
   if(identity!==this.challengerIdentity){this.resetChallenger();this.challengerIdentity=identity;this.challengerSince=now;}
   this.challengerMarket=challenger.market;this.challengerCandidate=challenger.label;this.challengerAdvantage=evidence;
   if(this.challengerSequence!==challenger.id){this.challengerSequence=challenger.id;this.challengerObservationCount++;}
   this.challengerState=this.challengerObservationCount>=PAIR_RULES.challengerObservations?'CONFIRMED':'BUILDING';
  }else {this.resetChallenger();this.challengerIdentity=null;}
  const confirmed=this.challengerState==='CONFIRMED',dwell=this.currentMarketObservationCount>=PAIR_RULES.dwellObservations;
  const switchAllowed=!!viable&&(stale||this.danger>=PAIR_RULES.deteriorationObservations||(confirmed&&dwell&&(current?superior:this.weak>=PAIR_RULES.weakObservations)));
  this.decision=switchAllowed?'SWITCH':'HOLD';this.switchReason=switchAllowed?(stale?'CURRENT MARKET UNAVAILABLE':this.danger>=PAIR_RULES.deteriorationObservations?'CONFIRMED DETERIORATION':current?'PERSISTENT STRONGER CHALLENGER':'PERSISTENT QUALIFICATION LOSS / CONFIRMED CHALLENGER'):!current?'TEMPORARY QUALIFICATION LOSS':viable?'CHALLENGER NOT CONFIRMED':'CURRENT MARKET RETAINED';
  this.qualificationState=current?'QUALIFIED':'NOT QUALIFIED';this.deteriorationState=this.danger>=2?'CONFIRMED':this.danger?'OBSERVING':'NONE';
  this.proposedMarket=switchAllowed?challenger.market:null;const snapshot=this.snapshot(now);
  const eventKey=JSON.stringify([market,this.decision,this.switchReason,this.currentMarketState,this.currentCandidate,this.challengerMarket,this.challengerCandidate,this.challengerState,this.deteriorationState]);
  if(eventKey!==this.lastEventKey){this.events.push(snapshot);if(this.events.length>300)this.events.shift();this.lastEventKey=eventKey;}
  return switchAllowed?challenger:current??null;
 }
 snapshot(now){return {currentMarket:this.currentMarket,currentMarketSince:this.currentMarketSince,currentMarketAge:this.currentMarketSince==null?0:Math.max(0,now-this.currentMarketSince),currentMarketObservationCount:this.currentMarketObservationCount,currentMarketState:this.currentMarketState,currentCandidate:this.currentCandidate,currentCandidateAge:this.currentCandidateAge,currentCandidateDirection:this.currentCandidateDirection,qualificationState:this.qualificationState,deteriorationState:this.deteriorationState,weakObservations:this.weak,deteriorationObservations:this.danger,challengerMarket:this.challengerMarket,challengerCandidate:this.challengerCandidate,challengerSince:this.challengerSince,challengerAge:this.challengerSince==null?0:Math.max(0,now-this.challengerSince),challengerObservationCount:this.challengerObservationCount,challengerAdvantage:this.challengerAdvantage,challengerState:this.challengerState,decision:this.decision,switchReason:this.switchReason,at:now};}
}
