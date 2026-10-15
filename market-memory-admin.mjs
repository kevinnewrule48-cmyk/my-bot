import {readFileSync,writeFileSync} from 'node:fs';
import {MemoryStore} from './market-memory-store.mjs';
// Offline maintenance only. No reset/delete command is provided.
const [command,file,argument,destination,confirmation]=process.argv.slice(2);
if(!['backup','export','restore'].includes(command)||!file)throw Error('Usage: node market-memory-admin.mjs backup DB DEST | export DB OWNER DEST | restore DB JSON BACKUP --confirm-restore');
const store=new MemoryStore(file);try{store.check();if(command==='backup')store.backup(argument);else if(command==='export')writeFileSync(destination,JSON.stringify(store.export(argument),null,2),{flag:'wx'});else store.restore(JSON.parse(readFileSync(argument,'utf8')),{backup:destination,confirm:confirmation==='--confirm-restore'});console.log('Memory maintenance completed.');}finally{store.close();}
