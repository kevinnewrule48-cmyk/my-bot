import {proposalRequest} from './digit-barrier-engine.js';
export const strategyForType=type=>type==='DIGITDIFF'?'DIFFER':'OVER_UNDER';
export function strategyProposal(request){
  if(request.type!=='DIGITDIFF')return proposalRequest(request);
  if(!Number.isInteger(request.barrier)||request.barrier<0||request.barrier>9)throw Error('Invalid DIFFER barrier');
  const validated=proposalRequest({...request,type:'DIGITOVER'});
  return {...validated,contract_type:'DIGITDIFF',barrier:String(request.barrier)};
}
