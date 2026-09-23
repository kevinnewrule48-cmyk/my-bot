// Independent browser database. No Part One storage keys or account data.
export class Recorder {
  constructor(){this.session=null;this.queue=Promise.resolve();this.failed=false;}
  open(){return new Promise((resolve,reject)=>{
    const request=indexedDB.open('consent-atm-part-two-recordings',1);
    request.onupgradeneeded=()=>{const db=request.result;db.createObjectStore('sessions',{keyPath:'id'});const ticks=db.createObjectStore('ticks',{keyPath:['session','sequence']});ticks.createIndex('session','session');const quotes=db.createObjectStore('quotes',{autoIncrement:true});quotes.createIndex('session','session');};
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });}
  async write(store,value){const db=await this.open();try{await new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Recording transaction aborted'));});}finally{db.close();}}
  enqueue(store,value){this.queue=this.queue.then(()=>this.write(store,value));this.queue.catch(()=>{this.failed=true;});return this.queue;}
  async start(symbol,precision){await this.queue.catch(()=>{});this.queue=Promise.resolve();this.failed=false;this.session={id:crypto.randomUUID(),symbol,precision,startedAt:Date.now()};await this.enqueue('sessions',this.session);return this.session;}
  tick(tick){if(!this.session)return Promise.resolve();return this.enqueue('ticks',{...tick,session:this.session.id});}
  quote(quote,sequence){if(!this.session)return Promise.resolve();return this.enqueue('quotes',{...quote,sequence,session:this.session.id});}
  async read(store,index,key){await this.queue.catch(()=>{});const db=await this.open();try{return await new Promise((resolve,reject)=>{const tx=db.transaction(store);const table=tx.objectStore(store);const req=index?table.index(index).getAll(key):table.getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}finally{db.close();}}
  async sessions(){return (await this.read('sessions')).sort((a,b)=>b.startedAt-a.startedAt);}
  async export(id){const session=(await this.sessions()).find(s=>s.id===id);if(!session)throw Error('Recording not found');const ticks=await this.read('ticks','session',id),quotes=await this.read('quotes','session',id);return {schema:'consent-atm-part-two-ticks-v1',symbol:session.symbol,precision:session.precision,session,ticks,quotes};}
}
