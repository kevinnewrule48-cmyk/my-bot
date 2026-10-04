// A lost HTTP reply is not proof that a start request was rejected.
// Heartbeats renew existing authority only; they never start or restart Auto.
export class AutoControl {
 constructor(api,onStatus){this.api=api;this.onStatus=onStatus;this.intent=false;this.starting=false;this.revision=0;}
 observe(s){this.sessionId=s.sessionId;if(!this.starting)this.intent=!!s.running;}
 stop(){this.intent=false;this.revision++;}
 async start(body){
  if(this.starting)return;this.starting=true;this.intent=true;this.sessionId=body.sessionId;const revision=++this.revision;
  try {
   let result;
   try{result=await this.api('rise-fall/start',body);}
   catch(error){
    if(error.status){if(revision===this.revision)this.intent=false;throw error;}
    if(revision!==this.revision)return;
    try{result=await this.api('rise-fall/status');}
    catch{throw Error('Start response timed out or was lost; Auto state is unknown. Checking server status; do not repeatedly press Start.');}
   }
   if(revision!==this.revision)return;
   if(result.sessionId!==body.sessionId){this.intent=false;throw Error('Demo session changed; reconnect before starting Auto.');}
   this.intent=!!result.running;this.onStatus(result);
   if(!result.running)throw Error(result.error||'Server confirms Auto is off; explicitly start again.');
  }finally{this.starting=false;}
 }
 async heartbeat(){
  if(!this.intent||!this.sessionId||this.heartbeatPending)return;
  this.heartbeatPending=true;
  try{await this.api('rise-fall/heartbeat',{sessionId:this.sessionId});}
  catch{/* Status polling reports authority. Never retry a start or purchase here. */}
  finally{this.heartbeatPending=false;}
 }
}
