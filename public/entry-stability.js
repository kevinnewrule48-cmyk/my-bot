// Part One entry veto. This observes the same live digit stream as the
// existing analyzer; it never changes barrier, score, confidence or quality.
export const EXTREME_DIGITS = Object.freeze(new Set([0, 1, 8, 9]));

const metricsFor = digits => {
  const d = digits.slice(-12);
  const transitions = d.slice(1).map((to, i) => [d[i], to]);
  const dangerous = transitions.filter(([a, b]) => EXTREME_DIGITS.has(a) && EXTREME_DIGITS.has(b) && Math.abs(a - b) >= 7).length;
  const extreme = d.filter(x => EXTREME_DIGITS.has(x)).length;
  const middle = d.filter(x => x >= 2 && x <= 7).length;
  const revisit = d.length ? extreme / d.length * 100 : 0;
  const dangerousRate = transitions.length ? dangerous / transitions.length * 100 : 0;
  const recentTransitions = transitions.slice(-4);
  const recentDangerousTransitions = recentTransitions.filter(([a, b]) => EXTREME_DIGITS.has(a) && EXTREME_DIGITS.has(b) && Math.abs(a - b) >= 7).length;
  const middleRate = d.length ? middle / d.length * 100 : 0;
  return {window:d.length, extremeRevisitRate:revisit, dangerousTransitions:dangerous, recentDangerousTransitions, dangerousTransitionRate:dangerousRate, middleConcentration:middleRate};
};

export class EntryStabilityRecovery {
  constructor({recoveryObservations=3,excellentObservations=5}={}) { this.recoveryObservations=recoveryObservations; this.excellentObservations=excellentObservations; this.reset(); }
  reset(){this.state='STABLE';this.blocked=false;this.recoveryRun=0;this.excellentRun=0;this.trigger=null;this.last=null;this.sequence=-1;}
  observe(history, sequence=history.length){
    if(sequence<=this.sequence)return this.snapshot();
    this.sequence=sequence;
    const digits=history.map(x=>Number.isInteger(x?.digit)?x.digit:Number(x?.digit)).filter(x=>Number.isInteger(x)&&x>=0&&x<=9);
    const m=metricsFor(digits); const severe=m.dangerousTransitions>=2 || (m.extremeRevisitRate>=58 && m.dangerousTransitions>=1);
    if(severe && !this.blocked){
      this.trigger={...m,sequence};
      this.blocked=true;this.state='UNSTABLE';this.recoveryRun=0;this.excellentRun=0;
    } else if(this.blocked){
      const cleared=m.recentDangerousTransitions===0 && m.extremeRevisitRate<=Math.max(12,(this.trigger?.extremeRevisitRate??58)*.75) && m.middleConcentration>=40;
      if(cleared){this.recoveryRun++;this.excellentRun++;this.state=this.recoveryRun>=this.recoveryObservations?(this.excellentRun>=this.excellentObservations?'EXCELLENT':'STABLE'):'RECOVERING';if(this.state==='STABLE'||this.state==='EXCELLENT')this.blocked=false;}
      else {this.recoveryRun=0;this.excellentRun=0;this.state='UNSTABLE';}
    } else {this.excellentRun++;this.state=this.excellentRun>=this.excellentObservations?'EXCELLENT':'STABLE';}
    this.last={...m,sequence}; return this.snapshot();
  }
  snapshot(){const m=this.last??{window:0,extremeRevisitRate:0,dangerousTransitions:0,dangerousTransitionRate:0,middleConcentration:0};return {state:this.state,blocked:this.blocked,recoveryRun:this.recoveryRun,requiredRecovery:this.recoveryObservations,recoveryConfidence:Math.min(100,Math.round(this.recoveryRun/this.recoveryObservations*100)),...m,trigger:this.trigger};}
}
