import {evaluatePayout} from './payout.js';
// Imported-session diagnostics are not server approval to trade.
export function financialChecks({signal,parameters,evidence,quote,margin=.02,minimumConfidence=65,now=Date.now()}) {
  const matches=evidence&&['symbol','type','barrier'].every(k=>evidence[k]===parameters[k]);
  const bucket=Math.round(signal.modelProbability*20)*5;
  const bin=matches?evidence.report.bins.find(b=>b.bucket===bucket):null;
  const probability=Number.isFinite(bin?.estimate)&&bin.estimate>=0&&bin.estimate<=1?bin.estimate:null;
  const supported=Boolean(matches&&evidence.report.sufficient&&evidence.report.beatsBaseline&&probability!==null);
  const pricing=evaluatePayout(quote,parameters,probability,margin,now);
  const confidencePass=supported&&probability*100>=minimumConfidence;
  const reason=!matches?'Import separate sessions for this market, side and barrier.':probability===null?'Current probability bucket has insufficient training observations.':!evidence.report.sufficient?'Insufficient held-out observations.':!evidence.report.beatsBaseline?'Calibration did not improve on the held-out baseline.':!confidencePass?'Calibrated estimate is below the confidence threshold.':!pricing.fresh?'Request a fresh matching payout quote.':!pricing.passesEstimate?'Payout does not exceed break-even plus the safety margin.':'Diagnostic confidence and payout checks pass; execution approval is separate.';
  const checks=signal.checks.filter(c=>!['Calibrated confidence','Payout / EV'].includes(c.name)).map(c=>({...c}));
  checks.push({name:'Calibrated confidence',value:probability===null?null:probability*100,required:minimumConfidence,pass:confidencePass});
  checks.push({name:'Payout / EV',value:pricing.estimatedEV,required:0,pass:supported&&pricing.passesEstimate});
  checks.push({name:'Execution validation',value:null,required:null,pass:false});
  return {...signal,checks,calibratedProbability:probability,pricing,reason,decision:'WAIT',diagnosticReady:checks.slice(0,-1).every(c=>c.pass)};
}
